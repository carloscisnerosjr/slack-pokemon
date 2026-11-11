const POKEAPI_BASE = 'https://pokeapi.co/api/v2';

const TYPES_ARRAY = [
  'normal', // 1
  'fighting',
  'flying',
  'poison',
  'ground',
  'rock',
  'bug',
  'ghost',
  'steel',
  'fire',
  'water',
  'grass',
  'electric',
  'psychic',
  'ice',
  'dragon',
  'dark',
  'fairy' // 18
];

async function fetchJson(url, errorMessage) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(errorMessage);
  }
  return response.json();
}

function normalizeUrl(url) {
  if (!url) {
    throw new Error('Missing URL');
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return url
      .replace(/^http:\/\/pokeapi\.co\/api\/v1\//i, `${POKEAPI_BASE}/`)
      .replace(/^http:\/\/pokeapi\.co\//i, 'https://pokeapi.co/');
  }
  const cleanPath = url.replace(/^\/?api\/v1\//i, '/api/v2/');
  return `https://pokeapi.co${cleanPath.startsWith('/') ? '' : '/'}${cleanPath}`;
}

module.exports = {};

module.exports.getPokemon = async function getPokemon(nameOrId) {
  const id = String(nameOrId).trim().toLowerCase();
  const data = await fetchJson(
    `${POKEAPI_BASE}/pokemon/${encodeURIComponent(id)}`,
    'Error Getting Pokemon'
  );

  // Normalize PokeAPI v2 response to also include v1-compatible fields
  const hpStat = Array.isArray(data.stats)
    ? data.stats.find((s) => s.stat && s.stat.name === 'hp')
    : null;
  const hp = hpStat ? hpStat.base_stat : data.hp ?? 100;

  const types = Array.isArray(data.types)
    ? data.types.map((t) =>
        typeof t.name === 'string'
          ? { name: t.name.toLowerCase() }
          : { name: t.type.name.toLowerCase() }
      )
    : [];

  const moves = Array.isArray(data.moves)
    ? data.moves.map((m) => {
        if (m.move) {
          return {
            name: m.move.name,
            url: m.move.url,
            resource_uri: new URL(m.move.url).pathname
          };
        }
        return m;
      })
    : [];

  const animatedSprite =
    data.sprites?.versions?.['generation-v']?.['black-white']?.animated?.front_default;
  const spriteUrl =
    animatedSprite ||
    data.sprites?.front_default ||
    `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${data.id}.png`;

  return {
    ...data,
    pkdx_id: data.id ?? data.pkdx_id,
    hp,
    types,
    moves,
    spriteUrl
  };
};

module.exports.getSprite = async function getSprite(url) {
  return fetchJson(normalizeUrl(url), 'Error Getting Sprite');
};

module.exports.getMove = async function getMove(urlOrName) {
  const targetUrl =
    urlOrName.includes('/') || urlOrName.startsWith('http')
      ? normalizeUrl(urlOrName)
      : `${POKEAPI_BASE}/move/${encodeURIComponent(String(urlOrName).toLowerCase())}`;

  const data = await fetchJson(targetUrl, 'Error Getting Move');
  return {
    ...data,
    name: data.name.toLowerCase(),
    power: data.power ?? 0,
    type: typeof data.type === 'string' ? data.type.toLowerCase() : data.type?.name?.toLowerCase()
  };
};

/*
 * Calculates the effectiveness of one move on a pokemon with 1 or 2 types.
 * Supports PokeAPI v2 damage_relations (and legacy v1 arrays if mocked).
 */
module.exports.getAttackMultiplier = async function getAttackMultiplier(
  offensive,
  defensive1,
  defensive2
) {
  const cleanOffensive = String(offensive || '').trim().toLowerCase();
  if (!cleanOffensive) {
    return 1;
  }

  const typeIndex = TYPES_ARRAY.indexOf(cleanOffensive);
  const typeIdentifier = typeIndex !== -1 ? typeIndex + 1 : cleanOffensive;

  const data = await fetchJson(
    `${POKEAPI_BASE}/type/${typeIdentifier}`,
    'Error accessing API while getting type.'
  );

  const relations = data.damage_relations;
  const ineffective = (relations ? relations.half_damage_to : data.ineffective || []).map((val) =>
    val.name.toLowerCase()
  );
  const noeffect = (relations ? relations.no_damage_to : data.no_effect || []).map((val) =>
    val.name.toLowerCase()
  );
  const supereffective = (relations ? relations.double_damage_to : data.super_effective || []).map(
    (val) => val.name.toLowerCase()
  );

  let multiplier = 1;
  [defensive1, defensive2].forEach((type) => {
    if (!type) return;
    const cleanDef = String(type).toLowerCase();
    if (ineffective.includes(cleanDef)) {
      multiplier *= 0.5;
    }
    if (noeffect.includes(cleanDef)) {
      multiplier *= 0;
    }
    if (supereffective.includes(cleanDef)) {
      multiplier *= 2;
    }
  });

  return multiplier;
};

/*
 * Check if a Pokemon should evolve at `currentLevel`.
 * Traverses PokeAPI's evolution_chain for the given species and returns
 * the evolved Pokemon data if the level threshold is met, or null otherwise.
 */
module.exports.checkEvolution = async function checkEvolution(pokemonName, currentLevel) {
  try {
    const cleanName = String(pokemonName).trim().toLowerCase();
    const species = await fetchJson(
      `${POKEAPI_BASE}/pokemon-species/${encodeURIComponent(cleanName)}`,
      'Error Getting Species'
    );
    if (!species.evolution_chain?.url) {
      return null;
    }

    const evoChainData = await fetchJson(species.evolution_chain.url, 'Error Getting Evolution Chain');

    function findNodeAndDepth(node, targetName, depth = 0) {
      if (node.species?.name?.toLowerCase() === targetName) {
        return { node, depth };
      }
      for (const child of node.evolves_to || []) {
        const found = findNodeAndDepth(child, targetName, depth + 1);
        if (found) return found;
      }
      return null;
    }

    const match = findNodeAndDepth(evoChainData.chain, species.name.toLowerCase());
    if (!match || !match.node.evolves_to || match.node.evolves_to.length === 0) {
      return null;
    }

    // Pick a candidate evolution (random if branched like Eevee)
    const candidates = match.node.evolves_to;
    const nextNode = candidates[Math.floor(Math.random() * candidates.length)];
    const details = (nextNode.evolution_details && nextNode.evolution_details[0]) || {};

    // Use PokeAPI's min_level if present; for stone/trade/happiness evolutions, default to Lv. 16 (stage 1) or Lv. 32 (stage 2)
    const defaultThreshold = match.depth === 0 ? 16 : 32;
    const requiredLevel = details.min_level || defaultThreshold;

    if (Number(currentLevel) >= requiredLevel) {
      const evolvedPokemon = await module.exports.getPokemon(nextNode.species.name);
      return {
        from: cleanName,
        to: evolvedPokemon.name,
        requiredLevel,
        pokemon: evolvedPokemon
      };
    }

    return {
      from: cleanName,
      to: null,
      nextEvolution: nextNode.species.name,
      requiredLevel
    };
  } catch {
    return null;
  }
};

