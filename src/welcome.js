const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
} = require('discord.js');
const { getGuildConfig, setGuildConfig } = require('./storage');
const { DEFAULT_WELCOME, normalizeWelcome } = require('./welcomeDefaults');

const BRAND = { name: 'Ravex Helper', color: 0x5b8def, footer: 'Ravex Helper' };

function brandEmbed() {
  return new EmbedBuilder().setColor(BRAND.color).setFooter({ text: BRAND.footer });
}

function getWelcome(guildId) {
  const cfg = getGuildConfig(guildId);
  return normalizeWelcome(cfg.welcome || cfg);
}

function saveWelcome(guildId, patch) {
  const current = getWelcome(guildId);
  const welcome = normalizeWelcome({ ...current, ...patch });
  setGuildConfig(guildId, {
    welcome,
    // keep legacy mirrors for older readers
    welcomeChannelId: welcome.channelId,
    welcomeMessage: welcome.description,
  });
  return welcome;
}

function relativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  const units = [
    ['year', 31536000],
    ['month', 2592000],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60],
  ];
  for (const [name, size] of units) {
    const value = Math.floor(seconds / size);
    if (value >= 1) return `${value} ${name}${value === 1 ? '' : 's'} ago`;
  }
  return 'just now';
}

function formatTemplate(template, member, extra = {}) {
  if (!template) return '';
  const user = member.user;
  const created = user.createdAt;
  const joined = member.joinedAt || new Date();
  const map = {
    '{user}': `<@${user.id}>`,
    '{username}': user.username,
    '{displayname}': member.displayName || user.globalName || user.username,
    '{tag}': user.tag || `${user.username}`,
    '{id}': user.id,
    '{server}': member.guild.name,
    '{serverid}': member.guild.id,
    '{count}': String(member.guild.memberCount),
    '{created}': relativeTime(created),
    '{createdAt}': `<t:${Math.floor(created.getTime() / 1000)}:D>`,
    '{joined}': relativeTime(joined),
    '{joinedAt}': `<t:${Math.floor(joined.getTime() / 1000)}:R>`,
    '{avatar}': user.displayAvatarURL({ size: 256 }),
    '{rules}': extra.rulesChannelId ? `<#${extra.rulesChannelId}>` : '#rules',
  };
  let out = String(template);
  for (const [key, value] of Object.entries(map)) {
    out = out.split(key).join(value);
  }
  return out;
}

function parseColor(input, fallback = BRAND.color) {
  if (!input) return fallback;
  const raw = String(input).trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(raw)) return parseInt(raw, 16);
  if (/^[0-9a-fA-F]{3}$/.test(raw)) {
    return parseInt(raw.split('').map((c) => c + c).join(''), 16);
  }
  return fallback;
}

function resolveIcon(mode, url, member) {
  if (mode === 'user') return member.user.displayAvatarURL({ size: 256 });
  if (mode === 'server') return member.guild.iconURL({ size: 256 }) || undefined;
  if (mode === 'url' && url) return url;
  return undefined;
}

function pickDescription(welcome) {
  if (Array.isArray(welcome.messages) && welcome.messages.length > 0) {
    return welcome.messages[Math.floor(Math.random() * welcome.messages.length)];
  }
  return welcome.description || DEFAULT_WELCOME.description;
}

