# Ravex Security

Logging, automod, and moderation bot — separate from Ravex Helper.

## Setup

1. Create a **new** Discord application (do not reuse the Helper bot token)
2. Enable intents: **Server Members**, **Message Content**, **Moderation**
3. Invite with `bot` + `applications.commands` and permissions: Kick, Ban, Moderate Members, Manage Messages, Manage Channels, View Audit Log, Embed Links, Attach Files
4. Copy `.env.example` → `.env` and fill in token / client / guild ids

```bash
cd security
npm install
npm run deploy
npm start
```

## First steps in Discord

```
/security setup logs:#server-logs modlogs:#mod-logs
/security automod enabled:True
/security word action:Add text:badword
```

## Features

**Logs**
- Message delete / edit
- Join / leave / ban / unban
- Nickname + role changes
- Voice join / leave / move
- Channel create / delete
- Mod action logs

**Automod**
- Invite links
- Optional all-links filter
- Banned words
- Mass mentions
- Caps spam
- Message spam
- Auto delete + timeout/kick + warning

**Moderation**
- `/warn` `/warnings` `/clearwarnings`
- `/timeout` `/kick` `/ban` `/unban`
- `/purge` `/lock` `/unlock` `/slowmode`

## Render

Create a second Web Service with:
- **Root directory:** `security`
- **Build:** `npm install`
- **Start:** `npm start`
- Env: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (Security bot values — not Helper’s)
