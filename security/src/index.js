require('dotenv').config();

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  Collection,
  ActivityType,
} = require('discord.js');
const { ensure, getConfig } = require('./storage');
const { commands } = require('./commands');
const { deployCommandsSafe } = require('./deploy-commands');
const { registerEvents } = require('./events');
const { BRAND } = require('./logger');

ensure();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in security/.env');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3001;
http
  .createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`${BRAND.name} is online`);
  })
  .listen(port, () => console.log(`Health server listening on ${port}`));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember],
});

client.commands = new Collection();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

registerEvents(client);

client.once(Events.ClientReady, async (c) => {
  console.log(`${BRAND.name} online as ${c.user.tag}`);
  c.user.setActivity('protecting the server', { type: ActivityType.Watching });

  for (const guild of c.guilds.cache.values()) {
    const cfg = getConfig(guild.id);
    if (!cfg.logChannelId) {
      console.warn(`[logs] ${guild.name}: no log channel set. Run /security setup logs:#channel`);
    } else {
      console.log(`[logs] ${guild.name}: logging to ${cfg.logChannelId}`);
    }
  }

  try {
    await deployCommandsSafe(c, token);
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    await command.execute(interaction);
  } catch (err) {
    console.error('Interaction error:', err);
    const payload = { content: `Command failed: ${err.message}`, ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
    else await interaction.reply(payload).catch(() => null);
  }
});

client.login(token);
