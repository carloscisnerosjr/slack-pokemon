const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { GIFEncoder, quantize, applyPalette } = require('gifenc');

const WIDTH = 640;
const HEIGHT = 360;

// Cache fetched sprite images in memory to keep rendering fast
const spriteCache = new Map();

async function fetchSpriteImage(pokemonId, isBack = false) {
  if (!pokemonId) return null;
  const cacheKey = `${pokemonId}:${isBack ? 'back' : 'front'}`;
  if (spriteCache.has(cacheKey)) {
    return spriteCache.get(cacheKey);
  }

  const urls = isBack
    ? [
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/back/${pokemonId}.png`,
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`
      ]
    : [
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${pokemonId}.png`
      ];

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        const arrayBuf = await response.arrayBuffer();
        const img = await loadImage(Buffer.from(arrayBuf));
        spriteCache.set(cacheKey, img);
        return img;
      }
    } catch {
      // Try fallback URL
    }
  }
  return null;
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function getHpColor(ratio) {
  if (ratio > 0.5) return '#38d848'; // Green
  if (ratio > 0.2) return '#f8c830'; // Yellow
  return '#f84038'; // Red
}

function getVfxStyle(moveName = '', moveType = 'normal') {
  const name = String(moveName).toLowerCase();
  const type = String(moveType).toLowerCase();

  if (
    type === 'electric' ||
    name.includes('thunder') ||
    name.includes('shock') ||
    name.includes('spark') ||
    name.includes('volt')
  ) {
    return {
      archetype: 'lightning',
      skyTint: 'rgba(15, 20, 45, 0.55)',
      hitTint: 'rgba(255, 255, 100, 0.85)',
      primary: '#ffe820',
      secondary: '#ffffff'
    };
  }

  if (
    type === 'fire' ||
    name.includes('flame') ||
    name.includes('fire') ||
    name.includes('ember') ||
    name.includes('blaze') ||
    name.includes('heat')
  ) {
    return {
      archetype: 'fire',
      skyTint: 'rgba(255, 70, 15, 0.20)',
      hitTint: 'rgba(255, 90, 0, 0.78)',
      primary: '#ff5018',
      secondary: '#ffd840'
    };
  }

  if (
    name.includes('beam') ||
    name.includes('hydro') ||
    name.includes('pump') ||
    name.includes('surf') ||
    name.includes('pulse') ||
    name.includes('cannon') ||
    name.includes('psychic') ||
    name.includes('blast') ||
    type === 'water' ||
    type === 'ice' ||
    type === 'psychic' ||
    type === 'dragon' ||
    type === 'fairy'
  ) {
    const beamPalettes = {
      water: { primary: '#2090ff', secondary: '#90e8ff', sky: 'rgba(0, 80, 200, 0.22)' },
      ice: { primary: '#40c8ff', secondary: '#ffffff', sky: 'rgba(60, 180, 255, 0.22)' },
      psychic: { primary: '#ff48b0', secondary: '#ffb8f0', sky: 'rgba(140, 20, 160, 0.28)' },
      dragon: { primary: '#6848ff', secondary: '#ff6040', sky: 'rgba(40, 20, 120, 0.32)' },
      fairy: { primary: '#ff78c8', secondary: '#fff0f8', sky: 'rgba(220, 80, 160, 0.22)' },
      grass: { primary: '#38d850', secondary: '#d8ff80', sky: 'rgba(40, 180, 60, 0.20)' }
    };
    const pal = beamPalettes[type] || {
      primary: '#40b8ff',
      secondary: '#ffffff',
      sky: 'rgba(40, 120, 220, 0.22)'
    };
    return {
      archetype: 'beam',
      skyTint: pal.sky,
      hitTint: 'rgba(140, 235, 255, 0.80)',
      primary: pal.primary,
      secondary: pal.secondary
    };
  }

  return {
    archetype: 'slash',
    skyTint: 'rgba(20, 25, 35, 0.22)',
    hitTint: 'rgba(255, 255, 255, 0.82)',
    primary: type === 'grass' ? '#38e050' : type === 'ghost' || type === 'dark' ? '#a050ff' : '#ff3838',
    secondary: '#ffffff'
  };
}

function drawArenaBackground(ctx, skyTint = null) {
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 260);
  skyGrad.addColorStop(0, '#68b8f8');
  skyGrad.addColorStop(0.6, '#b8e8f8');
  skyGrad.addColorStop(1, '#78d080');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, WIDTH, 265);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  for (let y = 0; y < 260; y += 6) {
    ctx.fillRect(0, y, WIDTH, 2);
  }

  ctx.fillStyle = '#48a860';
  ctx.fillRect(0, 172, WIDTH, 93);

  ctx.fillStyle = '#60c070';
  ctx.fillRect(0, 180, WIDTH, 85);

  if (skyTint) {
    ctx.fillStyle = skyTint;
    ctx.fillRect(0, 0, WIDTH, 265);
  }

  // Opponent grassy platform (top-right)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(465, 162, 118, 34, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#307840';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(465, 156, 112, 30, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#90e880';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#48a048';
  ctx.stroke();
  ctx.restore();

  // Player grassy platform (bottom-left)
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(175, 252, 138, 38, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#307840';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(175, 245, 130, 33, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#90e880';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#48a048';
  ctx.stroke();
  ctx.restore();
}

function drawPokeballWaiting(ctx, cx, cy) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fillStyle = '#f03030';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#202020';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawSpriteFlash(ctx, img, x, y, size, tintColor) {
  const off = createCanvas(size, size);
  const octx = off.getContext('2d');
  octx.imageSmoothingEnabled = false;
  octx.drawImage(img, 0, 0, size, size);
  octx.globalCompositeOperation = 'source-atop';
  octx.fillStyle = tintColor;
  octx.fillRect(0, 0, size, size);
  ctx.drawImage(off, x, y, size, size);
}

function drawStatusHud(ctx, { x, y, name, trainerName, level, hp, maxHp, isPlayer, xpRatio = 0.35 }) {
  const w = 256;
  const h = 80;

  drawRoundedRect(ctx, x + 4, y + 4, w, h, 10);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fill();

  drawRoundedRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#303840';
  ctx.fill();

  drawRoundedRect(ctx, x + 4, y + 4, w - 8, h - 8, 7);
  ctx.fillStyle = '#f8f8d8';
  ctx.fill();

  const rawName = String(name || '???').toUpperCase();
  const displayName = trainerName
    ? `${rawName} (${String(trainerName).slice(0, 8)})`
    : rawName;

  ctx.fillStyle = '#282828';
  ctx.font = 'bold 16px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  ctx.fillText(displayName.slice(0, 17), x + 16, y + 26);

  ctx.font = 'bold 15px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  const lvlText = `Lv${level || 12}`;
  const lvlWidth = ctx.measureText(lvlText).width;
  ctx.fillText(lvlText, x + w - 18 - lvlWidth, y + 26);

  const labelX = x + 16;
  const barX = x + 48;
  const barY = y + 36;
  const barW = 190;
  const barH = 14;

  ctx.fillStyle = '#e88020';
  ctx.font = 'bold 14px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  ctx.fillText('HP', labelX, barY + 12);

  drawRoundedRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = '#303840';
  ctx.fill();

  ctx.fillStyle = '#202820';
  ctx.fillRect(barX + 2, barY + 2, barW - 4, barH - 4);

  const safeMax = Math.max(1, Number(maxHp) || 100);
  const safeHp = Math.max(0, Math.min(safeMax, Number(hp) || 0));
  const ratio = safeHp / safeMax;
  const fillW = Math.round((barW - 4) * ratio);

  if (fillW > 0) {
    ctx.fillStyle = getHpColor(ratio);
    ctx.fillRect(barX + 2, barY + 2, fillW, barH - 4);
  }

  ctx.fillStyle = '#282828';
  ctx.font = 'bold 13px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  const hpNumbers = `${Math.round(safeHp)} / ${Math.round(safeMax)} HP`;
  const numW = ctx.measureText(hpNumbers).width;
  ctx.fillText(hpNumbers, x + w - 18 - numW, y + 66);

  if (isPlayer) {
    ctx.fillStyle = '#505860';
    ctx.font = 'bold 10px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
    ctx.fillText('EXP', x + 16, y + 66);

    const expX = x + 46;
    const expY = y + 59;
    const expW = 90;
    ctx.fillStyle = '#384048';
    ctx.fillRect(expX, expY, expW, 6);
    ctx.fillStyle = '#40b8f8';
    ctx.fillRect(expX + 1, expY + 1, Math.round((expW - 2) * Math.min(1, xpRatio)), 4);
  }
}

function drawDialogBox(ctx, lines = []) {
  const boxY = 264;
  const boxH = HEIGHT - boxY;

  ctx.fillStyle = '#283038';
  ctx.fillRect(0, boxY, WIDTH, boxH);

  drawRoundedRect(ctx, 6, boxY + 5, WIDTH - 12, boxH - 10, 8);
  ctx.fillStyle = '#e06040';
  ctx.fill();

  drawRoundedRect(ctx, 11, boxY + 10, WIDTH - 22, boxH - 20, 5);
  ctx.fillStyle = '#283848';
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px "DejaVu Sans Mono", Consolas, monospace, sans-serif';

  const cleanLines = lines.filter(Boolean).slice(0, 3);
  cleanLines.forEach((line, idx) => {
    const truncated = line.length > 56 ? `${line.slice(0, 53)}...` : line;
    ctx.fillText(truncated, 26, boxY + 34 + idx * 23);
  });
}

function drawStylizedAttackVFX(ctx, { sx, sy, tx, ty, t, style }) {
  if (style.archetype === 'fire') {
    const count = 14;
    for (let i = 0; i < count; i += 1) {
      const p = t * 1.4 - i * 0.06;
      if (p < 0 || p > 1) continue;
      const x = sx + (tx - sx) * p + Math.sin(p * 18 + i) * 10;
      const y = sy + (ty - sy) * p + Math.cos(p * 18 + i) * 8;
      const r = 8 + p * 22;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = i % 3 === 0 ? '#fff070' : i % 2 === 0 ? '#ff8818' : '#e82818';
      ctx.fill();
    }
    if (t > 0.35) {
      const pillarP = Math.min(1, (t - 0.35) / 0.65);
      for (let k = 0; k < 8; k += 1) {
        const angle = (k / 8) * Math.PI * 2 + pillarP * 4;
        const fx = tx + Math.cos(angle) * (18 + pillarP * 24);
        const fy = ty + 20 - pillarP * 55 + Math.sin(angle * 2) * 12;
        ctx.beginPath();
        ctx.arc(fx, fy, 16 * (1 - pillarP * 0.4), 0, Math.PI * 2);
        ctx.fillStyle = k % 2 === 0 ? '#ff4010' : '#ffd030';
        ctx.fill();
      }
    }
    return;
  }

  if (style.archetype === 'lightning') {
    const drawBolt = (offsetX, width, color) => {
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      ctx.moveTo(tx + offsetX, 0);
      const steps = 7;
      for (let s = 1; s <= steps; s += 1) {
        const ny = (ty / steps) * s;
        const nx =
          s === steps
            ? tx + offsetX * 0.3
            : tx + offsetX + (s % 2 === 0 ? 1 : -1) * (18 + ((t * 100 + s * 17) % 16));
        ctx.lineTo(nx, ny);
      }
      ctx.stroke();
      ctx.restore();
    };

    if (t > 0.1 && t < 0.9) {
      drawBolt(-10, 11, 'rgba(255, 230, 40, 0.55)');
      drawBolt(-10, 5, '#fff8a0');
      drawBolt(14, 9, 'rgba(255, 210, 0, 0.6)');
      drawBolt(14, 4, '#ffffff');

      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + t * 10;
        const dist = 25 + (i % 2) * 20;
        const sparkX = tx + Math.cos(a) * dist;
        const sparkY = ty - 10 + Math.sin(a) * (dist * 0.7);
        ctx.strokeStyle = i % 2 === 0 ? '#ffe820' : '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sparkX - 8, sparkY - 6);
        ctx.lineTo(sparkX + 2, sparkY);
        ctx.lineTo(sparkX - 2, sparkY + 6);
        ctx.lineTo(sparkX + 8, sparkY + 10);
        ctx.stroke();
      }
    }
    return;
  }

  if (style.archetype === 'beam') {
    if (t < 0.25) {
      const r = 6 + (t / 0.25) * 22;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = style.primary;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(sx, sy, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      return;
    }

    const headP = Math.min(1, (t - 0.2) / 0.35);
    const bx = sx + (tx - sx) * headP;
    const by = sy + (ty - sy) * headP;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = style.primary;
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.strokeStyle = style.secondary;
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(bx, by);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(bx, by);
    ctx.stroke();

    const rings = 5;
    for (let i = 1; i <= rings; i += 1) {
      const rp = (i / (rings + 1)) * headP;
      const rx = sx + (tx - sx) * rp;
      const ry = sy + (ty - sy) * rp;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(rx, ry, 8, 17, -0.35, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (headP >= 0.85) {
      for (let i = 0; i < 8; i += 1) {
        const a = (i / 8) * Math.PI * 2 + t * 8;
        const d = 15 + (t - 0.45) * 65;
        ctx.beginPath();
        ctx.arc(tx + Math.cos(a) * d, ty + Math.sin(a) * d * 0.7, 6, 0, Math.PI * 2);
        ctx.fillStyle = i % 2 === 0 ? '#ffffff' : style.primary;
        ctx.fill();
      }
    }
    ctx.restore();
    return;
  }

  // Default: Anime Speed-Lines + Triple Blade Slash
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 3;
  for (let i = 0; i < 12; i += 1) {
    const lx = ((i * 97 + t * 400) % 700) - 50;
    const ly = (i * 23) % 240;
    ctx.beginPath();
    ctx.moveTo(lx, ly);
    ctx.lineTo(lx + 75, ly - 28);
    ctx.stroke();
  }
  ctx.restore();

  const slashes = [
    { start: 0.15, x1: tx - 55, y1: ty - 45, x2: tx + 45, y2: ty + 35 },
    { start: 0.28, x1: tx - 40, y1: ty - 55, x2: tx + 55, y2: ty + 20 },
    { start: 0.41, x1: tx - 65, y1: ty - 25, x2: tx + 35, y2: ty + 50 }
  ];

  slashes.forEach((s) => {
    const p = (t - s.start) / 0.35;
    if (p <= 0 || p >= 1.2) return;
    const prog = Math.min(1, p);
    const curX = s.x1 + (s.x2 - s.x1) * prog;
    const curY = s.y1 + (s.y2 - s.y1) * prog;

    ctx.save();
    ctx.strokeStyle = style.primary;
    ctx.lineWidth = 10 * (1 - Math.max(0, p - 0.7));
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(curX, curY);
    ctx.stroke();

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4 * (1 - Math.max(0, p - 0.7));
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(curX, curY);
    ctx.stroke();
    ctx.restore();
  });
}

function drawFrame(ctx, state, frameOpts = {}) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.save();
  ctx.imageSmoothingEnabled = false;

  const {
    shakeX = 0,
    shakeY = 0,
    skyTint = null,
    npcOffsetX = 0,
    npcOffsetY = 0,
    npcTint = null,
    npcVisible = true,
    userOffsetX = 0,
    userOffsetY = 0,
    userTint = null,
    userVisible = true,
    npcHpDisplay = state.npcHp,
    userHpDisplay = state.userHp,
    vfx = null,
    dialogLines = state.dialogLines || []
  } = frameOpts;

  if (shakeX || shakeY) {
    ctx.translate(shakeX, shakeY);
  }

  drawArenaBackground(ctx, skyTint);

  // Draw Opponent Sprite (top-right)
  if (state.npcImg && npcVisible) {
    const spriteSize = 136;
    const nx = 465 - spriteSize / 2 + npcOffsetX;
    const ny = 154 - spriteSize + 22 + npcOffsetY;
    if (npcTint) {
      drawSpriteFlash(ctx, state.npcImg, nx, ny, spriteSize, npcTint);
    } else {
      ctx.drawImage(state.npcImg, nx, ny, spriteSize, spriteSize);
    }
  } else if (!state.npcPokemon) {
    drawPokeballWaiting(ctx, 465, 145);
  }

  // Draw Player Sprite (bottom-left)
  if (state.userImg && userVisible) {
    const spriteSize = 152;
    const ux = 175 - spriteSize / 2 + userOffsetX;
    const uy = 248 - spriteSize + 32 + userOffsetY;
    if (userTint) {
      drawSpriteFlash(ctx, state.userImg, ux, uy, spriteSize, userTint);
    } else {
      ctx.drawImage(state.userImg, ux, uy, spriteSize, spriteSize);
    }
  } else if (!state.userPokemon) {
    drawPokeballWaiting(ctx, 175, 232);
  }

  if (vfx) {
    drawStylizedAttackVFX(ctx, vfx);
  }

  // Draw Opponent HUD (top-left)
  if (state.npcPokemon) {
    drawStatusHud(ctx, {
      x: 24,
      y: 18,
      name: state.npcPokemon,
      trainerName: state.player2Name,
      level: state.npcLevel,
      hp: npcHpDisplay,
      maxHp: state.npcMaxHp,
      isPlayer: false
    });
  }

  // Draw Player HUD (bottom-right)
  if (state.userPokemon) {
    drawStatusHud(ctx, {
      x: 358,
      y: 168,
      name: state.userPokemon,
      trainerName: state.player1Name,
      level: state.userLevel,
      xpRatio: ((Number(state.userLevel) || 12) % 4) / 4 || 0.5,
      hp: userHpDisplay,
      maxHp: state.userMaxHp,
      isPlayer: true
    });
  }

  drawDialogBox(ctx, dialogLines);
  ctx.restore();
}

async function renderBattleCardPng(sceneData) {
  const [npcImg, userImg] = await Promise.all([
    fetchSpriteImage(sceneData.npcId, false),
    fetchSpriteImage(sceneData.userId, true)
  ]);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');

  drawFrame(ctx, {
    ...sceneData,
    npcImg,
    userImg
  });

  return canvas.toBuffer('image/png');
}

function addAttackSequenceFrames(frames, {
  attackerIsUser,
  moveName,
  moveType,
  startNpcHp,
  endNpcHp,
  startUserHp,
  endUserHp,
  dialogLines
}) {
  const style = getVfxStyle(moveName, moveType);
  const sx = attackerIsUser ? 215 : 435;
  const sy = attackerIsUser ? 195 : 115;
  const tx = attackerIsUser ? 465 : 175;
  const ty = attackerIsUser ? 110 : 195;

  const steps = 12;
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const inImpact = t >= 0.3 && t <= 0.8;
    const drainP = Math.max(0, Math.min(1, (t - 0.3) / 0.5));
    const curNpcHp = startNpcHp + (endNpcHp - startNpcHp) * drainP;
    const curUserHp = startUserHp + (endUserHp - startUserHp) * drainP;

    const lunge = t >= 0.08 && t <= 0.38 ? 16 : 0;
    const knock = inImpact ? (i % 2 === 0 ? 10 : -5) : 0;
    const flash = inImpact && i % 2 === 1 ? style.hitTint : null;

    const npcFaintDrop = !attackerIsUser || endNpcHp > 0 || t <= 0.72 ? 0 : ((t - 0.72) / 0.28) * 85;
    const userFaintDrop = attackerIsUser || endUserHp > 0 || t <= 0.72 ? 0 : ((t - 0.72) / 0.28) * 85;

    frames.push({
      delay: 65,
      opts: {
        shakeX: inImpact ? (i % 2 === 0 ? 5 : -5) : 0,
        shakeY: inImpact ? (i % 3 === 0 ? 3 : -3) : 0,
        skyTint: t >= 0.15 && t <= 0.85 ? style.skyTint : null,
        userOffsetX: attackerIsUser ? lunge : -knock,
        userOffsetY: attackerIsUser ? -lunge * 0.4 : userFaintDrop,
        userTint: !attackerIsUser ? flash : null,
        userVisible: userFaintDrop < 70,
        npcOffsetX: attackerIsUser ? knock : -lunge,
        npcOffsetY: attackerIsUser ? npcFaintDrop : lunge * 0.4,
        npcTint: attackerIsUser ? flash : null,
        npcVisible: npcFaintDrop < 70,
        npcHpDisplay: curNpcHp,
        userHpDisplay: curUserHp,
        vfx: { sx, sy, tx, ty, t, style },
        dialogLines
      }
    });
  }
}

async function renderBattleCardGif(sceneData) {
  const [npcImg, userImg] = await Promise.all([
    fetchSpriteImage(sceneData.npcId, false),
    fetchSpriteImage(sceneData.userId, true)
  ]);

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext('2d');
  const gif = GIFEncoder();

  const state = {
    ...sceneData,
    npcImg,
    userImg
  };

  const prevNpcHp = Number(sceneData.prevNpcHp ?? sceneData.npcHp);
  const targetNpcHp = Number(sceneData.npcHp);
  const prevUserHp = Number(sceneData.prevUserHp ?? sceneData.userHp);
  const targetUserHp = Number(sceneData.userHp);

  const hasAttackAnimation = Boolean(sceneData.userMove || sceneData.npcMove);
  const frames = [];

  if (!hasAttackAnimation) {
    const startLines = sceneData.dialogLines || ['Battle ready!'];
    for (let i = 0; i < 6; i += 1) {
      const bounce = i % 2 === 0 ? 0 : -4;
      frames.push({
        delay: i === 5 ? 700 : 180,
        opts: {
          npcOffsetY: bounce,
          userOffsetY: -bounce,
          npcHpDisplay: targetNpcHp,
          userHpDisplay: targetUserHp,
          dialogLines: startLines
        }
      });
    }
  } else {
    const userLines = sceneData.userDialogLines || sceneData.dialogLines || [];
    const npcLines = sceneData.npcDialogLines || sceneData.dialogLines || [];
    const finalLines = sceneData.dialogLines || [...userLines, ...npcLines];

    if (sceneData.userMove) {
      addAttackSequenceFrames(frames, {
        attackerIsUser: true,
        moveName: sceneData.userMove,
        moveType: sceneData.userMoveType || 'normal',
        startNpcHp: prevNpcHp,
        endNpcHp: targetNpcHp,
        startUserHp: prevUserHp,
        endUserHp: sceneData.npcMove ? prevUserHp : targetUserHp,
        dialogLines: userLines
      });
    }

    if (sceneData.npcMove && targetNpcHp > 0) {
      addAttackSequenceFrames(frames, {
        attackerIsUser: false,
        moveName: sceneData.npcMove,
        moveType: sceneData.npcMoveType || 'normal',
        startNpcHp: targetNpcHp,
        endNpcHp: targetNpcHp,
        startUserHp: prevUserHp,
        endUserHp: targetUserHp,
        dialogLines: npcLines
      });
    }

    frames.push({
      delay: 1100,
      opts: {
        npcVisible: targetNpcHp > 0,
        userVisible: targetUserHp > 0,
        npcHpDisplay: targetNpcHp,
        userHpDisplay: targetUserHp,
        dialogLines: finalLines
      }
    });
  }

  for (const frame of frames) {
    drawFrame(ctx, state, frame.opts);
    const { data } = ctx.getImageData(0, 0, WIDTH, HEIGHT);
    const palette = quantize(data, 256);
    const index = applyPalette(data, palette);
    gif.writeFrame(index, WIDTH, HEIGHT, {
      palette,
      delay: frame.delay,
      repeat: 0
    });
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

module.exports = {
  renderBattleCardPng,
  renderBattleCardGif
};
