const fs = require('node:fs');
const path = require('node:path');

let cachedMoves = null;

function loadMoveTypes() {
  if (cachedMoves) {
    return cachedMoves;
  }
  const filePath = path.join(__dirname, 'supplementary_json', 'move_types.json');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  cachedMoves = new Map();
  for (const entry of raw) {
    const [key, val] = Object.entries(entry)[0] || [];
    if (key && val) {
      cachedMoves.set(key.toLowerCase(), val.toLowerCase());
    }
  }
  return cachedMoves;
}

/*
 * Get the type of a move from supplementary_json/move_types.json as a fallback
 * when not already provided by PokeAPI v2.
 */
module.exports.getMoveType = function getMoveType(moveName) {
  const normalized = String(moveName).toLowerCase().replaceAll('-', ' ');
  const moveMap = loadMoveTypes();
  return moveMap.get(normalized) || moveMap.get(String(moveName).toLowerCase()) || ' ';
};
