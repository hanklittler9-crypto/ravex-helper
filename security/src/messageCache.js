const { Collection } = require('discord.js');

// messageId -> snapshot
const cache = new Collection();
const MAX_SIZE = 2000;

function snapshotMessage(message) {
  if (!message?.id || !message.guild) return null;
  const attachments = message.attachments
    ? [...message.attachments.values()].map((a) => ({
        name: a.name,
        url: a.url,
        contentType: a.contentType || null,
        size: a.size,
      }))
    : [];
  const stickers = message.stickers ? [...message.stickers.values()].map((s) => s.name) : [];
  return {
    id: message.id,
    guildId: message.guild.id,
    channelId: message.channelId || message.channel?.id,
    authorId: message.author?.id || null,
    authorTag: message.author?.tag || message.author?.username || 'Unknown',
    authorBot: Boolean(message.author?.bot),
    content: message.content || '',
    attachments,
    stickers,
    createdTimestamp: message.createdTimestamp || Date.now(),
  };
}

function cacheMessage(message) {
  const snap = snapshotMessage(message);
  if (!snap || snap.authorBot) return;
  cache.set(snap.id, snap);
  if (cache.size > MAX_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
}

function takeCached(messageId) {
  const snap = cache.get(messageId) || null;
  if (snap) cache.delete(messageId);
  return snap;
}

function peekCached(messageId) {
  return cache.get(messageId) || null;
}

function updateCached(message) {
  const existing = cache.get(message.id);
  const snap = snapshotMessage(message);
  if (!snap) return;
  // Prefer non-empty content from either side (partial updates)
  if (existing) {
    snap.content = snap.content || existing.content;
    snap.authorId = snap.authorId || existing.authorId;
    snap.authorTag = snap.authorTag !== 'Unknown' ? snap.authorTag : existing.authorTag;
    snap.attachments = snap.attachments.length ? snap.attachments : existing.attachments;
  }
  if (!snap.authorBot) cache.set(snap.id, snap);
}

module.exports = {
  cacheMessage,
  takeCached,
  peekCached,
  updateCached,
  snapshotMessage,
};
