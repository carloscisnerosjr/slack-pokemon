const { createClient } = require('redis');
const moves = require('./move-types.js');

const redisUrl = process.env.REDIS_URL || process.env.REDISTOGO_URL;

class InMemoryRedis {
  constructor() {
    this.store = new Map();
  }

  async exists(key) {
    return this.store.has(key) ? 1 : 0;
  }

  async hSet(key, obj) {
    const current = this.store.get(key) || {};
    const updated = { ...current };
    for (const [k, v] of Object.entries(obj)) {
      updated[k] = String(v ?? '');
    }
    this.store.set(key, updated);
    return Object.keys(obj).length;
  }

  async hGetAll(key) {
    const val = this.store.get(key);
    return val ? { ...val } : {};
  }

  async del(keys) {
    const keyList = Array.isArray(keys) ? keys : [keys];
    let removed = 0;
    for (const k of keyList) {
      if (this.store.delete(k)) removed += 1;
    }
    return removed;
  }

  async sAdd(key, members) {
    const set = this.store.get(key) instanceof Set ? this.store.get(key) : new Set();
    const list = Array.isArray(members) ? members : [members];
    let added = 0;
    for (const item of list) {
      if (item !== undefined && item !== null) {
        const str = String(item);
        if (!set.has(str)) {
          set.add(str);
          added += 1;
        }
      }
    }
    this.store.set(key, set);
    return added;
  }

  async sMembers(key) {
    const set = this.store.get(key);
    return set instanceof Set ? Array.from(set) : [];
  }

  async sRem(key, member) {
    const set = this.store.get(key);
    if (set instanceof Set) {
      return set.delete(String(member)) ? 1 : 0;
    }
    return 0;
  }

  async set(key, value) {
    this.store.set(key, String(value));
    return 'OK';
  }

  async get(key) {
    const val = this.store.get(key);
    return val !== undefined ? String(val) : null;
  }

  async decrBy(key, decrement) {
    const current = parseInt(this.store.get(key) || '0', 10);
    const next = current - Number(decrement || 0);
    this.store.set(key, String(next));
    return next;
  }
}

let activeClient = null;
let connectingPromise = null;

async function getClient() {
  if (activeClient) {
    return activeClient;
  }
  if (connectingPromise) {
    return connectingPromise;
  }

  connectingPromise = (async () => {
    if (process.env.USE_IN_MEMORY_STORE === 'true') {
      activeClient = new InMemoryRedis();
      return activeClient;
    }

    const client = createClient({
      url: redisUrl || 'redis://127.0.0.1:6379',
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: false
      }
    });

    client.on('error', () => {
      // Handled during connection fallback
    });

    try {
      await client.connect();
      activeClient = client;
    } catch {
      console.warn('Redis server not reachable; falling back to in-memory store.');
      activeClient = new InMemoryRedis();
    }
    return activeClient;
  })();

  return connectingPromise;
}

function normScope(scope) {
  return String(scope || 'default').trim().toLowerCase() || 'default';
}

function battleKey(scope, suffix = 'currentBattle') {
  const s = normScope(scope);
  return s === 'default' ? suffix : `battle:${s}:${suffix}`;
}

module.exports = {};

module.exports.newBattle = async function newBattle(
  playerName,
  channel,
  options = {}
) {
  const redis = await getClient();
  const scope = normScope(options.scope || channel);
  const key = battleKey(scope, 'currentBattle');
  const exists = await redis.exists(key);
  if (!exists) {
    return redis.hSet(key, {
      scope,
      mode: String(options.mode || 'npc'), // 'npc' | 'pvp'
      playerName: String(playerName || 'Trainer'),
      player1Id: String(options.player1Id || ''),
      player2Name: String(options.player2Name || ''),
      player2Id: String(options.player2Id || ''),
      activeTurnPlayer: String(options.activeTurnPlayer || playerName || ''),
      channel: String(channel || '#general'),
      userPokemon: '',
      userPokemonId: '',
      npcPokemon: '',
      npcPokemonId: '',
      userLevel: '12',
      npcLevel: '12',
      userMaxHp: '100',
      npcMaxHp: '100',
      turn: '0'
    });
  }
  throw new Error('Battle already in progress in this channel/DM! Use `/pkmn end battle` to reset.');
};

