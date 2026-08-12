const { EmbedBuilder, AuditLogEvent } = require('discord.js');
const { getConfig } = require('./storage');

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

async function sendLog(guild, embed, { mod = false, files = [] } = {}) {
  const config = getConfig(guild.id);
  const channelId = mod ? config.modLogChannelId || config.logChannelId : config.logChannelId;
  if (!channelId) {
    // Soft warn once per process per guild
    if (!sendLog._warned) sendLog._warned = new Set();
    if (!sendLog._warned.has(guild.id)) {
      sendLog._warned.add(guild.id);
      console.warn(
        `[logs] No log channel set for guild ${guild.id}. Run /security setup logs:#your-log-channel`
      );
    }
    return;
  }
  if (typeof embed === 'object' && embed?.data?.footer == null && embed?.setFooter) {
    // already branded
  }
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const payload = { embeds: [embed] };
  if (files?.length) payload.files = files.slice(0, 8);
  await channel.send(payload).catch((err) => {
    console.error('Failed to send log:', err.message);
  });
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
      // extra.channel can be present on message delete audits
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
};
