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
  const commands = rawText ? rawText.split(/\s+/) : [];

  if (matchCommands(commands, 'CHOOSE')) {
    try {
      const chosenObject = await battleText.userChoosePokemon(commands);
      const output = chosenObject.spriteUrl
        ? `${chosenObject.text}\n${chosenObject.spriteUrl}`
        : chosenObject.text;
      response.send(buildResponse(output));
    } catch (err) {
      console.error(err);
      response.send(buildResponse(`I don't think that's a real Pokemon. ${err}`));
    }
  } else if (matchCommands(commands, 'ATTACK')) {
    const moveName = commands.length > 3 ? commands.slice(2).join('-') : commands[2] || '';
    try {
      const textString = await battleText.useMove(moveName.toLowerCase());
      response.send(buildResponse(textString));
    } catch (err) {
      console.error(err);
      response.send(buildResponse(`You can't use that move. ${err}`));
    }
  } else if (matchCommands(commands, 'START')) {
    try {
      const startObj = await battleText.startBattle(request.body || {});
      response.send(buildResponse(`${startObj.text}\n${startObj.spriteUrl}`));
    } catch (err) {
      console.error(err);
      response.send(buildResponse(`Something went wrong. ${err}`));
    }
  } else if (matchCommands(commands, 'END')) {
    try {
      await battleText.endBattle();
      response.send(buildResponse('Battle Over.'));
    } catch (err) {
      console.error(err);
      response.send(buildResponse(`Couldn't end the battle. ${err}`));
    }
  } else {
    const text = await battleText.unrecognizedCommand(commands);
    response.send(buildResponse(text));
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
  const json = {
    text,
    username: 'Pokemon Trainer',
    icon_emoji: ':pkmntrainer:'
  };
  return JSON.stringify(json);
}

/*
 * Helper function to match commands.
 * Keeps all the possible commands and their trigger words in one place.
 */
function matchCommands(commandArray, command) {
  const commandsDict = {
    CHOOSE: 'i choose',
    ATTACK: 'use',
    START: 'battle me',
    END: 'end battle'
  };
  const cmdString = commandArray.join(' ').toLowerCase().replace(/^pkmn\s+/, '');
  return cmdString.indexOf(commandsDict[command]) === 0;
}

module.exports = app;
