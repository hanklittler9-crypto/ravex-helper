const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { setGuildConfig, getGuildConfig, getTicketByChannel } = require('./storage');
const {
  brandEmbed,
  ticketPanelEmbed,
  ticketPanelRow,
  ensureTicketInfrastructure,
  openTicket,
  closeTicket,
  formatWelcome,
} = require('./tickets');

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Configure the welcome system')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('channel')
          .setDescription('Set the welcome channel')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Channel for welcome messages')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('message')
          .setDescription('Set the welcome message template')
          .addStringOption((opt) =>
            opt
              .setName('text')
              .setDescription('Use {user} {username} {server} {count}')
              .setRequired(true)
              .setMaxLength(1000)
          )
      )
      .addSubcommand((sub) => sub.setName('test').setDescription('Send a test welcome message'))
      .addSubcommand((sub) => sub.setName('disable').setDescription('Disable welcome messages')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel');
        setGuildConfig(guildId, { welcomeChannelId: channel.id });
        return interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle('Welcome channel set')
              .setDescription(`New members will be greeted in ${channel}.`),
          ],
          ephemeral: true,
        });
      }

      if (sub === 'message') {
        const text = interaction.options.getString('text');
        setGuildConfig(guildId, { welcomeMessage: text });
        return interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle('Welcome message updated')
              .setDescription(`Preview:\n${formatWelcome(text, interaction.member)}`),
          ],
          ephemeral: true,
        });
      }

      if (sub === 'disable') {
        setGuildConfig(guildId, { welcomeChannelId: null });
        return interaction.reply({
          embeds: [brandEmbed().setTitle('Welcome disabled').setDescription('Welcome messages are turned off.')],
          ephemeral: true,
        });
      }

      if (sub === 'test') {
        const config = getGuildConfig(guildId);
        if (!config.welcomeChannelId) {
          return interaction.reply({ content: 'Set a welcome channel first with `/welcome channel`.', ephemeral: true });
        }
        const channel = await interaction.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
        if (!channel) {
          return interaction.reply({ content: 'Welcome channel not found. Set it again.', ephemeral: true });
        }
        const text = formatWelcome(config.welcomeMessage, interaction.member);
        await channel.send({
          content: `<@${interaction.user.id}>`,
          embeds: [
            brandEmbed()
              .setTitle(`Welcome to ${interaction.guild.name}`)
              .setDescription(text)
              .setThumbnail(interaction.user.displayAvatarURL({ size: 256 }))
              .setTimestamp(),
          ],
        });
        return interaction.reply({ content: `Test welcome sent in ${channel}.`, ephemeral: true });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ticket')
      .setDescription('Ticket and modmail helpers')
      .addSubcommand((sub) =>
        sub
          .setName('panel')
          .setDescription('Post the open-ticket panel in this channel')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Where to post the panel (defaults to here)')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          )
      )
      .addSubcommand((sub) => sub.setName('setup').setDescription('Create ticket category, logs, and Support role'))
      .addSubcommand((sub) =>
        sub
          .setName('close')
          .setDescription('Close the current ticket')
      )
      .addSubcommand((sub) =>
        sub
          .setName('add')
          .setDescription('Add a member to this ticket')
          .addUserOption((opt) => opt.setName('user').setDescription('Member to add').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a member from this ticket')
          .addUserOption((opt) => opt.setName('user').setDescription('Member to remove').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('open')
          .setDescription('Open a ticket for yourself')
          .addStringOption((opt) =>
            opt.setName('reason').setDescription('Why you need help').setMaxLength(500)
          )
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const config = getGuildConfig(interaction.guild.id);
      const isStaff =
        interaction.memberPermissions.has(PermissionFlagsBits.ManageChannels) ||
        (config.supportRoleId && interaction.member.roles.cache.has(config.supportRoleId));

      if (sub === 'setup') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need Manage Server to run setup.', ephemeral: true });
        }
        await interaction.deferReply({ ephemeral: true });
        const cfg = await ensureTicketInfrastructure(interaction.guild);
        return interaction.editReply({
          embeds: [
            brandEmbed()
              .setTitle('Ticket system ready')
              .setDescription(
                [
                  `Category: <#${cfg.ticketCategoryId}>`,
                  `Logs: <#${cfg.ticketLogChannelId}>`,
                  `Support role: <@&${cfg.supportRoleId}>`,
                  '',
                  'Next: run `/ticket panel` in a public channel.',
                ].join('\n')
              ),
          ],
        });
      }

      if (sub === 'panel') {
        if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
          return interaction.reply({ content: 'You need Manage Server to post the panel.', ephemeral: true });
        }
        await ensureTicketInfrastructure(interaction.guild);
        const target = interaction.options.getChannel('channel') || interaction.channel;
        await target.send({ embeds: [ticketPanelEmbed()], components: [ticketPanelRow()] });
        return interaction.reply({ content: `Ticket panel posted in ${target}.`, ephemeral: true });
      }

      if (sub === 'open') {
        await interaction.deferReply({ ephemeral: true });
        const reason = interaction.options.getString('reason');
        const result = await openTicket(interaction.guild, interaction.user, 'command', reason);
        if (result.error) return interaction.editReply({ content: result.error });
        return interaction.editReply({ content: `Ticket created: ${result.channel}` });
      }

      if (sub === 'close') {
        const ticket = getTicketByChannel(interaction.channel.id);
        if (!ticket) {
          return interaction.reply({ content: 'This channel is not a ticket.', ephemeral: true });
        }
        if (!isStaff && ticket.userId !== interaction.user.id) {
          return interaction.reply({ content: 'Only staff or the ticket owner can close this.', ephemeral: true });
        }
        await interaction.deferReply();
        const result = await closeTicket(interaction.channel, interaction.user);
        if (result.error) return interaction.editReply({ content: result.error });
        return interaction.editReply({ content: 'Closing ticket…' });
      }

      if (sub === 'add' || sub === 'remove') {
        if (!isStaff) {
          return interaction.reply({ content: 'Only staff can manage ticket members.', ephemeral: true });
        }
        const ticket = getTicketByChannel(interaction.channel.id);
        if (!ticket) {
          return interaction.reply({ content: 'This command only works inside a ticket channel.', ephemeral: true });
        }
        const user = interaction.options.getUser('user');
        if (sub === 'add') {
          await interaction.channel.permissionOverwrites.edit(user.id, {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true,
            AttachFiles: true,
          });
          return interaction.reply({ content: `Added ${user} to this ticket.` });
        }
        await interaction.channel.permissionOverwrites.delete(user.id);
        return interaction.reply({ content: `Removed ${user} from this ticket.` });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('help')
      .setDescription('Show Ravex Helper commands'),
    async execute(interaction) {
      return interaction.reply({
        embeds: [
          brandEmbed()
            .setTitle('Ravex Helper')
            .setDescription(
              [
                '**Welcome**',
                '`/welcome channel` — set welcome channel',
                '`/welcome message` — customize message (`{user}` `{username}` `{server}` `{count}`)',
                '`/welcome test` — send a test welcome',
                '`/welcome disable` — turn welcomes off',
                '',
                '**Tickets / Modmail**',
                '`/ticket setup` — create category, logs, Support role',
                '`/ticket panel` — post the Open Ticket button',
                '`/ticket open` — open a ticket',
                '`/ticket close` — close current ticket',
                '`/ticket add` / `/ticket remove` — manage members',
                '',
                'DM the bot to open modmail. Staff replies in the ticket channel.',
              ].join('\n')
            ),
        ],
        ephemeral: true,
      });
    },
  },
];

module.exports = { commands };
