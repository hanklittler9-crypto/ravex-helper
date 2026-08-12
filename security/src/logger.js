const { EmbedBuilder, AuditLogEvent, PermissionFlagsBits, ChannelType } = require('discord.js');
const { getConfig, setConfig } = require('./storage');

const BRAND = {
  name: 'Ravex Security',
  color: 0xa855f7,
  danger: 0xef4444,
  warn: 0xf59e0b,
  ok: 0x22c55e,
  info: 0x3b82f6,
  footer: 'Ravex Security',
};

function brandEmbed(color = BRAND.color) {
  return new EmbedBuilder().setColor(color).setFooter({ text: BRAND.footer }).setTimestamp();
}

async function ensureLogChannel(guild) {
  const config = getConfig(guild.id);
  if (config.logChannelId) {
    const existing = await guild.channels.fetch(config.logChannelId).catch(() => null);
    if (existing?.isTextBased()) return existing;
  }

  // Prefer a channel named ravex-logs if it already exists
  await guild.channels.fetch().catch(() => null);
  const named = guild.channels.cache.find((c) => c.name === 'ravex-logs' && c.isTextBased?.());
  if (named) {
    setConfig(guild.id, { logChannelId: named.id, modLogChannelId: config.modLogChannelId || named.id });
    return named;
  }

  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) {
    console.warn(`[logs] ${guild.name}: no log channel and I can't create one (need Manage Channels)`);
    return null;
  }

  const created = await guild.channels.create({
    name: 'ravex-logs',
    type: ChannelType.GuildText,
    topic: 'Ravex Security server logs',
    reason: 'Auto-created by Ravex Security for logging',
    permissionOverwrites: [
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.EmbedLinks,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  setConfig(guild.id, { logChannelId: created.id, modLogChannelId: config.modLogChannelId || created.id });
  console.log(`[logs] ${guild.name}: created #ravex-logs (${created.id})`);
  return created;
}

async function sendLog(guild, embed, { mod = false, files = [] } = {}) {
  let config = getConfig(guild.id);
  let channelId = mod ? config.modLogChannelId || config.logChannelId : config.logChannelId;

  if (!channelId) {
    const ensured = await ensureLogChannel(guild);
    if (!ensured) return false;
    config = getConfig(guild.id);
    channelId = mod ? config.modLogChannelId || config.logChannelId : config.logChannelId;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) {
    console.error(`[logs] Channel ${channelId} missing for ${guild.name}`);
    return false;
  }

  const me = guild.members.me;
  if (me) {
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.SendMessages) || !perms?.has(PermissionFlagsBits.EmbedLinks)) {
      console.error(
        `[logs] Missing Send Messages / Embed Links in #${channel.name} (${guild.name})`
      );
      return false;
    }
  }

  const payload = { embeds: [embed] };
  if (files?.length) payload.files = files.slice(0, 8);

  try {
    await channel.send(payload);
    return true;
  } catch (err) {
    console.error(`[logs] Failed to send in #${channel.name}:`, err.message);
    return false;
  }
}

function truncate(text, max = 1000) {
  if (text == null || text === '') return '*empty*';
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

async function findDeleter(guild, channelId, authorId) {
  try {
    const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MessageDelete, limit: 6 });
    const entry = logs.entries.find((e) => {
      if (Date.now() - e.createdTimestamp > 15_000) return false;
      if (e.target?.id && authorId && e.target.id !== authorId) return false;
      if (e.extra?.channel?.id && e.extra.channel.id !== channelId) return false;
      return true;
    });
    return entry?.executor || null;
  } catch {
    return null;
  }
}

module.exports = {
  BRAND,
  brandEmbed,
  sendLog,
  truncate,
  findDeleter,
  ensureLogChannel,
};
