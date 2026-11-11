# Slack-Pokemon (Modernized)

> **Credits:** This repository is a modernized fork of [**rvinluan/slack-pokemon**](https://github.com/rvinluan/slack-pokemon), originally created by [**Robert Vinluan (@rvinluan)**](https://github.com/rvinluan) at Vox Media's product hackathon, [Vax](http://product.voxmedia.com/2014/7/3/5861220/vax-14-the-things-we-built). Read more about the original project on [Polygon](http://www.polygon.com/2014/6/27/5850720/pokemon-battle-slack-vox).

This is a bot for having Pokémon battles within [Slack](https://slack.com/).

Here's an example battle from the original release:

<img src="http://cdn3.vox-cdn.com/assets/4681633/pkmn_slack.jpg" alt="Example Battle">

## What Was Updated

The original 2014 codebase targeted Node `0.10.x` and PokeAPI `v1`. This fork updates the project to run on modern Node.js (`>=20`) and current packages:

- **PokeAPI v2 & Official Animated Sprites:** Migrated all endpoints from the decommissioned PokeAPI `v1` to `https://pokeapi.co/api/v2/`, and replaced dead `pokecheck.org` sprite links with official Generation V animated sprites from [`PokeAPI/sprites`](https://github.com/PokeAPI/sprites).
- **Modern Dependencies:** Upgraded to **Express 5** (`^5.3.0`) and **node-redis v6** (`^6.3.1`), and removed deprecated packages (`request`, `q`, `body-parser`) in favor of native `fetch`, `async`/`await`, and `express.json()`.
- **Redis Optional Fallback:** Supports `REDIS_URL` / `REDISTOGO_URL` out of the box and automatically falls back to an in-memory store if Redis is not running locally.
- **Slack Slash Command Support:** Works with modern Slack Slash Commands (`/pkmn ...`) in addition to legacy Outgoing Webhooks (`pkmn ...`).
- **Dynamic Composite Battle Card (Animated GIF & PNG):** Renders a GBA-style battle screen on every turn (`/battle-card.gif` and `/battle-card.png`) using `@napi-rs/canvas` and `gifenc`—complete with arena platforms, front/back Pokémon sprites, dynamic green/yellow/red HP bars, EXP bar, elemental hit effects, and battle dialogue box, plus interactive Slack Block Kit move buttons (`/interactions`).
- **Leveling, Evolution & Trainer Roster:** Winning battles awards XP and levels up your Pokémon (+4 levels per win, scaling HP and attack damage). When a Pokémon reaches its evolution threshold in PokeAPI's evolution chain (e.g., Charmander at Lv. 16 → Charmeleon, Lv. 36 → Charizard), it automatically evolves at the end of the battle! Use `/pkmn stats` to view your Pokémon roster.

## Setting Up

Requires [Node.js](https://nodejs.org/) (`>=20.0.0`). [Redis](https://redis.io/) is optional for local development (an in-memory fallback is used automatically if no Redis server is reachable).

### Running Locally

Install dependencies and start the server:

```bash
npm install
npm start
```

Your app will run on `http://localhost:5000` (with Redis if running on `localhost:6379`, or the built-in in-memory store otherwise).

To test locally, send `POST` requests to `http://localhost:5000/commands`:

```bash
curl -X POST -d '{"text":"pkmn battle me","user_name":"ash","channel_name":"#general"}' -H 'Content-Type: application/json' "http://localhost:5000/commands"
```

### Configuring Slack

#### Using Slack Slash Commands (Recommended)

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new Slack app.
2. Under **Slash Commands**, create a command:
   - **Command:** `/pkmn`
   - **Request URL:** `https://<your-domain>/commands`
   - **Usage Hint:** `battle me | i choose <pokemon> | use <move> | end battle`
3. Install the app to your workspace.

#### Using Outgoing Webhooks (Legacy)

Set up an [Outgoing Webhook Integration](https://my.slack.com/services/new/outgoing-webhook) with the trigger word `pkmn` that sends to `https://<your-domain>/commands`.

To get the bot's custom avatar to work, add a [Custom Emoji](https://my.slack.com/customize/emoji) named `:pkmntrainer:`.

## How to Play

List of commands (using `/pkmn` Slash Command or `pkmn` trigger word):

- `/pkmn battle me` (or `pkmn battle me`): Starts a battle and chooses a Pokémon from the original 151 for the NPC.
- `/pkmn i choose <pokemon>` (or `pkmn i choose <pokemon>`): Chooses a Pokémon for the user (loading its saved level/XP if you've trained it before) and replies with 4 usable moves.
- `/pkmn use <attack>` (or `pkmn use <attack>`): Uses an attack. You can type the attack with hyphens (`hyper-beam`) or spaces (`will o wisp`).
- `/pkmn stats` (or `pkmn stats`): Displays your saved Pokémon roster, levels, XP, and win counts.
- `/pkmn end battle` (or `pkmn end battle`): Ends the current battle at any time.

## Features

Currently the battle system is a compact version of Pokémon's battle mechanics. It supports:

- One battle between a user and an NPC
- One Pokémon per player
- Moves with appropriate power and type effectiveness (Super Effective, Not Very Effective, No Effect, etc.)
- Persistent trainer roster, XP/level progression, level-scaled HP & damage, and automatic evolution via PokeAPI's `evolution-chain` endpoints

It currently does not support:

- Taking stats into account when calculating damage (including accuracy and critical hits)
- Levels, EVs, or IVs
- Non-damaging status effects, buffs/debuffs, or multi-hit moves
- Items and abilities
- Multiple concurrent battles or player-vs-player battles

## Credits & License

- **Original Author:** [Robert Vinluan (@rvinluan)](https://github.com/rvinluan)
- **Original Repository:** [github.com/rvinluan/slack-pokemon](https://github.com/rvinluan/slack-pokemon)
- **License:** MIT