function buildWelcomeEmbed(member, welcome, { leave = false } = {}) {
  const w = normalizeWelcome(welcome);
  const color = leave ? parseColor(w.leaveColor, 0xef5b5b) : parseColor(w.color);
  const description = formatTemplate(leave ? w.leaveMessage : pickDescription(w), member, w);
  const embed = new EmbedBuilder().setColor(color);

  if (!leave) {
    if (w.title) embed.setTitle(formatTemplate(w.title, member, w).slice(0, 256));
    const thumb = resolveIcon(w.thumbnail, w.thumbnailUrl, member);
    if (thumb) embed.setThumbnail(thumb);
    if (w.imageUrl) embed.setImage(w.imageUrl);
    if (w.authorText) {
      const iconURL = resolveIcon(w.authorIcon, w.authorIconUrl, member);
      embed.setAuthor({ name: formatTemplate(w.authorText, member, w).slice(0, 256), ...(iconURL ? { iconURL } : {}) });
    }
    if (Array.isArray(w.fields)) {
      for (const field of w.fields.slice(0, 25)) {
        if (!field?.name || !field?.value) continue;
        embed.addFields({
          name: formatTemplate(field.name, member, w).slice(0, 256),
          value: formatTemplate(field.value, member, w).slice(0, 1024),
          inline: Boolean(field.inline),
        });
      }
    }
  } else {
    embed.setTitle('Member left');
  }

  embed.setDescription(description.slice(0, 4096));

  if (w.footer) {
    const iconURL = resolveIcon(w.footerIcon, w.footerIconUrl, member);
    embed.setFooter({
      text: formatTemplate(w.footer, member, w).slice(0, 2048),
      ...(iconURL ? { iconURL } : {}),
    });
  }
  if (w.showTimestamp) embed.setTimestamp();
  return embed;
}

function buildWelcomePayload(member, welcome, { leave = false } = {}) {
  const w = normalizeWelcome(welcome);
  const useEmbed = leave ? w.leaveUseEmbed !== false : w.useEmbed !== false;
  const payload = { allowedMentions: { parse: ['users'] } };

  if (leave) {
    if (useEmbed) payload.embeds = [buildWelcomeEmbed(member, w, { leave: true })];
    else payload.content = formatTemplate(w.leaveMessage, member, w);
    return payload;
  }

  const parts = [];
  if (w.pingUser) parts.push(`<@${member.id}>`);
  if (w.message) parts.push(formatTemplate(w.message, member, w));
  if (parts.length) payload.content = parts.join(' ').slice(0, 2000);

  if (useEmbed) payload.embeds = [buildWelcomeEmbed(member, w)];
  else if (!payload.content) {
    payload.content = formatTemplate(pickDescription(w), member, w).slice(0, 2000);
  }
  return payload;
}

async function assignAutoRoles(member) {
  const welcome = getWelcome(member.guild.id);
  if (!welcome.autoRoleIds?.length) return;
  const me = member.guild.members.me;
  for (const roleId of welcome.autoRoleIds) {
    const role = member.guild.roles.cache.get(roleId) || (await member.guild.roles.fetch(roleId).catch(() => null));
    if (!role || role.managed) continue;
    if (me && role.position >= me.roles.highest.position) continue;
    await member.roles.add(role, 'Ravex Helper auto-role').catch(() => null);
  }
}

async function sendWelcome(member) {
  const welcome = getWelcome(member.guild.id);
  if (!welcome.enabled) return;

  await assignAutoRoles(member);

  if (welcome.channelId) {
    const channel = await member.guild.channels.fetch(welcome.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send(buildWelcomePayload(member, welcome));
    }
  }

  if (welcome.dmEnabled) {
    const dmWelcome = {
      ...welcome,
      useEmbed: welcome.dmUseEmbed,
      pingUser: false,
      message: '',
      description: welcome.dmMessage,
      messages: [],
    };
    await member.user.send(buildWelcomePayload(member, dmWelcome)).catch(() => null);
  }
}

