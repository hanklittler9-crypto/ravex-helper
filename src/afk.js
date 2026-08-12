const fs = require('fs');
const path = require('path');

const AFK_PATH = path.join(__dirname, '..', 'data', 'afk.json');

function ensure() {
  const dir = path.dirname(AFK_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(AFK_PATH)) fs.writeFileSync(AFK_PATH, '{}');
}

function readAll() {
  ensure();
  try {
    return JSON.parse(fs.readFileSync(AFK_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function writeAll(data) {
  ensure();
  fs.writeFileSync(AFK_PATH, JSON.stringify(data, null, 2));
}

function key(guildId, userId) {
  return `${guildId}:${userId}`;
}

function setAfk(guildId, userId, reason) {
  const all = readAll();
  all[key(guildId, userId)] = {
    reason: reason || 'AFK',
    since: Date.now(),
  };
  writeAll(all);
  return all[key(guildId, userId)];
}

function getAfk(guildId, userId) {
  const all = readAll();
  return all[key(guildId, userId)] || null;
}

function clearAfk(guildId, userId) {
  const all = readAll();
  const k = key(guildId, userId);
  if (!all[k]) return null;
  const prev = all[k];
  delete all[k];
  writeAll(all);
  return prev;
}

function formatSince(ts) {
  const seconds = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

module.exports = {
  setAfk,
  getAfk,
  clearAfk,
  formatSince,
};
