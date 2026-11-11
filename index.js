const express = require('express');
const path = require('node:path');
const battleText = require('./battle-text.js');
const stateMachine = require('./state-machine.js');
const { renderBattleCardPng, renderBattleCardGif } = require('./battle-renderer.js');

const app = express();

app.set('port', process.env.PORT || 5000);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (request, response) => {
  response.send('Hello There!');
});

function getBaseUrl(request) {
  if (process.env.PUBLIC_URL) {
    return process.env.PUBLIC_URL.replace(/\/$/, '');
  }
  const proto = request.headers['x-forwarded-proto'] || request.protocol || 'http';
  const host = request.headers['x-forwarded-host'] || request.get('host') || `localhost:${app.get('port')}`;
  return `${proto}://${host}`;
}

async function resolveSceneData(query = {}) {
  const saved = await stateMachine.getBattleScene();
  if (saved && !query.npcPokemon && !query.userPokemon) {
    return saved;
  }
  return {
    turn: Number(query.turn || saved?.turn || 1),
    npcPokemon: query.npcPokemon || saved?.npcPokemon || 'charizard',
    npcId: query.npcId || saved?.npcId || '6',
    npcLevel: Number(query.npcLevel || saved?.npcLevel || 16),
    prevNpcHp: Number(query.prevNpcHp ?? saved?.prevNpcHp ?? 85),
    npcHp: Number(query.npcHp ?? saved?.npcHp ?? 52),
    npcMaxHp: Number(query.npcMaxHp || saved?.npcMaxHp || 85),
    userPokemon: query.userPokemon ?? saved?.userPokemon ?? 'pikachu',
    userId: query.userId ?? saved?.userId ?? '25',
    userLevel: Number(query.userLevel || saved?.userLevel || 16),
    prevUserHp: Number(query.prevUserHp ?? saved?.prevUserHp ?? 68),
    userHp: Number(query.userHp ?? saved?.userHp ?? 54),
    userMaxHp: Number(query.userMaxHp || saved?.userMaxHp || 68),
    userMove: query.userMove || saved?.userMove || '',
    userMoveType: query.userMoveType || saved?.userMoveType || 'electric',
    npcMove: query.npcMove || saved?.npcMove || '',
    npcMoveType: query.npcMoveType || saved?.npcMoveType || 'fire',
    userDialogLines: saved?.userDialogLines,
    npcDialogLines: saved?.npcDialogLines,
    dialogLines: query.dialog
      ? [String(query.dialog)]
      : saved?.dialogLines || ['Wild Pokémon battle in progress!']
  };
}

/*
 * Dynamic Composite Battle Card endpoints:
 * - GET /battle-card.gif (Animated turn-by-turn battle screen with lunge, hit effects & HP drain)
 * - GET /battle-card.png (Static crisp PNG snapshot of the current battle screen)
 */
app.get('/battle-card.gif', async (request, response) => {
  try {
    const scene = await resolveSceneData(request.query);
    const gifBuffer = await renderBattleCardGif(scene);
    response.setHeader('Content-Type', 'image/gif');
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.send(gifBuffer);
  } catch (err) {
    console.error('Error rendering battle GIF:', err);
    response.status(500).send('Error rendering battle card');
  }
});

app.get('/battle-card.png', async (request, response) => {
  try {
    const scene = await resolveSceneData(request.query);
    const pngBuffer = await renderBattleCardPng(scene);
    response.setHeader('Content-Type', 'image/png');
    response.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.send(pngBuffer);
  } catch (err) {
    console.error('Error rendering battle PNG:', err);
    response.status(500).send('Error rendering battle card');
  }
});

/*
 * Main endpoint that receives POST commands from Slack.
 */
