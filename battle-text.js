const pokeapi = require('./poke-api.js');
const stateMachine = require('./state-machine.js');

const DEFAULT_START_LEVEL = 12;
const LEVELS_PER_WIN = 4;

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

function scaleHpForLevel(baseHp, level) {
  const lvl = Number(level) || DEFAULT_START_LEVEL;
  return Math.round(Number(baseHp) + (lvl - 5) * 3);
}

function scaleDamageForLevel(basePower, multiplier, level) {
  const lvl = Number(level) || DEFAULT_START_LEVEL;
  const levelBonus = 1 + (lvl - 5) * 0.04;
  return Math.ceil((basePower / 5) * multiplier * levelBonus);
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
 * Fetch the pokemon from the API, load or initialize its persistent level & moves,
 * write battle state to Redis, and return a message stating the pokemon, its level, HP, and moves.
 */
module.exports.userChoosePokemon = async function userChoosePokemon(commandsArray, slackData = {}) {
  const commandString = commandsArray.join(' ');
  const pokemonName = commandsArray[3];

  if (!/i choose/i.test(commandString) || !pokemonName) {
    const text = await module.exports.unrecognizedCommand(commandsArray);
    return { text, spriteUrl: '' };
  }

  const battle = await stateMachine.getBattle();
  const playerName =
    slackData.user_name || slackData.user || battle?.playerName || 'Trainer';

  const pkmndata = await pokeapi.getPokemon(pokemonName);
  const existingRecord = await stateMachine.getTrainerPokemon(playerName, pkmndata.name);

  const level = existingRecord ? existingRecord.level : DEFAULT_START_LEVEL;
  const xp = existingRecord ? existingRecord.xp : 0;
  const wins = existingRecord ? existingRecord.wins : 0;

  const shuffledMoves = shuffle(pkmndata.moves || []);
  const selectedMoves = shuffledMoves.slice(0, 4);

  const movePromises = selectedMoves.map((move) => {
    const moveUrl = move.url || `https://pokeapi.co${move.resource_uri}`;
    return pokeapi.getMove(moveUrl).then(stateMachine.addMove);
  });

  const moveNames = selectedMoves.map((m) => m.name);
  await stateMachine.saveTrainerPokemon(playerName, {
    name: pkmndata.name,
    level,
    xp,
    wins,
    moves: moveNames
  });

  const scaledHp = scaleHpForLevel(pkmndata.hp, level);

  await Promise.allSettled(movePromises);
  await stateMachine.setUserHP(scaledHp);
  await stateMachine.setUserPkmnTypes((pkmndata.types || []).map((val) => val.name));
  await stateMachine.updateBattle({
    playerName,
    userPokemon: pkmndata.name,
    userLevel: String(level)
  });

  let textString = `You chose ${pkmndata.name} (Lv. ${level}). It has ${scaledHp} HP, and knows `;
  selectedMoves.forEach((move, i) => {
    if (i < selectedMoves.length - 1) {
      textString += `${move.name}, `;
    } else {
      textString += `and ${move.name}.`;
    }
  });

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
module.exports.npcChoosePokemon = async function npcChoosePokemon(dexNo, npcLevel = DEFAULT_START_LEVEL) {
  const pkmnData = await pokeapi.getPokemon(dexNo);
  const shuffledMoves = shuffle(pkmnData.moves || []);
  const selectedMoves = shuffledMoves.slice(0, 4);

  const movePromises = selectedMoves.map((move) => {
    const moveUrl = move.url || `https://pokeapi.co${move.resource_uri}`;
    return pokeapi.getMove(moveUrl).then(stateMachine.addMoveNPC);
  });

  const scaledHp = scaleHpForLevel(pkmnData.hp, npcLevel);

  await Promise.allSettled(movePromises);
  await stateMachine.setNpcHP(scaledHp);
  await stateMachine.setNpcPkmnTypes((pkmnData.types || []).map((val) => val.name));
  await stateMachine.updateBattle({
    npcPokemon: pkmnData.name,
    npcLevel: String(npcLevel)
  });

  return {
    text: `I Choose ${pkmnData.name} (Lv. ${npcLevel})!`,
    spriteUrl: getSpriteUrl(pkmnData)
  };
};

/*
 * Return a text string when the battle starts.
 * Stores the player's Slack username and what channel the battle is in,
 * and chooses a Pokemon for the NPC from the original 151.
 */
module.exports.startBattle = async function startBattle(slackData = {}) {
  const userName = slackData.user_name || slackData.user || 'Trainer';
  const channelName = slackData.channel_name || slackData.channel || '#general';
  const textString = `OK ${userName}, I'll battle you! `;
  const dexNo = Math.ceil(Math.random() * 151);

  await stateMachine.newBattle(userName, channelName);
  const pkmnChoice = await module.exports.npcChoosePokemon(dexNo, DEFAULT_START_LEVEL);

  return {
    text: `${textString}\n${pkmnChoice.text}`,
    spriteUrl: pkmnChoice.spriteUrl
  };
};

module.exports.endBattle = async function endBattle() {
  return stateMachine.endBattle();
};

/*
 * Handle post-win XP, level up, and evolution check for the user's active Pokemon.
 */
async function handleVictoryProgression() {
  const battle = await stateMachine.getBattle();
  if (!battle || !battle.userPokemon) {
    return '';
  }

  const playerName = battle.playerName || 'Trainer';
  const pokemonName = battle.userPokemon;
  const record = (await stateMachine.getTrainerPokemon(playerName, pokemonName)) || {
    name: pokemonName,
    level: parseInt(battle.userLevel || String(DEFAULT_START_LEVEL), 10),
    xp: 0,
    wins: 0,
    moves: []
  };

  const xpGained = 100;
  const newXp = record.xp + xpGained;
  const newWins = record.wins + 1;
  const newLevel = record.level + LEVELS_PER_WIN;

  let message = `\n*${pokemonName}* gained ${xpGained} XP and grew to *Lv. ${newLevel}*!`;

  const evoResult = await pokeapi.checkEvolution(pokemonName, newLevel);
  if (evoResult && evoResult.to) {
    await stateMachine.evolveTrainerPokemon(playerName, pokemonName, {
      name: evoResult.to,
      level: newLevel,
      xp: newXp,
      wins: newWins,
      moves: record.moves
    });
    const evoSprite = getSpriteUrl(evoResult.pokemon);
    message += `\nWhat? *${pokemonName}* is evolving!\nCongratulations! Your *${pokemonName}* evolved into *${evoResult.to}*!\n${evoSprite}`;
  } else {
    await stateMachine.saveTrainerPokemon(playerName, {
      name: pokemonName,
      level: newLevel,
      xp: newXp,
      wins: newWins,
      moves: record.moves
    });
    if (evoResult && evoResult.nextEvolution) {
      message += ` (Evolves into *${evoResult.nextEvolution}* at Lv. ${evoResult.requiredLevel})`;
    }
  }

  return message;
}

/*
 * Return a summary of the trainer's saved Pokemon and their levels/evolution status.
 */
module.exports.getStats = async function getStats(slackData = {}) {
  const playerName = slackData.user_name || slackData.user || 'Trainer';
  const roster = await stateMachine.getTrainerRoster(playerName);
  if (!roster || roster.length === 0) {
    return `Trainer *${playerName}* hasn't chosen any Pokémon yet! Start a battle and use \`/pkmn i choose <pokemon>\`.`;
  }

  roster.sort((a, b) => b.level - a.level);
  const lines = roster.map(
    (p) => `• *${p.name}* — Lv. ${p.level} (${p.xp} XP, ${p.wins} ${p.wins === 1 ? 'win' : 'wins'})`
  );
  return `*${playerName}'s Pokémon Roster:*\n${lines.join('\n')}`;
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

  const battle = await stateMachine.getBattle();
  const userLevel = parseInt(battle?.userLevel || String(DEFAULT_START_LEVEL), 10);

  const moveData = await stateMachine.getSingleMove(moveName);
  const types = await stateMachine.getNpcPkmnTypes();
  const multiplier = await pokeapi.getAttackMultiplier(moveData.type, types[0], types[1]);

  const power = Number(moveData.power) || 0;
  const totalDamage = scaleDamageForLevel(power, multiplier, userLevel);
  const hpRemaining = await stateMachine.doDamageToNpc(totalDamage);

  if (parseInt(hpRemaining, 10) <= 0) {
    const progressionText = await handleVictoryProgression();
    await stateMachine.endBattle();
    return {
      battleOver: true,
      text: `You used ${moveName}! ${effectivenessMessage(multiplier)}It knocked out the opponent's Pokémon! You Beat Me!${progressionText}`
    };
  }

  const textString = `You used ${moveName}! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving me with ${hpRemaining}HP!`;

  if (multiplier === 0) {
    return { battleOver: false, text: textString };
  }
  return { battleOver: false, text: textString + textStringDmg };
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

  const battle = await stateMachine.getBattle();
  const npcLevel = parseInt(battle?.npcLevel || String(DEFAULT_START_LEVEL), 10);

  const chosenMove = moves[Math.floor(Math.random() * moves.length)];
  const moveData = await stateMachine.getSingleMove(chosenMove);
  const types = await stateMachine.getUserPkmnTypes();
  const multiplier = await pokeapi.getAttackMultiplier(moveData.type, types[0], types[1]);

  const power = Number(moveData.power) || 0;
  const totalDamage = scaleDamageForLevel(power, multiplier, npcLevel);
  const hpRemaining = await stateMachine.doDamageToUser(totalDamage);

  if (parseInt(hpRemaining, 10) <= 0) {
    await stateMachine.endBattle();
    return {
      battleOver: true,
      text: `I used ${chosenMove}! ${effectivenessMessage(multiplier)}You Lost!`
    };
  }

  const textString = `I used ${chosenMove}! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving you with ${hpRemaining}HP!`;

  if (multiplier === 0) {
    return { battleOver: false, text: textString };
  }
  return { battleOver: false, text: textString + textStringDmg };
}

/*
 * When the user uses a move, calculate the results of the user's turn,
 * then the NPC's turn. If either one of them ends the battle, don't show
 * the other result.
 */
module.exports.useMove = async function useMove(moveName) {
  const userResult = await useMoveUser(moveName);
  if (userResult.battleOver) {
    return userResult.text;
  }

  const npcResult = await useMoveNpc();
  if (npcResult.battleOver) {
    return `${userResult.text}\n${npcResult.text}`;
  }

  return `${userResult.text}\n${npcResult.text}`;
};