async function sendLeave(member) {
  const welcome = getWelcome(member.guild.id);
  if (!welcome.leaveEnabled || !welcome.leaveChannelId) return;
  const channel = await member.guild.channels.fetch(welcome.leaveChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send(buildWelcomePayload(member, welcome, { leave: true }));
}

function statusEmbed(guild, welcome) {
  const w = normalizeWelcome(welcome);
  return brandEmbed()
    .setTitle('Welcome studio')
    .setDescription('Customize every part of joins, DMs, leaves, and auto-roles.')
    .addFields(
      {
        name: 'Status',
        value: [
          `Enabled: **${w.enabled ? 'yes' : 'no'}**`,
          `Channel: ${w.channelId ? `<#${w.channelId}>` : '*not set*'}`,
          `Ping user: **${w.pingUser ? 'yes' : 'no'}**`,
          `Embed: **${w.useEmbed ? 'yes' : 'no'}**`,
          `Random messages: **${w.messages.length}**`,
          `Embed fields: **${w.fields.length}**`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Extras',
        value: [
          `DM welcome: **${w.dmEnabled ? 'on' : 'off'}**`,
          `Leave messages: **${w.leaveEnabled ? 'on' : 'off'}**`,
          `Leave channel: ${w.leaveChannelId ? `<#${w.leaveChannelId}>` : '*not set*'}`,
          `Auto-roles: **${w.autoRoleIds.length}**`,
          `Rules channel: ${w.rulesChannelId ? `<#${w.rulesChannelId}>` : '*not set*'}`,
        ].join('\n'),
        inline: true,
      },
      {
        name: 'Embed look',
        value: [
          `Title: ${w.title || '*none*'}`,
          `Color: \`${w.color}\``,
          `Thumbnail: \`${w.thumbnail}\``,
          `Image: ${w.imageUrl ? 'set' : 'none'}`,
          `Timestamp: **${w.showTimestamp ? 'yes' : 'no'}**`,
        ].join('\n'),
      }
    );
}

function studioComponents() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('welcome_edit_content').setLabel('Content').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('welcome_edit_embed').setLabel('Embed style').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('welcome_edit_media').setLabel('Media').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('welcome_edit_dm').setLabel('DM welcome').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('welcome_edit_leave').setLabel('Leave msg').setStyle(ButtonStyle.Secondary)
  );
  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('welcome_preview').setLabel('Preview here').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('welcome_test').setLabel('Send to channel').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('welcome_variables').setLabel('Variables').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('welcome_toggle').setLabel('Enable/Disable').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('welcome_refresh').setLabel('Refresh').setStyle(ButtonStyle.Secondary)
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('welcome_set_channel')
      .setPlaceholder('Set welcome channel')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(1)
      .setMaxValues(1)
  );
  const row4 = new ActionRowBuilder().addComponents(
    new RoleSelectMenuBuilder()
      .setCustomId('welcome_set_autoroles')
      .setPlaceholder('Set auto-roles (replaces current list)')
      .setMinValues(0)
      .setMaxValues(5)
  );
  const row5 = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('welcome_toggles')
      .setPlaceholder('Quick toggles')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Toggle ping user').setValue('ping'),
        new StringSelectMenuOptionBuilder().setLabel('Toggle embed mode').setValue('embed'),
        new StringSelectMenuOptionBuilder().setLabel('Toggle timestamp').setValue('timestamp'),
        new StringSelectMenuOptionBuilder().setLabel('Toggle DM welcome').setValue('dm'),
        new StringSelectMenuOptionBuilder().setLabel('Toggle leave messages').setValue('leave')
      )
  );
  return [row1, row2, row3, row4, row5];
}

function variablesEmbed() {
  return brandEmbed()
    .setTitle('Welcome variables')
    .setDescription(
      [
        '`{user}` — mention',
        '`{username}` — username',
        '`{displayname}` — server display name',
        '`{tag}` — user tag',
        '`{id}` — user id',
        '`{server}` / `{serverid}` — guild',
        '`{count}` — member count',
        '`{created}` / `{createdAt}` — account age',
        '`{joined}` / `{joinedAt}` — join time',
        '`{avatar}` — avatar URL',
        '`{rules}` — rules channel mention',
      ].join('\n')
    );
}

