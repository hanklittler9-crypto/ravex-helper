const { PermissionFlagsBits, Collection } = require('discord.js');
const { getConfig, addWarning } = require('./storage');
const { brandEmbed, sendLog, truncate, BRAND } = require('./logger');

const recentMessages = new Collection(); // key: guildId:userId -> timestamps[]

const INVITE_REGEX = /(discord\.gg\/|discord(?:app)?\.com\/invite\/)/i;
const LINK_REGEX = /https?:\/\/\S+/i;

function isStaff(member, config) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  if (member.permissions.has(PermissionFlagsBits.ModerateMembers)) return true;
  return (config.staffRoleIds || []).some((id) => member.roles.cache.has(id));
}

function capsPercent(content) {
  const letters = content.replace(/[^a-zA-Z]/g, '');
  if (!letters.length) return 0;
  const caps = letters.replace(/[^A-Z]/g, '').length;
  return Math.round((caps / letters.length) * 100);
}

function trackSpam(guildId, userId, windowMs) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();
  const list = (recentMessages.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  recentMessages.set(key, list);
  return list.length;
}

async function punish(message, reason, config) {
  const action = config.automod.action || 'timeout';
  await message.delete().catch(() => null);

  if (action === 'timeout') {
    const seconds = config.automod.timeoutSeconds || 300;
    await message.member?.timeout(seconds * 1000, `Automod: ${reason}`).catch(() => null);
  } else if (action === 'kick') {
    await message.member?.kick(`Automod: ${reason}`).catch(() => null);
  }

  addWarning(message.guild.id, message.author.id, {
    id: `${Date.now()}`,
    moderatorId: message.client.user.id,
    reason: `Automod: ${reason}`,
    at: Date.now(),
    automod: true,
  });

  await sendLog(
    message.guild,
    brandEmbed(BRAND.danger)
      .setTitle('Automod triggered')
      .addFields(
        { name: 'User', value: `${message.author} (\`${message.author.id}\`)`, inline: true },
        { name: 'Channel', value: `${message.channel}`, inline: true },
        { name: 'Reason', value: reason, inline: true },
        { name: 'Action', value: action, inline: true },
        { name: 'Content', value: truncate(message.content) }
      ),
    { mod: true }
  );

  const notice = await message.channel
    .send({ content: `${message.author} — message removed (**${reason}**).` })
    .catch(() => null);
  if (notice) setTimeout(() => notice.delete().catch(() => null), 5000);
}

async function handleAutomod(message) {
  if (!message.guild || message.author.bot) return false;
  const config = getConfig(message.guild.id);
  if (!config.automod?.enabled) return false;
  if (config.automod.ignoreStaff && isStaff(message.member, config)) return false;

  const content = message.content || '';
  const am = config.automod;

  if (am.deleteInvite && INVITE_REGEX.test(content)) {
    await punish(message, 'Discord invite link', config);
    return true;
  }

  if (am.deleteLinks && LINK_REGEX.test(content)) {
    await punish(message, 'Link not allowed', config);
    return true;
  }

  if (am.bannedWords?.length) {
    const lower = content.toLowerCase();
    const hit = am.bannedWords.find((w) => w && lower.includes(String(w).toLowerCase()));
    if (hit) {
      await punish(message, `Banned word (\`${hit}\`)`, config);
      return true;
    }
  }

  const mentions = message.mentions.users.size + message.mentions.roles.size;
  if (am.maxMentions > 0 && mentions > am.maxMentions) {
    await punish(message, `Too many mentions (${mentions})`, config);
    return true;
  }

  if (
    am.maxCapsPercent > 0 &&
    content.length >= (am.minCapsLength || 12) &&
    capsPercent(content) >= am.maxCapsPercent
  ) {
    await punish(message, `Excessive caps (${capsPercent(content)}%)`, config);
    return true;
  }

  const count = trackSpam(message.guild.id, message.author.id, am.spamWindowMs || 7000);
  if (am.spamThreshold > 0 && count >= am.spamThreshold) {
    await punish(message, `Spam (${count} msgs / ${(am.spamWindowMs || 7000) / 1000}s)`, config);
    recentMessages.set(`${message.guild.id}:${message.author.id}`, []);
    return true;
  }

  return false;
}

module.exports = { handleAutomod, isStaff };
