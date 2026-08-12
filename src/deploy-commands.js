require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.CLIENT_ID;
const guildId = process.env.GUILD_ID;

if (!token || !clientId) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID in .env');
  process.exit(1);
}

const body = commands.map((c) => c.data.toJSON());
const rest = new REST({ version: '10' }).setToken(token);

(async () => {
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body });
      console.log(`Deployed ${body.length} guild commands to ${guildId}`);
    } else {
      await rest.put(Routes.applicationCommands(clientId), { body });
      console.log(`Deployed ${body.length} global commands (can take up to ~1 hour)`);
    }
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
})();