function contentModal(welcome) {
  const modal = new ModalBuilder().setCustomId('welcome_modal_content').setTitle('Welcome content');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('title')
        .setLabel('Embed title')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(256)
        .setValue((welcome.title || '').slice(0, 256))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('description')
        .setLabel('Embed description / main text')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(1000)
        .setValue((welcome.description || '').slice(0, 1000))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('message')
        .setLabel('Plain text outside embed (optional)')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setValue((welcome.message || '').slice(0, 500))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('footer')
        .setLabel('Footer text')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
        .setValue((welcome.footer || '').slice(0, 200))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('authorText')
        .setLabel('Author text (optional)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(200)
        .setValue((welcome.authorText || '').slice(0, 200))
    )
  );
  return modal;
}

function embedModal(welcome) {
  const modal = new ModalBuilder().setCustomId('welcome_modal_embed').setTitle('Embed style');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('color')
        .setLabel('Embed color (#hex)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(7)
        .setValue((welcome.color || '#5b8def').slice(0, 7))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('thumbnail')
        .setLabel('Thumbnail: user | server | none | url')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setValue((welcome.thumbnail || 'user').slice(0, 10))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('thumbnailUrl')
        .setLabel('Thumbnail URL (if mode=url)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setValue((welcome.thumbnailUrl || '').slice(0, 300))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('footerIcon')
        .setLabel('Footer icon: server | user | none | url')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setValue((welcome.footerIcon || 'server').slice(0, 10))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('authorIcon')
        .setLabel('Author icon: server | user | none | url')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
        .setValue((welcome.authorIcon || 'none').slice(0, 10))
    )
  );
  return modal;
}

function mediaModal(welcome) {
  const modal = new ModalBuilder().setCustomId('welcome_modal_media').setTitle('Welcome media & fields');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('imageUrl')
        .setLabel('Large image URL (banner)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setValue((welcome.imageUrl || '').slice(0, 300))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('footerIconUrl')
        .setLabel('Footer icon URL (if mode=url)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setValue((welcome.footerIconUrl || '').slice(0, 300))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('authorIconUrl')
        .setLabel('Author icon URL (if mode=url)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(300)
        .setValue((welcome.authorIconUrl || '').slice(0, 300))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('field')
        .setLabel('Add field: name || value || inline')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(false)
        .setMaxLength(500)
        .setPlaceholder('Account age || {created} || true')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('clearFields')
        .setLabel('Type CLEAR to wipe all fields')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(10)
    )
  );
  return modal;
}

function dmModal(welcome) {
  const modal = new ModalBuilder().setCustomId('welcome_modal_dm').setTitle('DM welcome');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dmEnabled')
        .setLabel('Enable DM? yes / no')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3)
        .setValue(welcome.dmEnabled ? 'yes' : 'no')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dmMessage')
        .setLabel('DM message')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setValue((welcome.dmMessage || '').slice(0, 1000))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('dmUseEmbed')
        .setLabel('Send DM as embed? yes / no')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(3)
        .setValue(welcome.dmUseEmbed !== false ? 'yes' : 'no')
    )
  );
  return modal;
}

function leaveModal(welcome) {
  const modal = new ModalBuilder().setCustomId('welcome_modal_leave').setTitle('Leave message');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('leaveEnabled')
        .setLabel('Enable leave messages? yes / no')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(3)
        .setValue(welcome.leaveEnabled ? 'yes' : 'no')
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('leaveChannelId')
        .setLabel('Leave channel ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(25)
        .setValue((welcome.leaveChannelId || '').slice(0, 25))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('leaveMessage')
        .setLabel('Leave message')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setMaxLength(1000)
        .setValue((welcome.leaveMessage || '').slice(0, 1000))
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder()
        .setCustomId('leaveColor')
        .setLabel('Leave embed color (#hex)')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setMaxLength(7)
        .setValue((welcome.leaveColor || '#ef5b5b').slice(0, 7))
    )
  );
  return modal;
}

function yes(value) {
  return ['yes', 'y', 'true', 'on', '1'].includes(String(value || '').trim().toLowerCase());
}

