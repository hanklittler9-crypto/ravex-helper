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

## Commands

| Command | What it does |
|---|---|
| `/welcome channel` | Set welcome channel |
| `/welcome message` | Custom text (`{user}` `{username}` `{server}` `{count}`) |
| `/welcome test` | Preview welcome |
| `/ticket setup` | Create Tickets category, logs, Support role |
| `/ticket panel` | Post Open Ticket button |
| `/ticket open` | Open a ticket |
| `/ticket close` | Close current ticket |
| `/ticket add` / `remove` | Manage ticket members |
| `/help` | Command list |

**Modmail:** users DM the bot → a ticket opens. Staff replies in that ticket are forwarded back to the user’s DMs.

## Deploy on Render (Web Service)

1. New → **Web Service** → connect `ravex-helper`
2. Build: `npm install` · Start: `npm start`
3. Add env vars: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID`
4. Deploy — slash commands register automatically on startup
5. Optional local: `npm run deploy`
