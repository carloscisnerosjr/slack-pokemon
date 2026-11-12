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

function resolveScope(slackData = {}) {
  return String(slackData.channel_id || slackData.channel_name || slackData.channel || 'default')
    .trim()
    .toLowerCase();
}

function resolveCallerName(slackData = {}) {
  return String(slackData.user_name || slackData.user?.username || slackData.user?.name || slackData.user || 'Trainer').trim();
}

function resolveCallerId(slackData = {}) {
  return String(slackData.user_id || slackData.user?.id || '').trim();
}

function parseOpponentTarget(rawTarget = '') {
  const cleaned = String(rawTarget).trim();
  if (!cleaned) return { id: '', name: '' };

  // Slack mention format: <@U0123ABC|carlos> or <@U0123ABC>
  const mentionMatch = cleaned.match(/^<@([A-Z0-9]+)(?:\|([^>]+))?>$/i);
  if (mentionMatch) {
    return {
      id: mentionMatch[1].toUpperCase(),
      name: (mentionMatch[2] || mentionMatch[1]).toLowerCase()
    };
  }

  return {
    id: '',
    name: cleaned.replace(/^@/, '').toLowerCase()
  };
}

function isPlayer2Caller(battle, callerName, callerId) {
  if (!battle || battle.mode !== 'pvp') return false;
  const p1Name = (battle.playerName || '').toLowerCase();
  const p1Id = (battle.player1Id || '').toUpperCase();
  const p2Name = (battle.player2Name || '').toLowerCase();
  const p2Id = (battle.player2Id || '').toUpperCase();
  const cName = callerName.toLowerCase();
  const cId = callerId.toUpperCase();

  if (cId && p2Id && cId === p2Id) return true;
  if (cName && p2Name && cName === p2Name) return true;
  // Open PvP challenge where player2 hasn't joined yet: anyone other than player 1 is player 2!
  if ((cId && p1Id && cId !== p1Id) || (cName && p1Name && cName !== p1Name)) {
    return true;
  }
  return false;
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
 * Return a text string when a user chooses a Pokemon.
 * Supports both single-player (vs NPC) and PvP (Player 1 vs Player 2 in a DM or channel).
 */
module.exports.userChoosePokemon = async function userChoosePokemon(commandsArray, slackData = {}) {
  const commandString = commandsArray.join(' ');
  const pokemonName = commandsArray[3];

  if (!/i choose/i.test(commandString) || !pokemonName) {
    const text = await module.exports.unrecognizedCommand(commandsArray);
    return { text, spriteUrl: '', moves: [] };
  }

  const scope = resolveScope(slackData);
  const battle = await stateMachine.getBattle(scope);
  const callerName = resolveCallerName(slackData);
  const callerId = resolveCallerId(slackData);

  const pkmndata = await pokeapi.getPokemon(pokemonName);
  const existingRecord = await stateMachine.getTrainerPokemon(callerName, pkmndata.name);

  const level = existingRecord ? existingRecord.level : DEFAULT_START_LEVEL;
  const xp = existingRecord ? existingRecord.xp : 0;
  const wins = existingRecord ? existingRecord.wins : 0;

  const shuffledMoves = shuffle(pkmndata.moves || []);
  const selectedMoves = shuffledMoves.slice(0, 4);
  const moveNames = selectedMoves.map((m) => m.name);

  await stateMachine.saveTrainerPokemon(callerName, {
    name: pkmndata.name,
    level,
    xp,
    wins,
    moves: moveNames
  });

  const scaledHp = scaleHpForLevel(pkmndata.hp, level);
  const pokemonId = pkmndata.pkdx_id || pkmndata.id;
  const nextTurn = parseInt(battle?.turn || '0', 10) + 1;

  const choosingAsPlayer2 = isPlayer2Caller(battle, callerName, callerId);

  if (choosingAsPlayer2) {
    const movePromises = selectedMoves.map((move) => {
      const moveUrl = move.url || `https://pokeapi.co${move.resource_uri}`;
      return pokeapi.getMove(moveUrl).then((m) => stateMachine.addMoveNPC(m, scope));
    });
    await Promise.allSettled(movePromises);
    await stateMachine.setNpcHP(scaledHp, scope);
    await stateMachine.setNpcPkmnTypes(
      (pkmndata.types || []).map((val) => val.name),
      scope
    );

    const activeTurn = battle?.userPokemon ? battle.playerName : callerName;
    await stateMachine.updateBattle(
      {
        player2Name: callerName,
        player2Id: callerId || battle?.player2Id || '',
        npcPokemon: pkmndata.name,
        npcPokemonId: String(pokemonId),
        npcLevel: String(level),
        npcMaxHp: String(scaledHp),
        activeTurnPlayer: activeTurn,
        turn: String(nextTurn)
      },
      scope
    );

    const userHp = parseInt((await stateMachine.getUserHP(scope)) || battle?.userMaxHp || '0', 10);
    const bothReady = Boolean(battle?.userPokemon);

    await stateMachine.saveBattleScene(
      {
        turn: nextTurn,
        mode: 'pvp',
        player1Name: battle?.playerName || 'Player 1',
        player2Name: callerName,
        npcPokemon: pkmndata.name,
        npcId: String(pokemonId),
        npcLevel: level,
        npcHp: scaledHp,
        npcMaxHp: scaledHp,
        userPokemon: battle?.userPokemon || '',
        userId: battle?.userPokemonId || '',
        userLevel: parseInt(battle?.userLevel || String(DEFAULT_START_LEVEL), 10),
        userHp,
        userMaxHp: parseInt(battle?.userMaxHp || String(userHp || 100), 10),
        dialogLines: [
          `${callerName} sent out ${pkmndata.name.toUpperCase()} (Lv.${level})!`,
          bothReady
            ? `It's ${battle.playerName}'s turn to attack!`
            : `Waiting for ${battle?.playerName || 'Player 1'} to choose a Pokemon...`
        ]
      },
      scope
    );

    const activeMoves = bothReady ? await stateMachine.getUserAllowedMoves(scope) : moveNames;
    let textString = `*${callerName}* chose *${pkmndata.name}* (Lv. ${level}, ${scaledHp} HP)! It knows ${moveNames.join(', ')}.`;
    if (bothReady) {
      textString += `\nBoth trainers are ready! It's *${battle.playerName}*'s turn to attack!`;
    } else {
      textString += `\nWaiting for *${battle?.playerName || 'Player 1'}* to run \`/pkmn i choose <pokemon>\`!`;
    }

    return {
      text: textString,
      spriteUrl: getSpriteUrl(pkmndata),
      moves: activeMoves,
      turn: nextTurn,
      scope
    };
  }

  // Player 1 (or single-player User) choosing their Pokemon
  const movePromises = selectedMoves.map((move) => {
    const moveUrl = move.url || `https://pokeapi.co${move.resource_uri}`;
    return pokeapi.getMove(moveUrl).then((m) => stateMachine.addMove(m, scope));
  });

  await Promise.allSettled(movePromises);
  await stateMachine.setUserHP(scaledHp, scope);
  await stateMachine.setUserPkmnTypes(
    (pkmndata.types || []).map((val) => val.name),
    scope
  );

  await stateMachine.updateBattle(
    {
      playerName: callerName,
      player1Id: callerId || battle?.player1Id || '',
      userPokemon: pkmndata.name,
      userPokemonId: String(pokemonId),
      userLevel: String(level),
      userMaxHp: String(scaledHp),
      activeTurnPlayer: callerName,
      turn: String(nextTurn)
    },
    scope
  );

  const npcHp = parseInt((await stateMachine.getNpcHP(scope)) || battle?.npcMaxHp || '0', 10);
  const isPvp = battle?.mode === 'pvp';
  const opponentReady = Boolean(battle?.npcPokemon);

  await stateMachine.saveBattleScene(
    {
      turn: nextTurn,
      mode: battle?.mode || 'npc',
      player1Name: callerName,
      player2Name: isPvp ? battle?.player2Name || 'Player 2' : '',
      npcPokemon: battle?.npcPokemon || '',
      npcId: battle?.npcPokemonId || '',
      npcLevel: parseInt(battle?.npcLevel || String(DEFAULT_START_LEVEL), 10),
      npcHp,
      npcMaxHp: parseInt(battle?.npcMaxHp || String(npcHp || 100), 10),
      userPokemon: pkmndata.name,
      userId: String(pokemonId),
      userLevel: level,
      userHp: scaledHp,
      userMaxHp: scaledHp,
      dialogLines: [
        `Go! ${pkmndata.name.toUpperCase()} (Lv.${level})!`,
        isPvp && !opponentReady
          ? `Waiting for ${battle?.player2Name || 'opponent'} to choose a Pokemon!`
          : `Moves: ${moveNames.join(', ')}`
      ]
    },
    scope
  );

  let textString = `*${callerName}* chose *${pkmndata.name}* (Lv. ${level}). It has ${scaledHp} HP, and knows `;
  selectedMoves.forEach((move, i) => {
    if (i < selectedMoves.length - 1) {
      textString += `${move.name}, `;
    } else {
      textString += `and ${move.name}.`;
    }
  });

  if (isPvp && !opponentReady) {
    textString += `\nWaiting for *${battle?.player2Name || 'your opponent'}* to choose their Pokémon with \`/pkmn i choose <pokemon>\`!`;
  } else if (isPvp && opponentReady) {
    textString += `\nBoth trainers are ready! It's *${callerName}*'s turn to attack!`;
  }

  return {
    text: textString,
    spriteUrl: getSpriteUrl(pkmndata),
    moves: moveNames,
    turn: nextTurn,
    scope
  };
};

/*
 * Return a text string when the NPC chooses a Pokemon.
 */
module.exports.npcChoosePokemon = async function npcChoosePokemon(
  dexNo,
  npcLevel = DEFAULT_START_LEVEL,
  scope = 'default'
) {
  const pkmnData = await pokeapi.getPokemon(dexNo);
  const shuffledMoves = shuffle(pkmnData.moves || []);
  const selectedMoves = shuffledMoves.slice(0, 4);

  const movePromises = selectedMoves.map((move) => {
    const moveUrl = move.url || `https://pokeapi.co${move.resource_uri}`;
    return pokeapi.getMove(moveUrl).then((m) => stateMachine.addMoveNPC(m, scope));
  });

  const scaledHp = scaleHpForLevel(pkmnData.hp, npcLevel);
  const pokemonId = pkmnData.pkdx_id || pkmnData.id;

  await Promise.allSettled(movePromises);
  await stateMachine.setNpcHP(scaledHp, scope);
  await stateMachine.setNpcPkmnTypes(
    (pkmnData.types || []).map((val) => val.name),
    scope
  );
  await stateMachine.updateBattle(
    {
      npcPokemon: pkmnData.name,
      npcPokemonId: String(pokemonId),
      npcLevel: String(npcLevel),
      npcMaxHp: String(scaledHp),
      turn: '1'
    },
    scope
  );

  await stateMachine.saveBattleScene(
    {
      turn: 1,
      mode: 'npc',
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
    },
    scope
  );

  return {
    text: `I Choose ${pkmnData.name} (Lv. ${npcLevel})!`,
    spriteUrl: getSpriteUrl(pkmnData),
    turn: 1,
    scope
  };
};

/*
 * Start a battle (either vs NPC with `battle me`, or Player-vs-Player in a DM/channel with `battle @user` / `battle pvp`).
 */
module.exports.startBattle = async function startBattle(slackData = {}, targetArg = 'me') {
  const userName = resolveCallerName(slackData);
  const userId = resolveCallerId(slackData);
  const channelName = slackData.channel_name || slackData.channel || '#general';
  const scope = resolveScope(slackData);

  const cleanTarget = String(targetArg || 'me').trim();
  const isNpcBattle = !cleanTarget || cleanTarget.toLowerCase() === 'me' || cleanTarget.toLowerCase() === 'npc';

  if (!isNpcBattle) {
    // Player-vs-Player Battle!
    const parsedTarget = parseOpponentTarget(cleanTarget);
    const isOpenChallenge = ['pvp', 'here', 'dm', 'player', 'anyone'].includes(parsedTarget.name);
    const opponentDisplay = isOpenChallenge ? 'Opponent' : parsedTarget.name;

    await stateMachine.newBattle(userName, channelName, {
      scope,
      mode: 'pvp',
      player1Id: userId,
      player2Name: isOpenChallenge ? '' : parsedTarget.name,
      player2Id: parsedTarget.id,
      activeTurnPlayer: userName
    });

    await stateMachine.saveBattleScene(
      {
        turn: 1,
        mode: 'pvp',
        player1Name: userName,
        player2Name: opponentDisplay,
        npcPokemon: '',
        npcId: '',
        npcLevel: DEFAULT_START_LEVEL,
        npcHp: 0,
        npcMaxHp: 100,
        userPokemon: '',
        userId: '',
        userLevel: DEFAULT_START_LEVEL,
        userHp: 0,
        userMaxHp: 100,
        dialogLines: [
          `${userName} challenged ${opponentDisplay} to a PvP Battle!`,
          'Both players: type /pkmn i choose <pokemon>'
        ]
      },
      scope
    );

    const challengeWho = isOpenChallenge
      ? 'this DM/channel'
      : parsedTarget.id
      ? `<@${parsedTarget.id}>`
      : `*${parsedTarget.name}*`;

    return {
      text: `⚔️ *${userName}* challenged ${challengeWho} to a Player-vs-Player Pokémon Battle!\nBoth players, send out your Pokémon using \`/pkmn i choose <pokemon>\`!`,
      spriteUrl: '',
      turn: 1,
      scope
    };
  }

  // Standard NPC Battle
  const textString = `OK ${userName}, I'll battle you! `;
  const dexNo = Math.ceil(Math.random() * 151);

  await stateMachine.newBattle(userName, channelName, {
    scope,
    mode: 'npc',
    player1Id: userId
  });
  const pkmnChoice = await module.exports.npcChoosePokemon(dexNo, DEFAULT_START_LEVEL, scope);

  return {
    text: `${textString}\n${pkmnChoice.text}`,
    spriteUrl: pkmnChoice.spriteUrl,
    turn: pkmnChoice.turn,
    scope
  };
};

module.exports.endBattle = async function endBattle(slackData = {}) {
  const scope = resolveScope(slackData);
  return stateMachine.endBattle(scope);
};

/*
 * Handle post-win XP, level up, and evolution check for the winning trainer's Pokemon.
 */
async function handleVictoryProgression(playerName, pokemonName, currentLevel) {
  if (!playerName || !pokemonName) {
    return { message: '', evolvedTo: null };
  }

  const record = (await stateMachine.getTrainerPokemon(playerName, pokemonName)) || {
    name: pokemonName,
    level: parseInt(String(currentLevel || DEFAULT_START_LEVEL), 10),
    xp: 0,
    wins: 0,
    moves: []
  };

  const xpGained = 100;
  const newXp = record.xp + xpGained;
  const newWins = record.wins + 1;
  const newLevel = record.level + LEVELS_PER_WIN;

  let message = `\n*${playerName}'s ${pokemonName}* gained ${xpGained} XP and grew to *Lv. ${newLevel}*!`;

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
    message += `\nWhat? *${pokemonName}* is evolving!\nCongratulations! *${playerName}'s ${pokemonName}* evolved into *${evoResult.to}*!\n${evoSprite}`;
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
  const playerName = resolveCallerName(slackData);
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
 * Helper function for Player 1 using a move.
 */
async function useMoveUser(moveName, scope = 'default') {
  const moves = await stateMachine.getUserAllowedMoves(scope);
  if (!moves.includes(moveName)) {
    throw new Error("Your pokemon doesn't know that move.");
  }

  const battle = await stateMachine.getBattle(scope);
  const userLevel = parseInt(battle?.userLevel || String(DEFAULT_START_LEVEL), 10);

  const moveData = await stateMachine.getSingleMove(moveName);
  const types = await stateMachine.getNpcPkmnTypes(scope);
  const multiplier = await pokeapi.getAttackMultiplier(moveData.type, types[0], types[1]);

  const power = Number(moveData.power) || 0;
  const totalDamage = scaleDamageForLevel(power, multiplier, userLevel);
  const hpRemaining = await stateMachine.doDamageToNpc(totalDamage, scope);
  const effText = effectivenessMessage(multiplier).trim();

  if (parseInt(hpRemaining, 10) <= 0) {
    const progression = await handleVictoryProgression(
      battle?.playerName || 'Trainer',
      battle?.userPokemon,
      userLevel
    );
    await stateMachine.endBattle(scope);
    return {
      battleOver: true,
      moveName,
      moveType: moveData.type || 'normal',
      damage: totalDamage,
      hpRemaining: 0,
      progression,
      dialogLines: [
        `${(battle?.userPokemon || 'Pokemon').toUpperCase()} used ${moveName.toUpperCase()}! ${effText}`.trim(),
        `Foe ${(battle?.npcPokemon || 'Pokemon').toUpperCase()} fainted! ${battle?.playerName || 'You'} won!`,
        progression.evolvedTo
          ? `What?! ${(battle?.userPokemon || '').toUpperCase()} evolved into ${progression.evolvedTo.toUpperCase()}!`
          : `${(battle?.userPokemon || 'Pokemon').toUpperCase()} grew to Lv.${progression.newLevel || userLevel + 4}!`
      ],
      text: `*${battle?.playerName || 'You'}*'s *${battle?.userPokemon}* used *${moveName}*! ${effectivenessMessage(multiplier)}It knocked out *${battle?.npcPokemon}*! *${battle?.playerName || 'You'}* won the battle!${progression.message}`
    };
  }

  const textString = `*${battle?.playerName || 'You'}*'s *${battle?.userPokemon || 'Pokémon'}* used *${moveName}*! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving *${battle?.npcPokemon || 'opponent'}* with ${hpRemaining}HP!`;

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
 * Helper function for Player 2 (in PvP) using a specific move.
 */
async function useMovePlayer2(moveName, scope = 'default') {
  const moves = await stateMachine.getNpcAllowedMoves(scope);
  if (!moves.includes(moveName)) {
    throw new Error("Your pokemon doesn't know that move.");
  }

  const battle = await stateMachine.getBattle(scope);
  const p2Level = parseInt(battle?.npcLevel || String(DEFAULT_START_LEVEL), 10);
  const p2Name = battle?.player2Name || 'Player 2';

  const moveData = await stateMachine.getSingleMove(moveName);
  const types = await stateMachine.getUserPkmnTypes(scope);
  const multiplier = await pokeapi.getAttackMultiplier(moveData.type, types[0], types[1]);

  const power = Number(moveData.power) || 0;
  const totalDamage = scaleDamageForLevel(power, multiplier, p2Level);
  const hpRemaining = await stateMachine.doDamageToUser(totalDamage, scope);
  const effText = effectivenessMessage(multiplier).trim();

  if (parseInt(hpRemaining, 10) <= 0) {
    const progression = await handleVictoryProgression(p2Name, battle?.npcPokemon, p2Level);
    await stateMachine.endBattle(scope);
    return {
      battleOver: true,
      moveName,
      moveType: moveData.type || 'normal',
      damage: totalDamage,
      hpRemaining: 0,
      progression,
      dialogLines: [
        `${(battle?.npcPokemon || 'Pokemon').toUpperCase()} used ${moveName.toUpperCase()}! ${effText}`.trim(),
        `${(battle?.userPokemon || 'Pokemon').toUpperCase()} fainted! ${p2Name} won!`,
        progression.evolvedTo
          ? `What?! ${(battle?.npcPokemon || '').toUpperCase()} evolved into ${progression.evolvedTo.toUpperCase()}!`
          : `${(battle?.npcPokemon || 'Pokemon').toUpperCase()} grew to Lv.${progression.newLevel || p2Level + 4}!`
      ],
      text: `*${p2Name}*'s *${battle?.npcPokemon}* used *${moveName}*! ${effectivenessMessage(multiplier)}It knocked out *${battle?.userPokemon}*! *${p2Name}* won the battle!${progression.message}`
    };
  }

  const textString = `*${p2Name}*'s *${battle?.npcPokemon}* used *${moveName}*! ${effectivenessMessage(multiplier)}`;
  const textStringDmg = `It did ${totalDamage} damage, leaving *${battle?.userPokemon}* with ${hpRemaining}HP!`;

  return {
    battleOver: false,
    moveName,
    moveType: moveData.type || 'normal',
    damage: totalDamage,
    hpRemaining: parseInt(hpRemaining, 10),
    dialogLines: [
      `${(battle?.npcPokemon || 'Pokemon').toUpperCase()} used ${moveName.toUpperCase()}! ${effText}`.trim(),
      multiplier === 0 ? "It doesn't have an effect." : `Dealt ${totalDamage} dmg! (${hpRemaining} HP left)`
    ],
    text: multiplier === 0 ? textString : textString + textStringDmg
  };
}

/*
 * Helper function for the AI NPC using a random move.
 */
async function useMoveNpc(scope = 'default') {
  const moves = await stateMachine.getNpcAllowedMoves(scope);
  if (!moves || moves.length === 0) {
    throw new Error('NPC has no moves available.');
  }

  const battle = await stateMachine.getBattle(scope);
  const npcLevel = parseInt(battle?.npcLevel || String(DEFAULT_START_LEVEL), 10);

  const chosenMove = moves[Math.floor(Math.random() * moves.length)];
  const moveData = await stateMachine.getSingleMove(chosenMove);
  const types = await stateMachine.getUserPkmnTypes(scope);
  const multiplier = await pokeapi.getAttackMultiplier(moveData.type, types[0], types[1]);

  const power = Number(moveData.power) || 0;
  const totalDamage = scaleDamageForLevel(power, multiplier, npcLevel);
  const hpRemaining = await stateMachine.doDamageToUser(totalDamage, scope);
  const effText = effectivenessMessage(multiplier).trim();

  if (parseInt(hpRemaining, 10) <= 0) {
    await stateMachine.endBattle(scope);
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
 * Execute a move in either Single-Player (vs NPC) or Player-vs-Player (PvP) mode!
 */
module.exports.useMove = async function useMove(moveName, slackData = {}) {
  const scope = resolveScope(slackData);
  const battleBefore = await stateMachine.getBattle(scope);
  if (!battleBefore) {
    throw new Error('No active battle in this channel/DM! Start one with `/pkmn battle me` or `/pkmn battle @user`.');
  }

  const prevNpcHp = parseInt((await stateMachine.getNpcHP(scope)) || battleBefore.npcMaxHp || '100', 10);
  const prevUserHp = parseInt((await stateMachine.getUserHP(scope)) || battleBefore.userMaxHp || '100', 10);
  const nextTurn = parseInt(battleBefore.turn || '1', 10) + 1;

  // Handle Player-vs-Player (PvP) turn-based combat
  if (battleBefore.mode === 'pvp') {
    if (!battleBefore.userPokemon || !battleBefore.npcPokemon) {
      throw new Error('Both players must choose a Pokémon first with `/pkmn i choose <pokemon>`!');
    }

    const callerName = resolveCallerName(slackData);
    const callerId = resolveCallerId(slackData);
    const callerIsP2 = isPlayer2Caller(battleBefore, callerName, callerId);
    const expectedTurn = (battleBefore.activeTurnPlayer || battleBefore.playerName).toLowerCase();

    if (callerName.toLowerCase() !== expectedTurn) {
      throw new Error(`Hold on *${callerName}*! It's *${battleBefore.activeTurnPlayer}*'s turn to attack!`);
    }

    if (!callerIsP2) {
      // Player 1 attacks Player 2
      const p1Result = await useMoveUser(moveName, scope);
      const nextActivePlayer = battleBefore.player2Name || 'Player 2';

      if (!p1Result.battleOver) {
        await stateMachine.updateBattle(
          {
            turn: String(nextTurn),
            activeTurnPlayer: nextActivePlayer
          },
          scope
        );
      }

      const evolvedId = p1Result.progression?.evolvedId;
      const evolvedName = p1Result.progression?.evolvedTo;
      const finalUserLevel = p1Result.progression?.newLevel || parseInt(battleBefore.userLevel || '12', 10);

      await stateMachine.saveBattleScene(
        {
          turn: nextTurn,
          mode: 'pvp',
          player1Name: battleBefore.playerName,
          player2Name: battleBefore.player2Name,
          npcPokemon: battleBefore.npcPokemon,
          npcId: battleBefore.npcPokemonId,
          npcLevel: parseInt(battleBefore.npcLevel || '12', 10),
          prevNpcHp,
          npcHp: p1Result.hpRemaining,
          npcMaxHp: parseInt(battleBefore.npcMaxHp || String(prevNpcHp), 10),
          userPokemon: evolvedName || battleBefore.userPokemon,
          userId: evolvedId || battleBefore.userPokemonId,
          userLevel: finalUserLevel,
          prevUserHp,
          userHp: prevUserHp,
          userMaxHp: parseInt(battleBefore.userMaxHp || String(prevUserHp), 10),
          userMove: p1Result.moveName,
          userMoveType: p1Result.moveType,
          userDialogLines: p1Result.dialogLines,
          dialogLines: p1Result.battleOver
            ? p1Result.dialogLines
            : [...p1Result.dialogLines, `Now it's ${nextActivePlayer}'s turn!`]
        },
        scope
      );

      const nextMoves = p1Result.battleOver ? [] : await stateMachine.getNpcAllowedMoves(scope);
      const turnPrompt = p1Result.battleOver ? '' : `\n👉 It's now *${nextActivePlayer}*'s turn!`;
      return {
        text: `${p1Result.text}${turnPrompt}`,
        moves: nextMoves,
        turn: nextTurn,
        scope
      };
    }

    // Player 2 attacks Player 1
    const p2Result = await useMovePlayer2(moveName, scope);
    const nextActivePlayer = battleBefore.playerName || 'Player 1';

    if (!p2Result.battleOver) {
      await stateMachine.updateBattle(
        {
          turn: String(nextTurn),
          activeTurnPlayer: nextActivePlayer
        },
        scope
      );
    }

    const evolvedId = p2Result.progression?.evolvedId;
    const evolvedName = p2Result.progression?.evolvedTo;
    const finalNpcLevel = p2Result.progression?.newLevel || parseInt(battleBefore.npcLevel || '12', 10);

    await stateMachine.saveBattleScene(
      {
        turn: nextTurn,
        mode: 'pvp',
        player1Name: battleBefore.playerName,
        player2Name: battleBefore.player2Name,
        npcPokemon: evolvedName || battleBefore.npcPokemon,
        npcId: evolvedId || battleBefore.npcPokemonId,
        npcLevel: finalNpcLevel,
        prevNpcHp,
        npcHp: prevNpcHp,
        npcMaxHp: parseInt(battleBefore.npcMaxHp || String(prevNpcHp), 10),
        userPokemon: battleBefore.userPokemon,
        userId: battleBefore.userPokemonId,
        userLevel: parseInt(battleBefore.userLevel || '12', 10),
        prevUserHp,
        userHp: p2Result.hpRemaining,
        userMaxHp: parseInt(battleBefore.userMaxHp || String(prevUserHp), 10),
        npcMove: p2Result.moveName,
        npcMoveType: p2Result.moveType,
        npcDialogLines: p2Result.dialogLines,
        dialogLines: p2Result.battleOver
          ? p2Result.dialogLines
          : [...p2Result.dialogLines, `Now it's ${nextActivePlayer}'s turn!`]
      },
      scope
    );

    const nextMoves = p2Result.battleOver ? [] : await stateMachine.getUserAllowedMoves(scope);
    const turnPrompt = p2Result.battleOver ? '' : `\n👉 It's now *${nextActivePlayer}*'s turn!`;
    return {
      text: `${p2Result.text}${turnPrompt}`,
      moves: nextMoves,
      turn: nextTurn,
      scope
    };
  }

  // Standard Single-Player vs NPC Mode
  const userResult = await useMoveUser(moveName, scope);
  if (userResult.battleOver) {
    const evolvedId = userResult.progression?.evolvedId;
    const evolvedName = userResult.progression?.evolvedTo;
    const finalUserLevel = userResult.progression?.newLevel || parseInt(battleBefore.userLevel || '12', 10);

    await stateMachine.saveBattleScene(
      {
        turn: nextTurn,
        mode: 'npc',
        npcPokemon: battleBefore.npcPokemon || '',
        npcId: battleBefore.npcPokemonId || '',
        npcLevel: parseInt(battleBefore.npcLevel || '12', 10),
        prevNpcHp,
        npcHp: 0,
        npcMaxHp: parseInt(battleBefore.npcMaxHp || String(prevNpcHp), 10),
        userPokemon: evolvedName || battleBefore.userPokemon || '',
        userId: evolvedId || battleBefore.userPokemonId || '',
        userLevel: finalUserLevel,
        prevUserHp,
        userHp: prevUserHp,
        userMaxHp: parseInt(battleBefore.userMaxHp || String(prevUserHp), 10),
        userMove: userResult.moveName,
        userMoveType: userResult.moveType,
        userDialogLines: userResult.dialogLines,
        dialogLines: userResult.dialogLines
      },
      scope
    );
    return {
      text: userResult.text,
      moves: [],
      turn: nextTurn,
      scope
    };
  }

  const npcResult = await useMoveNpc(scope);
  if (!npcResult.battleOver) {
    await stateMachine.updateBattle({ turn: String(nextTurn) }, scope);
  }

  await stateMachine.saveBattleScene(
    {
      turn: nextTurn,
      mode: 'npc',
      npcPokemon: battleBefore.npcPokemon || '',
      npcId: battleBefore.npcPokemonId || '',
      npcLevel: parseInt(battleBefore.npcLevel || '12', 10),
      prevNpcHp,
      npcHp: userResult.hpRemaining,
      npcMaxHp: parseInt(battleBefore.npcMaxHp || String(prevNpcHp), 10),
      userPokemon: battleBefore.userPokemon || '',
      userId: battleBefore.userPokemonId || '',
      userLevel: parseInt(battleBefore.userLevel || '12', 10),
      prevUserHp,
      userHp: npcResult.hpRemaining,
      userMaxHp: parseInt(battleBefore.userMaxHp || String(prevUserHp), 10),
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
          ? `${(battleBefore.userPokemon || 'Pokemon').toUpperCase()} fainted! You Lost!`
          : `HP: You ${npcResult.hpRemaining}/${battleBefore.userMaxHp || prevUserHp} | Foe ${userResult.hpRemaining}/${battleBefore.npcMaxHp || prevNpcHp}`
      ]
    },
    scope
  );

  const allowedMoves = npcResult.battleOver ? [] : await stateMachine.getUserAllowedMoves(scope);
  return {
    text: `${userResult.text}\n${npcResult.text}`,
    moves: allowedMoves,
    turn: nextTurn,
    scope
  };
};
