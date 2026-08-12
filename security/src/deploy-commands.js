require('dotenv').config();
const { REST, Routes } = require('discord.js');
const { commands } = require('./commands');

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

module.exports = { deployCommands };

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
      process.exit(1);
    });
}
