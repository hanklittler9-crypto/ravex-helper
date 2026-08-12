# Ravex Helper

Discord welcomer + modmail/ticket bot.

## Setup

1. Create a bot at [Discord Developer Portal](https://discord.com/developers/applications)
2. Under **Bot**, enable:
   - Server Members Intent
   - Message Content Intent
3. Invite the bot with scopes `bot` + `applications.commands` and permissions: Manage Channels, Manage Roles, Send Messages, Embed Links, Attach Files, Read Message History, View Channels
4. Copy `.env.example` → `.env` and fill in:

```
DISCORD_TOKEN=...
CLIENT_ID=...
GUILD_ID=...
```

5. Install and run:

```bash
npm install
npm run deploy
npm start
```

## Welcome customizer

Use `/welcome studio` for the interactive panel (buttons, modals, channel/role selects).

Also available:
- Embed: title, description, color, footer, author, fields, thumbnail, banner image
- Random message pool (`/welcome pool`)
- DM welcomes + leave messages
- Auto-roles on join
- Variables: `{user}` `{username}` `{displayname}` `{tag}` `{id}` `{server}` `{count}` `{created}` `{joined}` `{rules}` `{avatar}` ...
- `/welcome preview` · `/welcome test` · `/welcome variables`

## Commands

| Command | What it does |
|---|---|
| `/welcome studio` | Interactive welcome customizer |
| `/welcome channel` | Set welcome channel |
| `/welcome message` / `title` / `color` / `image` / `thumbnail` | Embed controls |
| `/welcome dm` / `leave` / `autorole` / `pool` / `field` | Extra welcome features |
| `/welcome preview` / `test` / `status` | Preview & inspect |
| `/ticket setup` | Create category, logs, Support role |
| `/ticket panel` | Post Open Ticket button |
| `/ticket open` / `close` / `add` / `remove` | Ticket tools |
| `/help` | Command list |

**Modmail:** users DM the bot → a ticket opens. Staff replies in that ticket are forwarded back to the user’s DMs.

## Deploy on Render (Web Service)

1. New → **Web Service** → connect `ravex-helper`
2. Build: `npm install` · Start: `npm start`
3. Add env vars: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`
4. Deploy — slash commands register automatically on startup
5. Optional local: `npm run deploy`
