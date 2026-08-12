const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
} = require('discord.js');
const { getConfig, setConfig, getWarnings, addWarning, clearWarnings } = require('./storage');
const { brandEmbed, sendLog, BRAND, ensureLogChannel } = require('./logger');

function msFromDuration(input) {
  if (!input) return 5 * 60 * 1000;
  const match = String(input).trim().match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!match) return null;
  const n = Number(match[1]);
  const unit = (match[2] || 'm').toLowerCase();
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
  return n * mult;
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('security')
      .setDescription('Configure Ravex Security')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand((sub) =>
        sub
          .setName('setup')
          .setDescription('Set log channels')
          .addChannelOption((opt) =>
            opt
              .setName('logs')
              .setDescription('Server event log channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
              .setRequired(true)
          )
          .addChannelOption((opt) =>
            opt
              .setName('modlogs')
              .setDescription('Moderation / automod log channel')
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
          )
      )
      .addSubcommand((sub) => sub.setName('status').setDescription('Show security config'))
      .addSubcommand((sub) =>
        sub.setName('testlog').setDescription('Send a test message to the log channel')
      )
      .addSubcommand((sub) =>
        sub
          .setName('automod')
          .setDescription('Toggle / tune automod')
          .addBooleanOption((opt) => opt.setName('enabled').setDescription('Enable automod'))
          .addBooleanOption((opt) => opt.setName('invites').setDescription('Block invite links'))
          .addBooleanOption((opt) => opt.setName('links').setDescription('Block all links'))
          .addIntegerOption((opt) =>
            opt.setName('mentions').setDescription('Max mentions per message').setMinValue(1).setMaxValue(20)
          )
          .addIntegerOption((opt) =>
            opt.setName('spam').setDescription('Messages allowed in spam window').setMinValue(2).setMaxValue(20)
          )
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('Punishment after delete')
              .addChoices(
                { name: 'Timeout', value: 'timeout' },
                { name: 'Kick', value: 'kick' },
                { name: 'Delete only', value: 'delete' }
              )
          )
      )
      .addSubcommand((sub) =>
        sub
          .setName('word')
          .setDescription('Manage banned words')
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
          .addStringOption((opt) => opt.setName('text').setDescription('Word/phrase'))
      )
      .addSubcommand((sub) =>
        sub
          .setName('staffrole')
          .setDescription('Roles ignored by automod / treated as staff')
          .addStringOption((opt) =>
            opt
              .setName('action')
              .setDescription('What to do')
              .setRequired(true)
              .addChoices(
                { name: 'Add', value: 'add' },
                { name: 'Remove', value: 'remove' },
                { name: 'List', value: 'list' }
              )
          )
          .addRoleOption((opt) => opt.setName('role').setDescription('Staff role'))
      ),
    async execute(interaction) {
      const sub = interaction.options.getSubcommand();
      const guildId = interaction.guild.id;

      if (sub === 'setup') {
        const logs = interaction.options.getChannel('logs');
        const modlogs = interaction.options.getChannel('modlogs');
        const patch = { logChannelId: logs.id };
        if (modlogs) patch.modLogChannelId = modlogs.id;
        else patch.modLogChannelId = logs.id;
        setConfig(guildId, patch);

        const ok = await sendLog(
          interaction.guild,
          brandEmbed(BRAND.ok)
            .setTitle('Logging is live')
            .setDescription(
              `Delete a message anywhere in the server to test.\nLogs channel: ${logs}\nTriggered by ${interaction.user}`
            )
        );

        return interaction.reply({
          embeds: [
            brandEmbed(BRAND.ok)
              .setTitle('Security setup complete')
              .setDescription(
                [
                  `Logs: ${logs}`,
                  `Mod logs: ${modlogs || logs}`,
                  ok
                    ? 'A test log was posted in that channel.'
                    : '⚠️ Could not post a test log — check my **Send Messages** + **Embed Links** perms there.',
                  '',
                  'Automod is on by default. Use `/security automod` to tune it.',
                ].join('\n')
              ),
          ],
          ephemeral: true,
        });
      }

      if (sub === 'testlog') {
        await interaction.deferReply({ ephemeral: true });
        const channel = await ensureLogChannel(interaction.guild);
        if (!channel) {
          return interaction.editReply({
            content: 'No log channel and I could not create one. Run `/security setup` or give me Manage Channels.',
          });
        }
        const ok = await sendLog(
          interaction.guild,
          brandEmbed(BRAND.info)
            .setTitle('Test log')
            .setDescription(`If you see this, logging works.\nRequested by ${interaction.user}`)
        );
        return interaction.editReply({
          content: ok
            ? `Test log sent in ${channel}.`
            : `Failed to send in ${channel}. I need **View Channel**, **Send Messages**, and **Embed Links** there.`,
        });
      }

      if (sub === 'status') {
        const c = getConfig(guildId);
        return interaction.reply({
          embeds: [
            brandEmbed()
              .setTitle('Ravex Security status')
              .addFields(
                {
                  name: 'Channels',
                  value: [
                    `Logs: ${c.logChannelId ? `<#${c.logChannelId}>` : '*not set*'}`,
                    `Mod logs: ${c.modLogChannelId ? `<#${c.modLogChannelId}>` : '*not set*'}`,
                  ].join('\n'),
                },
                {
                  name: 'Automod',
                  value: [
                    `Enabled: **${c.automod.enabled ? 'yes' : 'no'}**`,
                    `Invites: **${c.automod.deleteInvite ? 'block' : 'allow'}**`,
                    `Links: **${c.automod.deleteLinks ? 'block' : 'allow'}**`,
                    `Max mentions: **${c.automod.maxMentions}**`,
                    `Spam: **${c.automod.spamThreshold}/${(c.automod.spamWindowMs / 1000)}s**`,
                    `Caps: **${c.automod.maxCapsPercent}%**`,
                    `Action: **${c.automod.action}**`,
                    `Banned words: **${c.automod.bannedWords.length}**`,
                    `Staff roles: **${c.staffRoleIds.length}**`,
                  ].join('\n'),
                }
              ),
          ],
          ephemeral: true,
        });
      }

      if (sub === 'automod') {
        const current = getConfig(guildId).automod;
        const patch = { ...current };
        const enabled = interaction.options.getBoolean('enabled');
        const invites = interaction.options.getBoolean('invites');
        const links = interaction.options.getBoolean('links');
        const mentions = interaction.options.getInteger('mentions');
        const spam = interaction.options.getInteger('spam');
        const action = interaction.options.getString('action');
        if (enabled !== null) patch.enabled = enabled;
        if (invites !== null) patch.deleteInvite = invites;
        if (links !== null) patch.deleteLinks = links;
        if (mentions !== null) patch.maxMentions = mentions;
        if (spam !== null) patch.spamThreshold = spam;
        if (action) patch.action = action;
        setConfig(guildId, { automod: patch });
        return interaction.reply({ content: 'Automod settings updated.', ephemeral: true });
      }

      if (sub === 'word') {
        const action = interaction.options.getString('action');
        const text = interaction.options.getString('text');
        const current = getConfig(guildId);
        const words = [...current.automod.bannedWords];
        if (action === 'list') {
          return interaction.reply({
            content: words.length ? words.map((w) => `\`${w}\``).join(', ') : 'No banned words.',
            ephemeral: true,
          });
        }
        if (action === 'clear') {
          setConfig(guildId, { automod: { ...current.automod, bannedWords: [] } });
          return interaction.reply({ content: 'Banned words cleared.', ephemeral: true });
        }
        if (!text) return interaction.reply({ content: 'Provide text.', ephemeral: true });
        if (action === 'add') {
          if (!words.includes(text.toLowerCase())) words.push(text.toLowerCase());
          setConfig(guildId, { automod: { ...current.automod, bannedWords: words } });
          return interaction.reply({ content: `Added \`${text}\`.`, ephemeral: true });
        }
        setConfig(guildId, {
          automod: { ...current.automod, bannedWords: words.filter((w) => w !== text.toLowerCase()) },
        });
        return interaction.reply({ content: `Removed \`${text}\`.`, ephemeral: true });
      }

      if (sub === 'staffrole') {
        const action = interaction.options.getString('action');
        const role = interaction.options.getRole('role');
        const current = getConfig(guildId);
        if (action === 'list') {
          const list = current.staffRoleIds.length
            ? current.staffRoleIds.map((id) => `<@&${id}>`).join(', ')
            : '*none*';
          return interaction.reply({ content: `Staff roles: ${list}`, ephemeral: true });
        }
        if (!role) return interaction.reply({ content: 'Pick a role.', ephemeral: true });
        if (action === 'add') {
          const staffRoleIds = [...new Set([...current.staffRoleIds, role.id])];
          setConfig(guildId, { staffRoleIds });
          return interaction.reply({ content: `Added ${role}.`, ephemeral: true });
        }
        setConfig(guildId, { staffRoleIds: current.staffRoleIds.filter((id) => id !== role.id) });
        return interaction.reply({ content: `Removed ${role}.`, ephemeral: true });
      }
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warn')
      .setDescription('Warn a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('Reason').setMaxLength(500)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const warnings = addWarning(interaction.guild.id, user.id, {
        id: `${Date.now()}`,
        moderatorId: interaction.user.id,
        reason,
        at: Date.now(),
      });
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.warn)
          .setTitle('Member warned')
          .addFields(
            { name: 'User', value: `${user} (\`${user.id}\`)`, inline: true },
            { name: 'Moderator', value: `${interaction.user}`, inline: true },
            { name: 'Warnings', value: String(warnings.length), inline: true },
            { name: 'Reason', value: reason }
          ),
        { mod: true }
      );
      await user.send(`You were warned in **${interaction.guild.name}**: ${reason}`).catch(() => null);
      return interaction.reply({ content: `Warned ${user}. They now have **${warnings.length}** warning(s).`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('warnings')
      .setDescription('View warnings for a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const list = getWarnings(interaction.guild.id, user.id);
      if (!list.length) return interaction.reply({ content: `${user} has no warnings.`, ephemeral: true });
      const lines = list
        .slice(-15)
        .map((w, i) => `**${i + 1}.** <@${w.moderatorId}> — ${w.reason} (<t:${Math.floor(w.at / 1000)}:R>)`)
        .join('\n');
      return interaction.reply({
        embeds: [brandEmbed(BRAND.warn).setTitle(`Warnings for ${user.tag}`).setDescription(lines)],
        ephemeral: true,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('clearwarnings')
      .setDescription('Clear warnings for a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      clearWarnings(interaction.guild.id, user.id);
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.ok)
          .setTitle('Warnings cleared')
          .setDescription(`${user} cleared by ${interaction.user}`),
        { mod: true }
      );
      return interaction.reply({ content: `Cleared warnings for ${user}.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('timeout')
      .setDescription('Timeout a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((opt) =>
        opt.setName('duration').setDescription('e.g. 10m, 1h, 1d').setRequired(true)
      )
      .addStringOption((opt) => opt.setName('reason').setDescription('Reason').setMaxLength(500)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      const ms = msFromDuration(interaction.options.getString('duration'));
      if (!ms || ms < 5000 || ms > 28 * 86_400_000) {
        return interaction.reply({ content: 'Duration must be between 5s and 28d (e.g. `10m`, `1h`).', ephemeral: true });
      }
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await member.timeout(ms, reason);
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.warn)
          .setTitle('Member timed out')
          .addFields(
            { name: 'User', value: `${user}`, inline: true },
            { name: 'Moderator', value: `${interaction.user}`, inline: true },
            { name: 'Duration', value: interaction.options.getString('duration'), inline: true },
            { name: 'Reason', value: reason }
          ),
        { mod: true }
      );
      return interaction.reply({ content: `Timed out ${user} for **${interaction.options.getString('duration')}**.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption((opt) => opt.setName('user').setDescription('Member').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('Reason').setMaxLength(500)),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      if (!member) return interaction.reply({ content: 'Member not found.', ephemeral: true });
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await member.kick(reason);
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.danger)
          .setTitle('Member kicked')
          .addFields(
            { name: 'User', value: `${user} (\`${user.id}\`)`, inline: true },
            { name: 'Moderator', value: `${interaction.user}`, inline: true },
            { name: 'Reason', value: reason }
          ),
        { mod: true }
      );
      return interaction.reply({ content: `Kicked ${user}.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a member')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption((opt) => opt.setName('user').setDescription('User').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('Reason').setMaxLength(500))
      .addIntegerOption((opt) =>
        opt.setName('delete_days').setDescription('Delete message history days (0-7)').setMinValue(0).setMaxValue(7)
      ),
    async execute(interaction) {
      const user = interaction.options.getUser('user');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      const days = interaction.options.getInteger('delete_days') ?? 0;
      await interaction.guild.members.ban(user.id, { reason, deleteMessageSeconds: days * 86400 });
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.danger)
          .setTitle('Member banned')
          .addFields(
            { name: 'User', value: `${user} (\`${user.id}\`)`, inline: true },
            { name: 'Moderator', value: `${interaction.user}`, inline: true },
            { name: 'Reason', value: reason }
          ),
        { mod: true }
      );
      return interaction.reply({ content: `Banned ${user}.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unban')
      .setDescription('Unban a user')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption((opt) => opt.setName('userid').setDescription('User ID').setRequired(true))
      .addStringOption((opt) => opt.setName('reason').setDescription('Reason').setMaxLength(500)),
    async execute(interaction) {
      const userId = interaction.options.getString('userid');
      const reason = interaction.options.getString('reason') || 'No reason provided';
      await interaction.guild.members.unban(userId, reason);
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.ok)
          .setTitle('User unbanned')
          .addFields(
            { name: 'User ID', value: userId, inline: true },
            { name: 'Moderator', value: `${interaction.user}`, inline: true },
            { name: 'Reason', value: reason }
          ),
        { mod: true }
      );
      return interaction.reply({ content: `Unbanned \`${userId}\`.`, ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('purge')
      .setDescription('Delete recent messages')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption((opt) =>
        opt.setName('amount').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100)
      )
      .addUserOption((opt) => opt.setName('user').setDescription('Only delete from this user')),
    async execute(interaction) {
      const amount = interaction.options.getInteger('amount');
      const user = interaction.options.getUser('user');
      await interaction.deferReply({ ephemeral: true });
      const fetched = await interaction.channel.messages.fetch({ limit: 100 });
      const filtered = fetched.filter((m) => (user ? m.author.id === user.id : true)).first(amount);
      const deleted = await interaction.channel.bulkDelete(filtered, true);
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.info)
          .setTitle('Messages purged')
          .setDescription(
            `${interaction.user} deleted **${deleted.size}** message(s) in ${interaction.channel}${
              user ? ` from ${user}` : ''
            }`
          ),
        { mod: true }
      );
      return interaction.editReply({ content: `Deleted **${deleted.size}** message(s).` });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('lock')
      .setDescription('Lock this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction) {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: false });
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.warn).setTitle('Channel locked').setDescription(`${interaction.channel} by ${interaction.user}`),
        { mod: true }
      );
      return interaction.reply({ content: 'Channel locked.' });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('unlock')
      .setDescription('Unlock this channel')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
    async execute(interaction) {
      await interaction.channel.permissionOverwrites.edit(interaction.guild.id, { SendMessages: null });
      await sendLog(
        interaction.guild,
        brandEmbed(BRAND.ok).setTitle('Channel unlocked').setDescription(`${interaction.channel} by ${interaction.user}`),
        { mod: true }
      );
      return interaction.reply({ content: 'Channel unlocked.' });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('slowmode')
      .setDescription('Set channel slowmode')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addIntegerOption((opt) =>
        opt.setName('seconds').setDescription('0 to disable').setRequired(true).setMinValue(0).setMaxValue(21600)
      ),
    async execute(interaction) {
      const seconds = interaction.options.getInteger('seconds');
      await interaction.channel.setRateLimitPerUser(seconds);
      return interaction.reply({ content: seconds ? `Slowmode set to **${seconds}s**.` : 'Slowmode disabled.', ephemeral: true });
    },
  },
  {
    data: new SlashCommandBuilder().setName('help').setDescription('Show Ravex Security commands'),
    async execute(interaction) {
      return interaction.reply({
        embeds: [
          brandEmbed()
            .setTitle('Ravex Security')
            .setDescription(
              [
                '**Setup**',
                '`/security setup` · `/security status` · `/security automod`',
                '`/security word` · `/security staffrole`',
                '',
                '**Moderation**',
                '`/warn` `/warnings` `/clearwarnings`',
                '`/timeout` `/kick` `/ban` `/unban`',
                '`/purge` `/lock` `/unlock` `/slowmode`',
                '',
                'Automod covers invites, spam, mass mentions, caps, banned words.',
              ].join('\n')
            ),
        ],
        ephemeral: true,
      });
    },
  },
];

module.exports = { commands };
