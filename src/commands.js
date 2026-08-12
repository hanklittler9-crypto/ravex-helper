const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { getGuildConfig, getTicketByChannel } = require('./storage');
const {
  brandEmbed,
  ticketPanelEmbed,
  ticketPanelRow,
  ensureTicketInfrastructure,
  openTicket,
  closeTicket,
} = require('./tickets');
const {
  getWelcome,
  saveWelcome,
  buildWelcomePayload,
  statusEmbed,
  studioComponents,
  variablesEmbed,
  DEFAULT_WELCOME,
} = require('./welcome');

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('welcome')
      .setDescription('Advanced welcome customizer')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) => sub.setName('studio').setDescription('Open the interactive welcome customizer'))
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
          .setDescription('Set the main embed description')
          .addStringOption((opt) =>
            opt
              .setName('text')
              .setDescription('Supports variables like {user} {server} {count}')
              .setRequired(true)
              .setMaxLength(1000)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('title')
          .setDescription('Set the embed title')
          .addStringOption((opt) =>
            opt.setName('text').setDescription('Title text').setRequired(true).setMaxLength(256)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('color')
          .setDescription('Set embed color')
          .addStringOption((opt) =>
            opt.setName('hex').setDescription('Example: #5b8def').setRequired(true).setMaxLength(7)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('image')
          .setDescription('Set the large banner image URL')
          .addStringOption((opt) =>
            opt.setName('url').setDescription('Image URL (or none to clear)').setRequired(true)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('thumbnail')
          .setDescription('Set thumbnail source')
          .addStringOption((opt) =>
            opt
              .setName('mode')
              .setDescription('Thumbnail mode')
              .setRequired(true)
              .addChoices(
                { name: 'User avatar', value: 'user' },
                { name: 'Server icon', value: 'server' },
                { name: 'Custom URL', value: 'url' },
                { name: 'None', value: 'none' }
              )
          )
          .addStringOption((opt) => opt.setName('url').setDescription('Required when mode is url'))
      )
      .addSubcommand((sub) =>
        sub
          .setName('ping')
          .setDescription('Toggle pinging the new member')
          .addBooleanOption((opt) => opt.setName('enabled').setDescription('Ping the user?').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('embed')
          .setDescription('Toggle embed mode')
          .addBooleanOption((opt) => opt.setName('enabled').setDescription('Use an embed?').setRequired(true))
      )
      .addSubcommand((sub) =>
        sub
          .setName('dm')
          .setDescription('Configure DM welcome')
          .addBooleanOption((opt) => opt.setName('enabled').setDescription('Send a DM on join?').setRequired(true))
          .addStringOption((opt) =>
            opt.setName('text').setDescription('DM message').setMaxLength(1000)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('leave')
          .setDescription('Configure leave messages')
          .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable leave messages?').setRequired(true))
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Leave channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          )
          .addStringOption((opt) =>
            opt.setName('text').setDescription('Leave message').setMaxLength(1000)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('autorole')
          .setDescription('Manage join auto-roles')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('What to do')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'Remove', value: 'remove' },
                { name: 'List', value: 'list' },
                { name: 'Clear', value: 'clear' }
              )
          )
          .addRoleOption((opt) => opt.setName('role').setDescription('Role for add/remove'))
      )
      .addSubcommand((sub) =>
        sub
          .setName('pool')
          .setDescription('Manage random welcome message pool')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('What to do')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'List', value: 'list' },
                { name: 'Remove', value: 'remove' },
                { name: 'Clear', value: 'clear' }
              )
          )
          .addStringOption((opt) =>
            opt.setName('text').setDescription('Message text for add, or number for remove').setMaxLength(1000)
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('field')
          .setDescription('Add or clear embed fields')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('What to do')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'List', value: 'list' },
                { name: 'Clear', value: 'clear' }
              )
          )
          .addStringOption((opt) => opt.setName('name').setDescription('Field name').setMaxLength(256))
          .addStringOption((opt) => opt.setName('value').setDescription('Field value').setMaxLength(1024))
          .addBooleanOption((opt) => opt.setName('inline').setDescription('Inline field?'))
      )
      .addSubcommand((sub) =>
        sub
          .setName('rules')
          .setDescription('Set channel used by {rules} variable')
          .addChannelOption((opt) =>
            opt
              .setName('channel')
              .setDescription('Rules channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true)
          )
      )
      .addSubcommand((sub) => sub.setName('variables').setDescription('Show all template variables'))
      .addSubcommand((sub) => sub.setName('status').setDescription('Show current welcome config'))
      .addSubcommand((sub) => sub.setName('preview').setDescription('Preview welcome as an ephemeral message'))
      .addSubcommand((sub) => sub.setName('test').setDescription('Send a test welcome to the welcome channel'))
      .addSubcommand((sub) =>
        sub
          .setName('enable')
          .setDescription('Enable or disable the welcome system')
          .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enabled?').setRequired(true))
      )
      .addSubcommand((sub) => sub.setName('reset').setDescription('Reset welcome settings to defaults')),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (sub === 'studio') {
        const welcome = getWelcome(guildId);
        return interaction.reply({
          embeds: [statusEmbed(interaction.guild, welcome)],
          components: studioComponents(),
          ephemeral: true,
        });
      }

      if (sub === 'channel') {
        const channel = interaction.options.getChannel('channel');
        saveWelcome(guildId, { channelId: channel.id, enabled: true });
        return interaction.reply({
          embeds: [brandEmbed().setTitle('Welcome channel set').setDescription(`Welcomes go to ${channel}.`)],
          ephemeral: true,
        });
      }

      if (sub === 'message') {
        const text = interaction.options.getString('text');
        saveWelcome(guildId, { description: text });
        return interaction.reply({
          embeds: [brandEmbed().setTitle('Welcome message updated').setDescription(text)],
          ephemeral: true,
        });
      }

      if (sub === 'title') {
        saveWelcome(guildId, { title: interaction.options.getString('text') });
        return interaction.reply({ content: 'Title updated.', ephemeral: true });
      }

      if (sub === 'color') {
        saveWelcome(guildId, { color: interaction.options.getString('hex') });
        return interaction.reply({ content: 'Color updated.', ephemeral: true });
      }

      if (sub === 'image') {
        const url = interaction.options.getString('url');
        saveWelcome(guildId, { imageUrl: url.toLowerCase() === 'none' ? '' : url });
        return interaction.reply({ content: 'Banner image updated.', ephemeral: true });
      }

      if (sub === 'thumbnail') {
        const mode = interaction.options.getString('mode');
        const url = interaction.options.getString('url') || '';
        if (mode === 'url' && !url) {
          return interaction.reply({ content: 'Provide a url when mode is url.', ephemeral: true });
        }
        saveWelcome(guildId, { thumbnail: mode, thumbnailUrl: url });
        return interaction.reply({ content: `Thumbnail set to \`${mode}\`.`, ephemeral: true });
      }

      if (sub === 'ping') {
        saveWelcome(guildId, { pingUser: interaction.options.getBoolean('enabled') });
        return interaction.reply({ content: 'Ping setting updated.', ephemeral: true });
      }

      if (sub === 'embed') {
        saveWelcome(guildId, { useEmbed: interaction.options.getBoolean('enabled') });
        return interaction.reply({ content: 'Embed mode updated.', ephemeral: true });
      }

      if (sub === 'dm') {
        const enabled = interaction.options.getBoolean('enabled');
        const text = interaction.options.getString('text');
        const patch = { dmEnabled: enabled };
        if (text) patch.dmMessage = text;
        saveWelcome(guildId, patch);
        return interaction.reply({ content: `DM welcome ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
      }

      if (sub === 'leave') {
        const enabled = interaction.options.getBoolean('enabled');
        const channel = interaction.options.getChannel('channel');
        const text = interaction.options.getString('text');
        const patch = { leaveEnabled: enabled };
        if (channel) patch.leaveChannelId = channel.id;
        if (text) patch.leaveMessage = text;
        saveWelcome(guildId, patch);
        return interaction.reply({ content: `Leave messages ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
      }

      if (sub === 'autorole') {
        const action = interaction.options.getString('action');
        const role = interaction.options.getRole('role');
        const welcome = getWelcome(guildId);
        if (action === 'list') {
          const list = welcome.autoRoleIds.length
            ? welcome.autoRoleIds.map((id) => `<@&${id}>`).join(', ')
            : '*none*';
          return interaction.reply({ content: `Auto-roles: ${list}`, ephemeral: true });
        }
        if (action === 'clear') {
          saveWelcome(guildId, { autoRoleIds: [] });
          return interaction.reply({ content: 'Cleared auto-roles.', ephemeral: true });
        }
        if (!role) return interaction.reply({ content: 'Pick a role.', ephemeral: true });
        if (action === 'add') {
          const autoRoleIds = [...new Set([...welcome.autoRoleIds, role.id])].slice(0, 10);
          saveWelcome(guildId, { autoRoleIds });
          return interaction.reply({ content: `Added ${role}.`, ephemeral: true });
        }
        saveWelcome(guildId, { autoRoleIds: welcome.autoRoleIds.filter((id) => id !== role.id) });
        return interaction.reply({ content: `Removed ${role}.`, ephemeral: true });
      }

      if (sub === 'pool') {
        const action = interaction.options.getString('action');
        const text = interaction.options.getString('text');
        const welcome = getWelcome(guildId);
        if (action === 'list') {
          if (!welcome.messages.length) {
            return interaction.reply({ content: 'Pool is empty (using main description).', ephemeral: true });
          }
          const list = welcome.messages.map((m, i) => `**${i + 1}.** ${m}`).join('\n').slice(0, 3900);
          return interaction.reply({
            embeds: [brandEmbed().setTitle('Welcome message pool').setDescription(list)],
            ephemeral: true,
          });
        }
        if (action === 'clear') {
          saveWelcome(guildId, { messages: [] });
          return interaction.reply({ content: 'Pool cleared.', ephemeral: true });
        }
        if (action === 'add') {
          if (!text) return interaction.reply({ content: 'Provide text to add.', ephemeral: true });
          saveWelcome(guildId, { messages: [...welcome.messages, text].slice(0, 25) });
          return interaction.reply({ content: `Added. Pool size: ${Math.min(welcome.messages.length + 1, 25)}.`, ephemeral: true });
        }
        if (action === 'remove') {
          const index = Number(text) - 1;
          if (!Number.isInteger(index) || index < 0 || index >= welcome.messages.length) {
            return interaction.reply({ content: 'Provide the message number to remove (see `/welcome pool list`).', ephemeral: true });
          }
          const messages = welcome.messages.filter((_, i) => i !== index);
          saveWelcome(guildId, { messages });
          return interaction.reply({ content: `Removed message #${index + 1}.`, ephemeral: true });
        }
      }

      if (sub === 'field') {
        const action = interaction.options.getString('action');
        const welcome = getWelcome(guildId);
        if (action === 'list') {
          if (!welcome.fields.length) return interaction.reply({ content: 'No fields.', ephemeral: true });
          const list = welcome.fields
            .map((f, i) => `**${i + 1}.** ${f.name} → ${f.value}${f.inline ? ' _(inline)_' : ''}`)
            .join('\n');
          return interaction.reply({ embeds: [brandEmbed().setTitle('Welcome fields').setDescription(list)], ephemeral: true });
        }
        if (action === 'clear') {
          saveWelcome(guildId, { fields: [] });
          return interaction.reply({ content: 'Fields cleared.', ephemeral: true });
        }
        const name = interaction.options.getString('name');
        const value = interaction.options.getString('value');
        if (!name || !value) return interaction.reply({ content: 'Provide name and value.', ephemeral: true });
        const fields = [...welcome.fields, { name, value, inline: Boolean(interaction.options.getBoolean('inline')) }].slice(0, 25);
        saveWelcome(guildId, { fields });
        return interaction.reply({ content: 'Field added.', ephemeral: true });
      }

      if (sub === 'rules') {
        const channel = interaction.options.getChannel('channel');
        saveWelcome(guildId, { rulesChannelId: channel.id });
        return interaction.reply({ content: `{rules} will mention ${channel}.`, ephemeral: true });
      }

      if (sub === 'variables') {
        return interaction.reply({ embeds: [variablesEmbed()], ephemeral: true });
      }

      if (sub === 'status') {
        return interaction.reply({
          embeds: [statusEmbed(interaction.guild, getWelcome(guildId))],
          ephemeral: true,
        });
      }

      if (sub === 'preview') {
        const payload = buildWelcomePayload(interaction.member, getWelcome(guildId));
        return interaction.reply({ ...payload, ephemeral: true });
      }

      if (sub === 'test') {
        const welcome = getWelcome(guildId);
        if (!welcome.channelId) {
          return interaction.reply({ content: 'Set a welcome channel first.', ephemeral: true });
        }
        const channel = await interaction.guild.channels.fetch(welcome.channelId).catch(() => null);
        if (!channel?.isTextBased()) {
          return interaction.reply({ content: 'Welcome channel not found.', ephemeral: true });
        }
        await channel.send(buildWelcomePayload(interaction.member, welcome));
        return interaction.reply({ content: `Test welcome sent in ${channel}.`, ephemeral: true });
      }

      if (sub === 'enable') {
        const enabled = interaction.options.getBoolean('enabled');
        saveWelcome(guildId, { enabled });
        return interaction.reply({ content: `Welcome system ${enabled ? 'enabled' : 'disabled'}.`, ephemeral: true });
      }

      if (sub === 'reset') {
        saveWelcome(guildId, { ...DEFAULT_WELCOME });
        return interaction.reply({ content: 'Welcome settings reset to defaults.', ephemeral: true });
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
      .addSubcommand((sub) => sub.setName('close').setDescription('Close the current ticket'))
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
                '`/welcome studio` — full interactive customizer',
                '`/welcome preview` / `test` / `status` / `variables`',
                '`/welcome message` `title` `color` `image` `thumbnail`',
                '`/welcome dm` `leave` `autorole` `pool` `field` `rules`',
                '',
                '**Tickets / Modmail**',
                '`/ticket setup` · `/ticket panel` · `/ticket open`',
                '`/ticket close` · `/ticket add` · `/ticket remove`',
                '',
                'DM the bot to open modmail.',
              ].join('\n')
            ),
        ],
        ephemeral: true,
      });
    },
  },
];

module.exports = { commands };
