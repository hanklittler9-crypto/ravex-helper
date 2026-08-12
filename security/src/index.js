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
const { restoreFromDiscord, setPersistenceClient } = require('./persist');
const { commands } = require('./commands');
const { deployCommandsSafe } = require('./deploy-commands');
const { registerEvents } = require('./events');
const { BRAND, ensureLogChannel, sendLog, brandEmbed } = require('./logger');

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
  setPersistenceClient(c);

  try {
    await restoreFromDiscord(c);
  } catch (err) {
    console.error('Config restore failed:', err);
  }

  for (const guild of c.guilds.cache.values()) {
    try {
      const channel = await ensureLogChannel(guild);
      const cfg = getConfig(guild.id);
      if (channel) {
        console.log(`[logs] ${guild.name}: logging to #${channel.name} (${cfg.logChannelId})`);
        await sendLog(
          guild,
          brandEmbed(BRAND.ok)
            .setTitle('Ravex Security online')
            .setDescription('Message delete/edit logging is active in this channel.')
        );
      } else {
        console.warn(`[logs] ${guild.name}: no log channel. Set LOG_CHANNEL_ID or run /security setup`);
      }
    } catch (err) {
      console.error(`[logs] setup failed for ${guild.name}:`, err.message);
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