app.post('/commands', async (request, response) => {
  const rawText = String(request.body?.text || '').trim().toLowerCase();
  const rawTokens = rawText ? rawText.split(/\s+/) : [];
  // Normalize so both `/pkmn battle me` (text="battle me") and `pkmn battle me` have "pkmn" at index 0
  const commands = rawTokens[0] === 'pkmn' ? rawTokens : ['pkmn', ...rawTokens];
  const baseUrl = getBaseUrl(request);

  if (matchCommands(commands, 'CHOOSE')) {
    try {
      const chosenObject = await battleText.userChoosePokemon(commands, request.body || {});
      const cardUrl = chosenObject.spriteUrl
        ? `${baseUrl}/battle-card.gif?turn=${chosenObject.turn || Date.now()}&t=${Date.now()}`
        : null;
      const allowedMoves = chosenObject.moves || [];
      response.json(buildResponse(chosenObject.text, { cardUrl, moves: allowedMoves }));
    } catch (err) {
      console.error(err);
      response.json(buildResponse(`I don't think that's a real Pokemon. ${err}`));
    }
  } else if (matchCommands(commands, 'ATTACK')) {
    const moveName = commands.length > 3 ? commands.slice(2).join('-') : commands[2] || '';
    try {
      const textString = await battleText.useMove(moveName.toLowerCase());
      const scene = await stateMachine.getBattleScene();
      const activeBattle = await stateMachine.getBattle();
      const allowedMoves = activeBattle ? await stateMachine.getUserAllowedMoves() : [];
      const cardUrl = `${baseUrl}/battle-card.gif?turn=${scene?.turn || Date.now()}&t=${Date.now()}`;
      response.json(buildResponse(textString, { cardUrl, moves: allowedMoves }));
    } catch (err) {
      console.error(err);
      response.json(buildResponse(`You can't use that move. ${err}`));
    }
  } else if (matchCommands(commands, 'START')) {
    try {
      const startObj = await battleText.startBattle(request.body || {});
      const cardUrl = `${baseUrl}/battle-card.gif?turn=${startObj.turn || 1}&t=${Date.now()}`;
      response.json(buildResponse(startObj.text, { cardUrl }));
    } catch (err) {
      console.error(err);
      response.json(buildResponse(`Something went wrong. ${err}`));
    }
  } else if (matchCommands(commands, 'STATS')) {
    try {
      const statsText = await battleText.getStats(request.body || {});
      response.json(buildResponse(statsText));
    } catch (err) {
      console.error(err);
      response.json(buildResponse(`Couldn't load stats. ${err}`));
    }
  } else if (matchCommands(commands, 'END')) {
    try {
      await battleText.endBattle();
      response.json(buildResponse('Battle Over.'));
    } catch (err) {
      console.error(err);
      response.json(buildResponse(`Couldn't end the battle. ${err}`));
    }
  } else {
    const text = await battleText.unrecognizedCommand(commands);
    response.json(buildResponse(text));
  }
});

/*
 * Optional Slack Interactive Components endpoint (`/interactions`).
 * If Interactive Components are enabled in Slack App settings, clicking move buttons
 * triggers the move directly!
 */
app.post('/interactions', async (request, response) => {
  try {
    const payload =
      typeof request.body?.payload === 'string'
        ? JSON.parse(request.body.payload)
        : request.body;
    const action = payload?.actions?.[0];
    if (!action) {
      return response.status(200).send('');
    }

    const baseUrl = getBaseUrl(request);
    if (action.action_id.startsWith('use_move:')) {
      const moveName = action.value;
      const textString = await battleText.useMove(moveName.toLowerCase());
      const scene = await stateMachine.getBattleScene();
      const activeBattle = await stateMachine.getBattle();
      const allowedMoves = activeBattle ? await stateMachine.getUserAllowedMoves() : [];
      const cardUrl = `${baseUrl}/battle-card.gif?turn=${scene?.turn || Date.now()}&t=${Date.now()}`;
      const reply = buildResponse(textString, { cardUrl, moves: allowedMoves });

      if (payload.response_url) {
        await fetch(payload.response_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...reply, replace_original: false })
        });
        return response.status(200).send('');
      }
      return response.json(reply);
    }

    return response.status(200).send('');
  } catch (err) {
    console.error('Interaction error:', err);
    return response.json(buildResponse(`You can't use that move. ${err}`));
  }
});

if (require.main === module) {
  app.listen(app.get('port'), () => {
    console.log(`Node app is running at localhost:${app.get('port')}`);
  });
}

/*
 * Build the JSON payload to send back to Slack.
 * Includes a Block Kit image block for the Dynamic Composite Battle Card
 * and interactive move buttons when moves are available.
 */
function buildResponse(text, options = {}) {
  const { cardUrl, moves = [] } = options;
  const fullText = cardUrl ? `${text}\n${cardUrl}` : text;

  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text
      }
    }
  ];

  if (cardUrl) {
    blocks.push({
      type: 'image',
      image_url: cardUrl,
      alt_text: 'Pokemon Battle Screen'
    });
  }

  if (moves.length > 0) {
    blocks.push({
      type: 'actions',
      elements: moves.slice(0, 4).map((move) => ({
        type: 'button',
        text: {
          type: 'plain_text',
          text: move.replaceAll('-', ' ').toUpperCase()
        },
        value: move,
        action_id: `use_move:${move}`
      }))
    });
  }

  return {
    response_type: 'in_channel',
    text: fullText,
    username: 'Pokemon Trainer',
    icon_emoji: ':pkmntrainer:',
    blocks
  };
}

/*
 * Helper function to match commands.
 * Works with both `/pkmn <cmd>` Slash Commands (where `pkmn` is the command itself)
 * and legacy Outgoing Webhooks (where `pkmn` is the trigger word inside `text`).
 */
function matchCommands(commandArray, command) {
  const commandsDict = {
    CHOOSE: 'i choose',
    ATTACK: 'use',
    START: 'battle me',
    STATS: 'stats',
    END: 'end battle'
  };
  const cmdString = commandArray.join(' ').toLowerCase().replace(/^pkmn\s+/, '');
  return cmdString.indexOf(commandsDict[command]) === 0;
}

module.exports = app;
