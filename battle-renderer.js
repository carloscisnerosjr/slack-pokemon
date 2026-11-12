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

function drawArenaBackground(ctx) {
  // Sky gradient
  const skyGrad = ctx.createLinearGradient(0, 0, 0, 260);
  skyGrad.addColorStop(0, '#68b8f8');
  skyGrad.addColorStop(0.6, '#b8e8f8');
  skyGrad.addColorStop(1, '#78d080');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, WIDTH, 265);

  // Subtle horizontal scanlines in sky for GBA retro feel
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  for (let y = 0; y < 260; y += 6) {
    ctx.fillRect(0, y, WIDTH, 2);
  }

  // Distant hills / horizon band
  ctx.fillStyle = '#48a860';
  ctx.fillRect(0, 172, WIDTH, 93);

  ctx.fillStyle = '#60c070';
  ctx.fillRect(0, 180, WIDTH, 85);

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

function drawStatusHud(ctx, { x, y, name, level, hp, maxHp, isPlayer, xpRatio = 0.35 }) {
  const w = 256;
  const h = 80;

  // Drop shadow
  drawRoundedRect(ctx, x + 4, y + 4, w, h, 10);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ctx.fill();

  // Outer dark border
  drawRoundedRect(ctx, x, y, w, h, 10);
  ctx.fillStyle = '#303840';
  ctx.fill();

  // Inner cream HUD panel
  drawRoundedRect(ctx, x + 4, y + 4, w - 8, h - 8, 7);
  ctx.fillStyle = '#f8f8d8';
  ctx.fill();

  // Pokemon Name & Level
  const displayName = String(name || '???').toUpperCase();
  ctx.fillStyle = '#282828';
  ctx.font = 'bold 17px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  ctx.fillText(displayName, x + 16, y + 26);

  ctx.font = 'bold 16px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  const lvlText = `Lv${level || 12}`;
  const lvlWidth = ctx.measureText(lvlText).width;
  ctx.fillText(lvlText, x + w - 18 - lvlWidth, y + 26);

  // HP Bar container (full width, no empty left badge when HP text is separate)
  const labelX = x + 16;
  const barX = x + 48;
  const barY = y + 36;
  const barW = 190;
  const barH = 14;

  // "HP" label on the cream card to the left of the bar
  ctx.fillStyle = '#e88020';
  ctx.font = 'bold 14px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  ctx.fillText('HP', labelX, barY + 12);

  // Outer HP bar border (starts right at barX so 0% to 100% fills the entire bar!)
  drawRoundedRect(ctx, barX, barY, barW, barH, 4);
  ctx.fillStyle = '#303840';
  ctx.fill();

  // Inner empty HP track
  ctx.fillStyle = '#202820';
  ctx.fillRect(barX + 2, barY + 2, barW - 4, barH - 4);

  // Filled HP bar
  const safeMax = Math.max(1, Number(maxHp) || 100);
  const safeHp = Math.max(0, Math.min(safeMax, Number(hp) || 0));
  const ratio = safeHp / safeMax;
  const fillW = Math.round((barW - 4) * ratio);

  if (fillW > 0) {
    ctx.fillStyle = getHpColor(ratio);
    ctx.fillRect(barX + 2, barY + 2, fillW, barH - 4);
  }

  // Numeric HP counter (shown on both Enemy and Player HUDs)
  ctx.fillStyle = '#282828';
  ctx.font = 'bold 13px "DejaVu Sans Mono", Consolas, monospace, sans-serif';
  const hpNumbers = `${Math.round(safeHp)} / ${Math.round(safeMax)} HP`;
  const numW = ctx.measureText(hpNumbers).width;
  ctx.fillText(hpNumbers, x + w - 18 - numW, y + 66);

  if (isPlayer) {
    // EXP bar at bottom of player HUD
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

  // Outer dark frame
  ctx.fillStyle = '#283038';
  ctx.fillRect(0, boxY, WIDTH, boxH);

  // Gold/red GBA-style accent border
  drawRoundedRect(ctx, 6, boxY + 5, WIDTH - 12, boxH - 10, 8);
  ctx.fillStyle = '#e06040';
  ctx.fill();

  // Inner dark slate message box
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

function drawAttackEffect(ctx, targetX, targetY, moveType = 'normal', progress = 0.5) {
  const typeColors = {
    fire: '#ff5020',
    water: '#30a0ff',
    electric: '#ffe030',
    grass: '#40d850',
    ice: '#80f0ff',
    psychic: '#ff60b8',
    dragon: '#7050ff',
    ghost: '#8058a8',
    dark: '#504040',
    fighting: '#d04030',
    poison: '#b048b8',
    ground: '#e0b860',
    rock: '#b8a040',
    flying: '#98a8f0',
    bug: '#a8b820',
    steel: '#b8b8d0',
    fairy: '#f098b8',
    normal: '#ffffff'
  };
  const color = typeColors[String(moveType).toLowerCase()] || '#ffffff';

  ctx.save();
  const radius = 14 + progress * 34;
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(targetX, targetY, radius, 0, Math.PI * 2);
  ctx.stroke();

  // Starburst rays
  for (let i = 0; i < 6; i += 1) {
    const angle = (Math.PI * 2 * i) / 6 + progress * 1.5;
    const r1 = radius * 0.4;
    const r2 = radius * 1.15;
    ctx.beginPath();
    ctx.moveTo(targetX + Math.cos(angle) * r1, targetY + Math.sin(angle) * r1);
    ctx.lineTo(targetX + Math.cos(angle) * r2, targetY + Math.sin(angle) * r2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawFrame(ctx, state, frameOpts = {}) {
  ctx.clearRect(0, 0, WIDTH, HEIGHT);
  ctx.imageSmoothingEnabled = false;

  drawArenaBackground(ctx);

  const {
    npcOffsetX = 0,
    npcOffsetY = 0,
    npcVisible = true,
    userOffsetX = 0,
    userOffsetY = 0,
    userVisible = true,
    npcHpDisplay = state.npcHp,
    userHpDisplay = state.userHp,
    effectOnNpc = null,
    effectOnUser = null,
    dialogLines = state.dialogLines || []
  } = frameOpts;

  // Draw Opponent Sprite (top-right)
  if (state.npcImg && npcVisible) {
    const spriteSize = 136;
    ctx.drawImage(
      state.npcImg,
      465 - spriteSize / 2 + npcOffsetX,
      154 - spriteSize + 22 + npcOffsetY,
      spriteSize,
      spriteSize
    );
  }

  // Draw Player Sprite (bottom-left)
  if (state.userImg && userVisible) {
    const spriteSize = 152;
    ctx.drawImage(
      state.userImg,
      175 - spriteSize / 2 + userOffsetX,
      248 - spriteSize + 32 + userOffsetY,
      spriteSize,
      spriteSize
    );
  } else if (!state.userPokemon) {
    // Draw Pokeball waiting to be sent out
    ctx.save();
    ctx.beginPath();
    ctx.arc(175, 232, 18, 0, Math.PI * 2);
    ctx.fillStyle = '#f03030';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(175, 232, 18, 0, Math.PI);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#202020';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(175, 232, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  if (effectOnNpc) {
    drawAttackEffect(ctx, 465, 110, effectOnNpc.type, effectOnNpc.progress);
  }
  if (effectOnUser) {
    drawAttackEffect(ctx, 175, 195, effectOnUser.type, effectOnUser.progress);
  }

  // Draw Opponent HUD (top-left)
  if (state.npcPokemon) {
    drawStatusHud(ctx, {
      x: 24,
      y: 18,
      name: state.npcPokemon,
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
      level: state.userLevel,
      xpRatio: ((Number(state.userLevel) || 12) % 4) / 4 || 0.5,
      hp: userHpDisplay,
      maxHp: state.userMaxHp,
      isPlayer: true
    });
  }

  drawDialogBox(ctx, dialogLines);
}

/*
 * Render a static PNG buffer of the battle scene.
 */
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

/*
 * Render an animated GIF buffer of the battle turn!
 * Shows the attacker lunging, elemental impact flash, HP bar draining smoothly,
 * and the counter-attack if applicable.
 */
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

  const hasAttackAnimation = Boolean(sceneData.userMove);
  const frames = [];

  if (!hasAttackAnimation) {
    // Simple 4-frame idle bounce animation when battle starts or Pokemon is chosen
    const startLines = sceneData.dialogLines || ['Battle ready!'];
    for (let i = 0; i < 4; i += 1) {
      const bounce = i % 2 === 0 ? 0 : -4;
      frames.push({
        delay: i === 3 ? 900 : 220,
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
    const userLines = sceneData.userDialogLines || [
      `${String(sceneData.userPokemon).toUpperCase()} used ${String(sceneData.userMove).toUpperCase()}!`
    ];
    const npcLines = sceneData.npcDialogLines || [];
    const finalLines = sceneData.dialogLines || [...userLines, ...npcLines];

    // Phase 1: User Pokemon lunges forward + hits NPC
    frames.push({
      delay: 140,
      opts: {
        userOffsetX: 18,
        userOffsetY: -10,
        npcHpDisplay: prevNpcHp,
        userHpDisplay: prevUserHp,
        dialogLines: userLines
      }
    });
    frames.push({
      delay: 130,
      opts: {
        userOffsetX: 6,
        userOffsetY: -4,
        npcVisible: false,
        npcHpDisplay: (prevNpcHp + targetNpcHp) / 2,
        userHpDisplay: prevUserHp,
        effectOnNpc: { type: sceneData.userMoveType || 'normal', progress: 0.4 },
        dialogLines: userLines
      }
    });
    frames.push({
      delay: 150,
      opts: {
        npcOffsetX: 8,
        npcVisible: true,
        npcHpDisplay: targetNpcHp,
        userHpDisplay: prevUserHp,
        effectOnNpc: { type: sceneData.userMoveType || 'normal', progress: 0.85 },
        dialogLines: userLines
      }
    });

    // Phase 2: If NPC survived and counter-attacked
    if (sceneData.npcMove && targetNpcHp > 0) {
      frames.push({
        delay: 350,
        opts: {
          npcHpDisplay: targetNpcHp,
          userHpDisplay: prevUserHp,
          dialogLines: userLines
        }
      });
      frames.push({
        delay: 140,
        opts: {
          npcOffsetX: -18,
          npcOffsetY: 10,
          npcHpDisplay: targetNpcHp,
          userHpDisplay: prevUserHp,
          dialogLines: npcLines
        }
      });
      frames.push({
        delay: 130,
        opts: {
          npcOffsetX: -6,
          userVisible: false,
          npcHpDisplay: targetNpcHp,
          userHpDisplay: (prevUserHp + targetUserHp) / 2,
          effectOnUser: { type: sceneData.npcMoveType || 'normal', progress: 0.4 },
          dialogLines: npcLines
        }
      });
      frames.push({
        delay: 150,
        opts: {
          userOffsetX: -8,
          userVisible: true,
          npcHpDisplay: targetNpcHp,
          userHpDisplay: targetUserHp,
          effectOnUser: { type: sceneData.npcMoveType || 'normal', progress: 0.85 },
          dialogLines: npcLines
        }
      });
    }

    // Final resting frame showing full summary
    frames.push({
      delay: 1600,
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
      delay: frame.delay
    });
  }

  gif.finish();
  return Buffer.from(gif.bytes());
}

module.exports = {
  renderBattleCardPng,
  renderBattleCardGif
};
