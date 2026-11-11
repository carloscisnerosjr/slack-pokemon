const express = require('express');
const path = require('node:path');
const battleText = require('./battle-text.js');

const app = express();

app.set('port', process.env.PORT || 5000);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/', (request, response) => {
  response.send('Hello There!');
});

/*
 * Main endpoint that receives POST commands from Slack.
 * Expects payloads such as:
 * {
 *   "text": "pkmn battle me",
 *   "user_name": "rvinluan",
 *   "channel_name": "#pkmn_battles"
 * }
 */
app.post('/commands', async (request, response) => {
  const rawText = String(request.body?.text || '').trim().toLowerCase();
  const rawTokens = rawText ? rawText.split(/\s+/) : [];
  // Normalize so both `/pkmn battle me` (text="battle me") and `pkmn battle me` have "pkmn" at index 0
  const commands = rawTokens[0] === 'pkmn' ? rawTokens : ['pkmn', ...rawTokens];

  if (matchCommands(commands, 'CHOOSE')) {
    try {
      const chosenObject = await battleText.userChoosePokemon(commands, request.body || {});
      const output = chosenObject.spriteUrl
        ? `${chosenObject.text}\n${chosenObject.spriteUrl}`
        : chosenObject.text;
      response.json(buildResponse(output));
    } catch (err) {
      console.error(err);
      response.json(buildResponse(`I don't think that's a real Pokemon. ${err}`));
    }
  } else if (matchCommands(commands, 'ATTACK')) {
    const moveName = commands.length > 3 ? commands.slice(2).join('-') : commands[2] || '';
    try {
      const textString = await battleText.useMove(moveName.toLowerCase());
      response.json(buildResponse(textString));
    } catch (err) {
      console.error(err);
      response.json(buildResponse(`You can't use that move. ${err}`));
    }
  } else if (matchCommands(commands, 'START')) {
    try {
      const startObj = await battleText.startBattle(request.body || {});
      response.json(buildResponse(`${startObj.text}\n${startObj.spriteUrl}`));
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

if (require.main === module) {
  app.listen(app.get('port'), () => {
    console.log(`Node app is running at localhost:${app.get('port')}`);
  });
}

/*
 * Helper function to build the JSON to send back to Slack.
 * Make sure to make a custom emoji in your Slack integration named :pkmntrainer:
 * with the included pkmntrainer jpeg, otherwise the profile picture won't work.
 */
function buildResponse(text) {
  return {
    response_type: 'in_channel',
    text,
    username: 'Pokemon Trainer',
    icon_emoji: ':pkmntrainer:'
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
