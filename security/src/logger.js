const { EmbedBuilder } = require('discord.js');
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

async function sendLog(guild, embed, { mod = false } = {}) {
  const config = getConfig(guild.id);
  const channelId = mod ? config.modLogChannelId || config.logChannelId : config.logChannelId;
  if (!channelId) return;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  await channel.send({ embeds: [embed] }).catch(() => null);
}

function truncate(text, max = 1000) {
  if (!text) return '*empty*';
  const s = String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

module.exports = {
  BRAND,
  brandEmbed,
  sendLog,
  truncate,
};