function normalizeMode(value, allowed, fallback) {
  const v = String(value || '').trim().toLowerCase();
  return allowed.includes(v) ? v : fallback;
}

async function refreshStudio(interaction) {
  const welcome = getWelcome(interaction.guild.id);
  const payload = {
    embeds: [statusEmbed(interaction.guild, welcome)],
    components: studioComponents(),
  };
  if (interaction.replied || interaction.deferred) return interaction.editReply(payload);
  return interaction.update(payload);
}

async function handleWelcomeInteraction(interaction) {
  if (!interaction.guild) return false;
  const id = interaction.customId || '';
  if (!id.startsWith('welcome_')) return false;

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    const msg = { content: 'You need Manage Server to use the welcome studio.', ephemeral: true };
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
    return true;
  }

  const welcome = getWelcome(interaction.guild.id);

  if (interaction.isButton()) {
    if (id === 'welcome_edit_content') {
      await interaction.showModal(contentModal(welcome));
      return true;
    }
    if (id === 'welcome_edit_embed') {
      await interaction.showModal(embedModal(welcome));
      return true;
    }
    if (id === 'welcome_edit_media') {
      await interaction.showModal(mediaModal(welcome));
      return true;
    }
    if (id === 'welcome_edit_dm') {
      await interaction.showModal(dmModal(welcome));
      return true;
    }
    if (id === 'welcome_edit_leave') {
      await interaction.showModal(leaveModal(welcome));
      return true;
    }
    if (id === 'welcome_variables') {
      await interaction.reply({ embeds: [variablesEmbed()], ephemeral: true });
      return true;
    }
    if (id === 'welcome_toggle') {
      saveWelcome(interaction.guild.id, { enabled: !welcome.enabled });
      await refreshStudio(interaction);
      return true;
    }
    if (id === 'welcome_refresh') {
      await refreshStudio(interaction);
      return true;
    }
    if (id === 'welcome_preview') {
      const payload = buildWelcomePayload(interaction.member, getWelcome(interaction.guild.id));
      await interaction.reply({ ...payload, ephemeral: true });
      return true;
    }
    if (id === 'welcome_test') {
      const current = getWelcome(interaction.guild.id);
      if (!current.channelId) {
        await interaction.reply({ content: 'Set a welcome channel first.', ephemeral: true });
        return true;
      }
      const channel = await interaction.guild.channels.fetch(current.channelId).catch(() => null);
      if (!channel?.isTextBased()) {
        await interaction.reply({ content: 'Welcome channel not found.', ephemeral: true });
        return true;
      }
      await channel.send(buildWelcomePayload(interaction.member, current));
      await interaction.reply({ content: `Test welcome sent in ${channel}.`, ephemeral: true });
      return true;
    }
  }

  if (interaction.isChannelSelectMenu() && id === 'welcome_set_channel') {
    const channelId = interaction.values[0];
    saveWelcome(interaction.guild.id, { channelId, enabled: true });
    await refreshStudio(interaction);
    return true;
  }

  if (interaction.isRoleSelectMenu() && id === 'welcome_set_autoroles') {
    saveWelcome(interaction.guild.id, { autoRoleIds: interaction.values });
    await refreshStudio(interaction);
    return true;
  }

  if (interaction.isStringSelectMenu() && id === 'welcome_toggles') {
    const choice = interaction.values[0];
    const patch = {};
    if (choice === 'ping') patch.pingUser = !welcome.pingUser;
    if (choice === 'embed') patch.useEmbed = !welcome.useEmbed;
    if (choice === 'timestamp') patch.showTimestamp = !welcome.showTimestamp;
    if (choice === 'dm') patch.dmEnabled = !welcome.dmEnabled;
    if (choice === 'leave') patch.leaveEnabled = !welcome.leaveEnabled;
    saveWelcome(interaction.guild.id, patch);
    await refreshStudio(interaction);
    return true;
  }

  if (interaction.isModalSubmit()) {
    if (id === 'welcome_modal_content') {
      saveWelcome(interaction.guild.id, {
        title: interaction.fields.getTextInputValue('title'),
        description: interaction.fields.getTextInputValue('description'),
        message: interaction.fields.getTextInputValue('message'),
        footer: interaction.fields.getTextInputValue('footer'),
        authorText: interaction.fields.getTextInputValue('authorText'),
      });
      await interaction.reply({ content: 'Welcome content updated. Use **Refresh** on the studio.', ephemeral: true });
      return true;
    }
    if (id === 'welcome_modal_embed') {
      saveWelcome(interaction.guild.id, {
        color: interaction.fields.getTextInputValue('color') || '#5b8def',
        thumbnail: normalizeMode(interaction.fields.getTextInputValue('thumbnail'), ['user', 'server', 'none', 'url'], 'user'),
        thumbnailUrl: interaction.fields.getTextInputValue('thumbnailUrl'),
        footerIcon: normalizeMode(interaction.fields.getTextInputValue('footerIcon'), ['user', 'server', 'none', 'url'], 'server'),
        authorIcon: normalizeMode(interaction.fields.getTextInputValue('authorIcon'), ['user', 'server', 'none', 'url'], 'none'),
      });
      await interaction.reply({ content: 'Embed style updated. Use **Refresh** on the studio.', ephemeral: true });
      return true;
    }
    if (id === 'welcome_modal_media') {
      const clear = interaction.fields.getTextInputValue('clearFields').trim().toUpperCase() === 'CLEAR';
      const fieldRaw = interaction.fields.getTextInputValue('field').trim();
      const patch = {
        imageUrl: interaction.fields.getTextInputValue('imageUrl').trim(),
        footerIconUrl: interaction.fields.getTextInputValue('footerIconUrl').trim(),
        authorIconUrl: interaction.fields.getTextInputValue('authorIconUrl').trim(),
      };
      if (clear) patch.fields = [];
      else if (fieldRaw) {
        const [name, value, inline] = fieldRaw.split('||').map((s) => s.trim());
        if (name && value) {
          patch.fields = [...(welcome.fields || []), { name, value, inline: yes(inline) }].slice(0, 25);
        }
      }
      saveWelcome(interaction.guild.id, patch);
      await interaction.reply({ content: 'Media/fields updated. Use **Refresh** on the studio.', ephemeral: true });
      return true;
    }
    if (id === 'welcome_modal_dm') {
      saveWelcome(interaction.guild.id, {
        dmEnabled: yes(interaction.fields.getTextInputValue('dmEnabled')),
        dmMessage: interaction.fields.getTextInputValue('dmMessage'),
        dmUseEmbed: yes(interaction.fields.getTextInputValue('dmUseEmbed') || 'yes'),
      });
      await interaction.reply({ content: 'DM welcome updated.', ephemeral: true });
      return true;
    }
    if (id === 'welcome_modal_leave') {
      const leaveChannelId = interaction.fields.getTextInputValue('leaveChannelId').trim() || null;
      saveWelcome(interaction.guild.id, {
        leaveEnabled: yes(interaction.fields.getTextInputValue('leaveEnabled')),
        leaveChannelId,
        leaveMessage: interaction.fields.getTextInputValue('leaveMessage'),
        leaveColor: interaction.fields.getTextInputValue('leaveColor') || '#ef5b5b',
      });
      await interaction.reply({ content: 'Leave message settings updated.', ephemeral: true });
      return true;
    }
  }

  return false;
}

module.exports = {
  BRAND,
  brandEmbed,
  getWelcome,
  saveWelcome,
  formatTemplate,
  buildWelcomePayload,
  sendWelcome,
  sendLeave,
  statusEmbed,
  studioComponents,
  variablesEmbed,
  handleWelcomeInteraction,
  normalizeWelcome,
  DEFAULT_WELCOME,
};
