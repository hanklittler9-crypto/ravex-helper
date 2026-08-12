require('dotenv').config();

const http = require('http');
const {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  PermissionFlagsBits,
  Collection,
  ActivityType,
} = require('discord.js');
const { ensureDataFiles, getGuildConfig, getTicketByChannel, getOpenTicketForUser } = require('./storage');
const { restoreFromDiscord, setPersistenceClient } = require('./persist');
const { commands } = require('./commands');
const { deployCommands } = require('./deploy-commands');
const { openTicket, closeTicket, claimTicket, brandEmbed, BRAND } = require('./tickets');
const { sendWelcome, sendLeave, handleWelcomeInteraction } = require('./welcome');
const { handlePrefixCommands, handleAfkPassive, PREFIX } = require('./prefix');

ensureDataFiles();

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in .env — copy .env.example to .env and fill it in.');
  process.exit(1);
}

// Render Web Service requires a process listening on PORT
const port = Number(process.env.PORT) || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`${BRAND.name} is online`);
  })
  .listen(port, () => {
    console.log(`Health server listening on ${port}`);
  });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.commands = new Collection();
for (const command of commands) {
  client.commands.set(command.data.name, command);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`${BRAND.name} online as ${c.user.tag}`);
  c.user.setActivity(`${PREFIX}help · tickets & welcomes`, { type: ActivityType.Watching });
  setPersistenceClient(c);

  try {
    await restoreFromDiscord(c);
  } catch (err) {
    console.error('Config restore failed:', err);
  }

  try {
    const clientId = process.env.CLIENT_ID || c.user.id;
    if (process.env.GUILD_ID) {
      await deployCommands({ token, clientId, guildId: process.env.GUILD_ID });
    } else if (c.guilds.cache.size > 0) {
      for (const guild of c.guilds.cache.values()) {
        await deployCommands({ token, clientId, guildId: guild.id });
      }
    } else {
      await deployCommands({ token, clientId, guildId: null });
    }
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    await sendWelcome(member);
  } catch (err) {
    console.error('Welcome error:', err);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  try {
    await sendLeave(member);
  } catch (err) {
    console.error('Leave error:', err);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (await handleWelcomeInteraction(interaction)) return;

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }

    if (!interaction.isButton()) return;

    if (interaction.customId === 'ticket_open') {
      await interaction.deferReply({ ephemeral: true });
      const result = await openTicket(interaction.guild, interaction.user, 'panel');
      if (result.error) return interaction.editReply({ content: result.error });
      return interaction.editReply({ content: `Your ticket is ready: ${result.channel}` });
    }

    if (interaction.customId === 'ticket_close') {
      const config = getGuildConfig(interaction.guild.id);
      const ticket = getTicketByChannel(interaction.channel.id);
      const isStaff =
        interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) ||
        (config.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId));
      if (!ticket || (!isStaff && ticket.userId !== interaction.user.id)) {
        return interaction.reply({ content: 'You cannot close this ticket.', ephemeral: true });
      }
      await interaction.deferReply();
      const result = await closeTicket(interaction.channel, interaction.user);
      if (result.error) return interaction.editReply({ content: result.error });
      return interaction.editReply({ content: 'Closing ticket…' });
    }

    if (interaction.customId === 'ticket_claim') {
      const config = getGuildConfig(interaction.guild.id);
      const isStaff =
        interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) ||
        (config.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId));
      if (!isStaff) {
        return interaction.reply({ content: 'Only staff can claim tickets.', ephemeral: true });
      }
      await interaction.deferReply({ ephemeral: true });
      const result = await claimTicket(interaction.channel, interaction.user);
      if (result.error) return interaction.editReply({ content: result.error });
      return interaction.editReply({ content: 'Ticket claimed.' });
    }
  } catch (err) {
    console.error('Interaction error:', err);
    const payload = { content: 'Something went wrong. Try again.', ephemeral: true };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(payload).catch(() => null);
    } else {
      await interaction.reply(payload).catch(() => null);
    }
  }
});

// Modmail: user DMs the bot → open/relay to ticket
// Staff replies in ticket (prefix with ! or just talk) → relay to user DM when source is modmail
client.on(Events.MessageCreate, async (message) => {
  try {
    if (message.author.bot) return;

    // Incoming DM modmail
    if (!message.guild) {
      const guildId = process.env.GUILD_ID;
      if (!guildId) {
        await message.reply('Modmail is not configured (missing GUILD_ID).');
        return;
      }
      const guild = await client.guilds.fetch(guildId).catch(() => null);
      if (!guild) {
        await message.reply('I could not find the configured server.');
        return;
      }

      const existing = getOpenTicketForUser(guild.id, message.author.id);
      if (existing) {
        const channel = await guild.channels.fetch(existing.channelId).catch(() => null);
        if (channel?.isTextBased()) {
          await channel.send({
            embeds: [
              brandEmbed()
                .setAuthor({
                  name: `${message.author.tag} (DM)`,
                  iconURL: message.author.displayAvatarURL(),
                })
                .setDescription(message.content || '*attachment only*')
                .setTimestamp(),
            ],
            files: [...message.attachments.values()].map((a) => a.url),
          });
          await message.react('✅').catch(() => null);
          return;
        }
      }

      await message.channel.sendTyping();
      const result = await openTicket(guild, message.author, 'modmail', message.content || null);
      if (result.error) {
        await message.reply(result.error);
        return;
      }

      if (message.attachments.size) {
        await result.channel.send({
          files: [...message.attachments.values()].map((a) => a.url),
        });
      }

      await message.reply({
        embeds: [
          brandEmbed()
            .setTitle('Modmail opened')
            .setDescription(
              `Your message was sent to **${guild.name}** staff.\nReply here to continue the conversation.`
            ),
        ],
      });
      return;
    }

    // Guild: prefix commands + AFK
    if (await handlePrefixCommands(message)) return;
    await handleAfkPassive(message);

    // Staff → user relay for modmail tickets
    const ticket = getTicketByChannel(message.channel.id);
    if (!ticket || ticket.status !== 'open' || ticket.source !== 'modmail') return;
    if (message.author.id === ticket.userId) return;

    const config = getGuildConfig(message.guild.id);
    const isStaff =
      message.member?.permissions.has(PermissionFlagsBits.ManageChannels) ||
      (config.supportRoleId && message.member?.roles.cache.has(config.supportRoleId));
    if (!isStaff) return;

    // Skip bot command-ish messages starting with /
    if (message.content.startsWith('/')) return;
    if (message.content.startsWith(PREFIX)) return;

    const user = await client.users.fetch(ticket.userId).catch(() => null);
    if (!user) return;

    await user
      .send({
        embeds: [
          brandEmbed()
            .setAuthor({
              name: `${message.member.displayName} · ${message.guild.name}`,
              iconURL: message.author.displayAvatarURL(),
            })
            .setDescription(message.content || '*attachment only*')
            .setTimestamp(),
        ],
        files: [...message.attachments.values()].map((a) => a.url),
      })
      .then(() => message.react('📨'))
      .catch(async () => {
        await message.reply({ content: 'Could not DM the user (DMs closed).' }).catch(() => null);
      });
  } catch (err) {
    console.error('Message error:', err);
  }
});

client.login(token);