module.exports.updateBattle = async function updateBattle(fields, scope = 'default') {
  const redis = await getClient();
  return redis.hSet(battleKey(scope, 'currentBattle'), fields);
};

module.exports.getBattle = async function getBattle(scope = 'default') {
  const redis = await getClient();
  const battle = await redis.hGetAll(battleKey(scope, 'currentBattle'));
  return Object.keys(battle).length > 0 ? battle : null;
};

module.exports.saveBattleScene = async function saveBattleScene(sceneData, scope = 'default') {
  const redis = await getClient();
  await redis.set(battleKey(scope, 'lastScene'), JSON.stringify(sceneData));
};

module.exports.getBattleScene = async function getBattleScene(scope = 'default') {
  const redis = await getClient();
  const raw = await redis.get(battleKey(scope, 'lastScene'));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

module.exports.getTrainerPokemon = async function getTrainerPokemon(playerName, pokemonName) {
  const redis = await getClient();
  const key = `trainer:${String(playerName || 'trainer').toLowerCase()}:pokemon:${String(pokemonName).toLowerCase()}`;
  const data = await redis.hGetAll(key);
  if (!data || Object.keys(data).length === 0) {
    return null;
  }
  return {
    name: data.name,
    level: parseInt(data.level || '5', 10),
    xp: parseInt(data.xp || '0', 10),
    wins: parseInt(data.wins || '0', 10),
    moves: data.moves ? JSON.parse(data.moves) : []
  };
};

module.exports.saveTrainerPokemon = async function saveTrainerPokemon(playerName, pokemonData) {
  const redis = await getClient();
  const cleanPlayer = String(playerName || 'trainer').toLowerCase();
  const cleanName = String(pokemonData.name).toLowerCase();
  const key = `trainer:${cleanPlayer}:pokemon:${cleanName}`;
  await redis.sAdd(`trainer:${cleanPlayer}:roster`, cleanName);
  return redis.hSet(key, {
    name: cleanName,
    level: String(pokemonData.level ?? 5),
    xp: String(pokemonData.xp ?? 0),
    wins: String(pokemonData.wins ?? 0),
    moves: JSON.stringify(pokemonData.moves || [])
  });
};

module.exports.evolveTrainerPokemon = async function evolveTrainerPokemon(
  playerName,
  oldName,
  newPokemonData
) {
  const redis = await getClient();
  const cleanPlayer = String(playerName || 'trainer').toLowerCase();
  const cleanOld = String(oldName).toLowerCase();
  const oldKey = `trainer:${cleanPlayer}:pokemon:${cleanOld}`;
  await redis.del(oldKey);
  if (typeof redis.sRem === 'function') {
    await redis.sRem(`trainer:${cleanPlayer}:roster`, cleanOld);
  }
  return module.exports.saveTrainerPokemon(cleanPlayer, newPokemonData);
};

module.exports.getTrainerRoster = async function getTrainerRoster(playerName) {
  const redis = await getClient();
  const cleanPlayer = String(playerName || 'trainer').toLowerCase();
  const names = await redis.sMembers(`trainer:${cleanPlayer}:roster`);
  const roster = [];
  for (const name of names) {
    const pkmn = await module.exports.getTrainerPokemon(cleanPlayer, name);
    if (pkmn) {
      roster.push(pkmn);
    }
  }
  return roster;
};

module.exports.endBattle = async function endBattle(scope = 'default') {
  const redis = await getClient();
  return redis.del([
    battleKey(scope, 'currentBattle'),
    battleKey(scope, 'user:allowedMoves'),
    battleKey(scope, 'npc:allowedMoves'),
    battleKey(scope, 'npc:hp'),
    battleKey(scope, 'user:hp'),
    battleKey(scope, 'user:pkmnTypes'),
    battleKey(scope, 'npc:pkmnTypes')
  ]);
};

module.exports.addMove = async function addMove(data, scope = 'default') {
  const redis = await getClient();
  const moveName = data.name.toLowerCase();
  const moveType = (data.type || moves.getMoveType(moveName)).toLowerCase();
  await redis.sAdd(battleKey(scope, 'user:allowedMoves'), moveName);
  return redis.hSet(`move:${moveName}`, {
    power: String(data.power ?? 0),
    type: moveType
  });
};

module.exports.addMoveNPC = async function addMoveNPC(data, scope = 'default') {
  const redis = await getClient();
  const moveName = data.name.toLowerCase();
  const moveType = (data.type || moves.getMoveType(moveName)).toLowerCase();
  await redis.sAdd(battleKey(scope, 'npc:allowedMoves'), moveName);
  return redis.hSet(`move:${moveName}`, {
    power: String(data.power ?? 0),
    type: moveType
  });
};

module.exports.setUserPkmnTypes = async function setUserPkmnTypes(typesArray, scope = 'default') {
  const redis = await getClient();
  const validTypes = (typesArray || []).filter(Boolean).map((t) => String(t).toLowerCase());
  await redis.del(battleKey(scope, 'user:pkmnTypes'));
  if (validTypes.length === 0) return 0;
  return redis.sAdd(battleKey(scope, 'user:pkmnTypes'), validTypes);
};

module.exports.setNpcPkmnTypes = async function setNpcPkmnTypes(typesArray, scope = 'default') {
  const redis = await getClient();
  const validTypes = (typesArray || []).filter(Boolean).map((t) => String(t).toLowerCase());
  await redis.del(battleKey(scope, 'npc:pkmnTypes'));
  if (validTypes.length === 0) return 0;
  return redis.sAdd(battleKey(scope, 'npc:pkmnTypes'), validTypes);
};

module.exports.getUserPkmnTypes = async function getUserPkmnTypes(scope = 'default') {
  const redis = await getClient();
  return redis.sMembers(battleKey(scope, 'user:pkmnTypes'));
};

module.exports.getNpcPkmnTypes = async function getNpcPkmnTypes(scope = 'default') {
  const redis = await getClient();
  return redis.sMembers(battleKey(scope, 'npc:pkmnTypes'));
};

module.exports.getUserAllowedMoves = async function getUserAllowedMoves(scope = 'default') {
  const redis = await getClient();
  return redis.sMembers(battleKey(scope, 'user:allowedMoves'));
};

module.exports.getNpcAllowedMoves = async function getNpcAllowedMoves(scope = 'default') {
  const redis = await getClient();
  return redis.sMembers(battleKey(scope, 'npc:allowedMoves'));
};

module.exports.getSingleMove = async function getSingleMove(moveName) {
  const redis = await getClient();
  return redis.hGetAll(`move:${moveName.toLowerCase()}`);
};

module.exports.setNpcHP = async function setNpcHP(hp, scope = 'default') {
  const redis = await getClient();
  return redis.set(battleKey(scope, 'npc:hp'), String(hp));
};

module.exports.getNpcHP = async function getNpcHP(scope = 'default') {
  const redis = await getClient();
  return redis.get(battleKey(scope, 'npc:hp'));
};

module.exports.setUserHP = async function setUserHP(hp, scope = 'default') {
  const redis = await getClient();
  return redis.set(battleKey(scope, 'user:hp'), String(hp));
};

module.exports.getUserHP = async function getUserHP(scope = 'default') {
  const redis = await getClient();
  return redis.get(battleKey(scope, 'user:hp'));
};

module.exports.doDamageToUser = async function doDamageToUser(damage, scope = 'default') {
  const redis = await getClient();
  return redis.decrBy(battleKey(scope, 'user:hp'), Math.max(0, Number(damage) || 0));
};

module.exports.doDamageToNpc = async function doDamageToNpc(damage, scope = 'default') {
  const redis = await getClient();
  return redis.decrBy(battleKey(scope, 'npc:hp'), Math.max(0, Number(damage) || 0));
};
