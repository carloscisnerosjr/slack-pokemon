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
    return { text, spriteUrl: '', moves: [] };
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
  const pokemonId = pkmndata.pkdx_id || pkmndata.id;

  await Promise.allSettled(movePromises);
  await stateMachine.setUserHP(scaledHp);
  await stateMachine.setUserPkmnTypes((pkmndata.types || []).map((val) => val.name));

  const nextTurn = parseInt(battle?.turn || '0', 10) + 1;
  await stateMachine.updateBattle({
    playerName,
    userPokemon: pkmndata.name,
    userPokemonId: String(pokemonId),
    userLevel: String(level),
    userMaxHp: String(scaledHp),
    turn: String(nextTurn)
  });

  const npcHp = parseInt((await stateMachine.getNpcHP()) || battle?.npcMaxHp || '100', 10);
  await stateMachine.saveBattleScene({
    turn: nextTurn,
    npcPokemon: battle?.npcPokemon || '',
    npcId: battle?.npcPokemonId || '',
    npcLevel: parseInt(battle?.npcLevel || String(DEFAULT_START_LEVEL), 10),
    npcHp,
    npcMaxHp: parseInt(battle?.npcMaxHp || String(npcHp), 10),
    userPokemon: pkmndata.name,
    userId: String(pokemonId),
    userLevel: level,
    userHp: scaledHp,
    userMaxHp: scaledHp,
    dialogLines: [
      `Go! ${pkmndata.name.toUpperCase()} (Lv.${level})!`,
      `Moves: ${moveNames.join(', ')}`
    ]
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
    spriteUrl: getSpriteUrl(pkmndata),
    moves: moveNames,
    turn: nextTurn
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
  const pokemonId = pkmnData.pkdx_id || pkmnData.id;

  await Promise.allSettled(movePromises);
  await stateMachine.setNpcHP(scaledHp);
  await stateMachine.setNpcPkmnTypes((pkmnData.types || []).map((val) => val.name));
  await stateMachine.updateBattle({
    npcPokemon: pkmnData.name,
    npcPokemonId: String(pokemonId),
    npcLevel: String(npcLevel),
    npcMaxHp: String(scaledHp),
    turn: '1'
  });

  await stateMachine.saveBattleScene({
    turn: 1,
    npcPokemon: pkmnData.name,
    npcId: String(pokemonId),
    npcLevel,
    npcHp: scaledHp,
    npcMaxHp: scaledHp,
    userPokemon: '',
    userId: '',
    userLevel: DEFAULT_START_LEVEL,
    userHp: 0,
    userMaxHp: 100,
    dialogLines: [
      `Trainer sent out ${pkmnData.name.toUpperCase()} (Lv.${npcLevel})!`,
      'Choose your Pokemon with: /pkmn i choose <name>'
    ]
  });

  return {
    text: `I Choose ${pkmnData.name} (Lv. ${npcLevel})!`,
    spriteUrl: getSpriteUrl(pkmnData),
    turn: 1
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
    spriteUrl: pkmnChoice.spriteUrl,
    turn: pkmnChoice.turn
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
    return { message: '', evolvedTo: null };
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
    return {
      message,
      newLevel,
      evolvedTo: evoResult.to,
      evolvedId: String(evoResult.pokemon.pkdx_id || evoResult.pokemon.id)
    };
  }

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

  return { message, newLevel, evolvedTo: null };
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
  const effText = effectivenessMessage(multiplier).trim();

  if (parseInt(hpRemaining, 10) <= 0) {
    const progression = await handleVictoryProgression();
    await stateMachine.endBattle();
    return {
      battleOver: true,
      moveName,
      moveType: moveData.type || 'normal',
      damage: totalDamage,
      hpRemaining: 0,
      progression,
      dialogLines: [
        `${(battle?.userPokemon || 'Pokemon').toUpperCase()} used ${moveName.toUpperCase()}! ${effText}`.trim(),
        `Foe ${(battle?.npcPokemon || 'Pokemon').toUpperCase()} fainted! You win!`,
        progression.evolvedTo
          ? `What?! ${(battle?.userPokemon || '').toUpperCase()} evolved into ${progression.evolvedTo.toUpperCase()}!`
          : `${(battle?.userPokemon || 'Pokemon').toUpperCase()} grew to Lv.${progression.newLevel || userLevel + 4}!`
      ],
      text: `You used ${moveName}! ${effectivenessMessage(multiplier)}It knocked out the opponent's Pokémon! You Beat Me!${progression.message}`
    };
  }

  const textString = `You used ${moveName}! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving me with ${hpRemaining}HP!`;

  return {
    battleOver: false,
    moveName,
    moveType: moveData.type || 'normal',
    damage: totalDamage,
    hpRemaining: parseInt(hpRemaining, 10),
    dialogLines: [
      `${(battle?.userPokemon || 'Pokemon').toUpperCase()} used ${moveName.toUpperCase()}! ${effText}`.trim(),
      multiplier === 0 ? "It doesn't have an effect." : `Dealt ${totalDamage} dmg! (${hpRemaining} HP left)`
    ],
    text: multiplier === 0 ? textString : textString + textStringDmg
  };
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
  const effText = effectivenessMessage(multiplier).trim();

  if (parseInt(hpRemaining, 10) <= 0) {
    await stateMachine.endBattle();
    return {
      battleOver: true,
      moveName: chosenMove,
      moveType: moveData.type || 'normal',
      damage: totalDamage,
      hpRemaining: 0,
      dialogLines: [
        `Foe ${(battle?.npcPokemon || 'Pokemon').toUpperCase()} used ${chosenMove.toUpperCase()}! ${effText}`.trim(),
        `${(battle?.userPokemon || 'Pokemon').toUpperCase()} fainted! You Lost!`
      ],
      text: `I used ${chosenMove}! ${effectivenessMessage(multiplier)}You Lost!`
    };
  }

  const textString = `I used ${chosenMove}! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving you with ${hpRemaining}HP!`;

  return {
    battleOver: false,
    moveName: chosenMove,
    moveType: moveData.type || 'normal',
    damage: totalDamage,
    hpRemaining: parseInt(hpRemaining, 10),
    dialogLines: [
      `Foe ${(battle?.npcPokemon || 'Pokemon').toUpperCase()} used ${chosenMove.toUpperCase()}! ${effText}`.trim(),
      multiplier === 0 ? "It doesn't have an effect." : `Dealt ${totalDamage} dmg! (${hpRemaining} HP left)`
    ],
    text: multiplier === 0 ? textString : textString + textStringDmg
  };
}

/*
 * When the user uses a move, calculate the results of the user's turn,
 * then the NPC's turn, and record a snapshot for the dynamic battle card renderer.
 */
module.exports.useMove = async function useMove(moveName) {
  const battleBefore = await stateMachine.getBattle();
  const prevNpcHp = parseInt((await stateMachine.getNpcHP()) || battleBefore?.npcMaxHp || '100', 10);
  const prevUserHp = parseInt((await stateMachine.getUserHP()) || battleBefore?.userMaxHp || '100', 10);
  const nextTurn = parseInt(battleBefore?.turn || '1', 10) + 1;

  const userResult = await useMoveUser(moveName);
  if (userResult.battleOver) {
    const evolvedId = userResult.progression?.evolvedId;
    const evolvedName = userResult.progression?.evolvedTo;
    const finalUserLevel = userResult.progression?.newLevel || parseInt(battleBefore?.userLevel || '12', 10);

    await stateMachine.saveBattleScene({
      turn: nextTurn,
      npcPokemon: battleBefore?.npcPokemon || '',
      npcId: battleBefore?.npcPokemonId || '',
      npcLevel: parseInt(battleBefore?.npcLevel || '12', 10),
      prevNpcHp,
      npcHp: 0,
      npcMaxHp: parseInt(battleBefore?.npcMaxHp || String(prevNpcHp), 10),
      userPokemon: evolvedName || battleBefore?.userPokemon || '',
      userId: evolvedId || battleBefore?.userPokemonId || '',
      userLevel: finalUserLevel,
      prevUserHp,
      userHp: prevUserHp,
      userMaxHp: parseInt(battleBefore?.userMaxHp || String(prevUserHp), 10),
      userMove: userResult.moveName,
      userMoveType: userResult.moveType,
      userDialogLines: userResult.dialogLines,
      dialogLines: userResult.dialogLines
    });
    return userResult.text;
  }

  const npcResult = await useMoveNpc();
  if (!npcResult.battleOver) {
    await stateMachine.updateBattle({ turn: String(nextTurn) });
  }

  await stateMachine.saveBattleScene({
    turn: nextTurn,
    npcPokemon: battleBefore?.npcPokemon || '',
    npcId: battleBefore?.npcPokemonId || '',
    npcLevel: parseInt(battleBefore?.npcLevel || '12', 10),
    prevNpcHp,
    npcHp: userResult.hpRemaining,
    npcMaxHp: parseInt(battleBefore?.npcMaxHp || String(prevNpcHp), 10),
    userPokemon: battleBefore?.userPokemon || '',
    userId: battleBefore?.userPokemonId || '',
    userLevel: parseInt(battleBefore?.userLevel || '12', 10),
    prevUserHp,
    userHp: npcResult.hpRemaining,
    userMaxHp: parseInt(battleBefore?.userMaxHp || String(prevUserHp), 10),
    userMove: userResult.moveName,
    userMoveType: userResult.moveType,
    npcMove: npcResult.moveName,
    npcMoveType: npcResult.moveType,
    userDialogLines: userResult.dialogLines,
    npcDialogLines: npcResult.dialogLines,
    dialogLines: [
      userResult.dialogLines[0],
      npcResult.dialogLines[0],
      npcResult.battleOver
        ? `${(battleBefore?.userPokemon || 'Pokemon').toUpperCase()} fainted! You Lost!`
        : `HP: You ${npcResult.hpRemaining}/${battleBefore?.userMaxHp || prevUserHp} | Foe ${userResult.hpRemaining}/${battleBefore?.npcMaxHp || prevNpcHp}`
    ]
  });

  return `${userResult.text}\n${npcResult.text}`;
};
