const pokeapi = require('./poke-api.js');
const stateMachine = require('./state-machine.js');

function shuffle(arr) {
  const o = [...arr];
  for (let i = o.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [o[i], o[j]] = [o[j], o[i]];
  }
  return o;
}

function getSpriteUrl(pkmndata) {
  if (pkmndata.spriteUrl) {
    return pkmndata.spriteUrl;
  }
  const id = pkmndata.pkdx_id || pkmndata.id;
  return `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/versions/generation-v/black-white/animated/${id}.gif`;
}

module.exports = {};

/*
 * Return a text string when the command doesn't match defined commands.
 */
module.exports.unrecognizedCommand = async function unrecognizedCommand(commandsArray) {
  const copy = [...commandsArray];
  if (copy[0] === 'pkmn') {
    copy.shift();
  }
  return `I don't recognize the command _${copy.join(' ')}_ .`;
};

/*
 * Return a text string when the user chooses a Pokemon.
 * Fetch the pokemon from the API, choose up to 4 random moves, write them to Redis,
 * and then return a message stating the pokemon, its HP, and its moves.
 */
module.exports.userChoosePokemon = async function userChoosePokemon(commandsArray) {
  const commandString = commandsArray.join(' ');
  const pokemonName = commandsArray[3];

  if (!/i choose/i.test(commandString) || !pokemonName) {
    const text = await module.exports.unrecognizedCommand(commandsArray);
    return { text, spriteUrl: '' };
  }

  const pkmndata = await pokeapi.getPokemon(pokemonName);
  const shuffledMoves = shuffle(pkmndata.moves || []);
  const selectedMoves = shuffledMoves.slice(0, 4);

  const movePromises = selectedMoves.map((move) => {
    const moveUrl = move.url || `https://pokeapi.co${move.resource_uri}`;
    return pokeapi.getMove(moveUrl).then(stateMachine.addMove);
  });

  let textString = 'You chose {pkmnn}. It has {hp} HP, and knows ';
  selectedMoves.forEach((move, i) => {
    if (i < selectedMoves.length - 1) {
      textString += `${move.name}, `;
    } else {
      textString += `and ${move.name}.`;
    }
  });

  await Promise.allSettled(movePromises);
  await stateMachine.setUserHP(pkmndata.hp);
  await stateMachine.setUserPkmnTypes((pkmndata.types || []).map((val) => val.name));

  textString = textString.replace('{pkmnn}', pkmndata.name).replace('{hp}', pkmndata.hp);

  return {
    text: textString,
    spriteUrl: getSpriteUrl(pkmndata)
  };
};

/*
 * Return a text string when the NPC chooses a Pokemon.
 * Fetch the pokemon from the API, choose up to 4 random moves, write them to Redis,
 * and then return a message stating the pokemon.
 */
module.exports.npcChoosePokemon = async function npcChoosePokemon(dexNo) {
  const pkmnData = await pokeapi.getPokemon(dexNo);
  const shuffledMoves = shuffle(pkmnData.moves || []);
  const selectedMoves = shuffledMoves.slice(0, 4);

  const movePromises = selectedMoves.map((move) => {
    const moveUrl = move.url || `https://pokeapi.co${move.resource_uri}`;
    return pokeapi.getMove(moveUrl).then(stateMachine.addMoveNPC);
  });

  await Promise.allSettled(movePromises);
  await stateMachine.setNpcHP(pkmnData.hp);
  await stateMachine.setNpcPkmnTypes((pkmnData.types || []).map((val) => val.name));

  return {
    text: `I Choose ${pkmnData.name}!`,
    spriteUrl: getSpriteUrl(pkmnData)
  };
};

/*
 * Return a text string when the battle starts.
 * Stores the player's Slack username and what channel the battle is in,
 * and chooses a Pokemon for the NPC from the original 151.
 */
module.exports.startBattle = async function startBattle(slackData) {
  const userName = slackData.user_name || slackData.user || 'Trainer';
  const channelName = slackData.channel_name || slackData.channel || '#general';
  const textString = `OK ${userName}, I'll battle you! `;
  const dexNo = Math.ceil(Math.random() * 151);

  await stateMachine.newBattle(userName, channelName);
  const pkmnChoice = await module.exports.npcChoosePokemon(dexNo);

  return {
    text: `${textString}\n${pkmnChoice.text}`,
    spriteUrl: pkmnChoice.spriteUrl
  };
};

module.exports.endBattle = async function endBattle() {
  return stateMachine.endBattle();
};

function effectivenessMessage(mult) {
  switch (mult) {
    case 0:
      return "It doesn't have an effect. ";
    case 0.5:
    case 0.25:
      return "It's not very effective... ";
    case 1:
      return ' ';
    case 2:
    case 4:
      return "It's super effective! ";
    default:
      return ' ';
  }
}

/*
 * Helper function for using one of the user's pokemon's move.
 * First check to see if the move is among the allowed moves,
 * calculate the type effectiveness, calculate the damage,
 * and then return a message.
 */
async function useMoveUser(moveName) {
  const moves = await stateMachine.getUserAllowedMoves();
  if (!moves.includes(moveName)) {
    throw new Error("Your pokemon doesn't know that move.");
  }

  const moveData = await stateMachine.getSingleMove(moveName);
  const types = await stateMachine.getNpcPkmnTypes();
  const multiplier = await pokeapi.getAttackMultiplier(moveData.type, types[0], types[1]);

  const power = Number(moveData.power) || 0;
  const totalDamage = Math.ceil((power / 5) * multiplier);
  const hpRemaining = await stateMachine.doDamageToNpc(totalDamage);

  if (parseInt(hpRemaining, 10) <= 0) {
    await stateMachine.endBattle();
    return 'You Beat Me!';
  }

  const textString = `You used ${moveName}! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving me with ${hpRemaining}HP!`;

  if (multiplier === 0) {
    return textString;
  }
  return textString + textStringDmg;
}

/*
 * Helper function for using one of the NPC's pokemon's move.
 * Choose one of the allowed moves, calculate the type effectiveness,
 * calculate the damage, and then return a message.
 */
async function useMoveNpc() {
  const moves = await stateMachine.getNpcAllowedMoves();
  if (!moves || moves.length === 0) {
    throw new Error('NPC has no moves available.');
  }

  const chosenMove = moves[Math.floor(Math.random() * moves.length)];
  const moveData = await stateMachine.getSingleMove(chosenMove);
  const types = await stateMachine.getUserPkmnTypes();
  const multiplier = await pokeapi.getAttackMultiplier(moveData.type, types[0], types[1]);

  const power = Number(moveData.power) || 0;
  const totalDamage = Math.ceil((power / 5) * multiplier);
  const hpRemaining = await stateMachine.doDamageToUser(totalDamage);

  if (parseInt(hpRemaining, 10) <= 0) {
    await stateMachine.endBattle();
    return 'You Lost!';
  }

  const textString = `I used ${chosenMove}! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving you with ${hpRemaining}HP!`;

  if (multiplier === 0) {
    return textString;
  }
  return textString + textStringDmg;
}

/*
 * When the user uses a move, calculate the results of the user's turn,
 * then the NPC's turn. If either one of them ends the battle, don't show
 * the other result.
 */
module.exports.useMove = async function useMove(moveName) {
  const userResult = await useMoveUser(moveName);
  if (userResult === 'You Beat Me!') {
    return userResult;
  }

  const npcResult = await useMoveNpc();
  if (npcResult === 'You Lost!') {
    return npcResult;
  }

  return `${userResult}\n${npcResult}`;
};
