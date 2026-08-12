require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

function inviteUrl(clientId) {
  // View Channel, Send, Manage Messages, Embed Links, Attach Files,
  // Read History, Moderate Members, Kick, Ban, Manage Channels, View Audit Log
  const permissionInteger = '1099916375046';
  const scopes = encodeURIComponent('bot applications.commands');
  return `https://discord.com/api/oauth2/authorize?client_id=${clientId}&permissions=${permissionInteger}&scope=${scopes}`;
}

async function deployCommands({ token, clientId, guildId }) {
  if (!token || !clientId) throw new Error('Missing token or clientId');
  const body = commands.map((c) => c.data.toJSON());
  const rest = new REST({ version: '10' }).setToken(token);

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
    console.log(`Deployed ${body.length} guild slash commands to ${guildId}`);
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body });
    console.log(`Deployed ${body.length} global slash commands`);
  }
}

async function deployCommandsSafe(client, token) {
  // Always use the application ID from the logged-in client (avoids CLIENT_ID mismatch)
  const app = client.application ?? (await client.application.fetch());
  const clientId = app.id;
  const bodyCount = commands.length;
  const guildIds = [...new Set([process.env.GUILD_ID, ...client.guilds.cache.keys()].filter(Boolean))];

  let deployed = false;
  const errors = [];

  for (const guildId of guildIds) {
    try {
      await deployCommands({ token, clientId, guildId });
      deployed = true;
    } catch (err) {
      errors.push({ guildId, code: err.code, message: err.message });
      console.error(`Guild command deploy failed for ${guildId}: ${err.message}`);
    }
  }

  if (!deployed) {
    try {
      await deployCommands({ token, clientId, guildId: null });
      deployed = true;
      console.log('Fell back to global slash commands (can take up to ~1 hour to appear).');
    } catch (err) {
      errors.push({ guildId: 'global', code: err.code, message: err.message });
      console.error('Global command deploy failed:', err.message);
    }
  }

  if (!deployed || errors.some((e) => e.code === 50001)) {
    console.error('────────────────────────────────────────');
    console.error('Slash commands Missing Access (50001)');
    console.error('Fix: re-invite the bot with BOTH scopes:');
    console.error('  bot + applications.commands');
    console.error('Invite URL:');
    console.error(`  ${inviteUrl(clientId)}`);
    console.error('Also confirm CLIENT_ID is this app:', clientId);
    console.error('And the bot is actually in GUILD_ID.');
    console.error('────────────────────────────────────────');
  }

  return { deployed, clientId, bodyCount, errors };
}

module.exports = { deployCommands, deployCommandsSafe, inviteUrl };

if (require.main === module) {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.CLIENT_ID;
  const guildId = process.env.GUILD_ID;
  if (!token || !clientId) {
    console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
    process.exit(1);
  }
  deployCommands({ token, clientId, guildId })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      console.error('Invite with applications.commands:');
      console.error(inviteUrl(clientId));
      process.exit(1);
    });
}
