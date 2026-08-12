const { DEFAULT_CONFIG, normalizeConfig } = require('./defaults');
const { CONFIG_PATH, WARNINGS_PATH, readLocal, writeLocal, ensureLocal } = require('./persist');

function ensure() {
  ensureLocal();
}

function getConfig(guildId) {
  const all = readLocal(CONFIG_PATH);
  const raw = all[guildId] || {};
  const normalized = normalizeConfig(raw);

  // Env fallbacks so Render can set logs without slash commands surviving restarts
  if (!normalized.logChannelId && process.env.LOG_CHANNEL_ID) {
    normalized.logChannelId = process.env.LOG_CHANNEL_ID;
  }
  if (!normalized.modLogChannelId && process.env.MOD_LOG_CHANNEL_ID) {
    normalized.modLogChannelId = process.env.MOD_LOG_CHANNEL_ID;
  } else if (!normalized.modLogChannelId && normalized.logChannelId) {
    normalized.modLogChannelId = normalized.logChannelId;
  }

  return normalized;
}

function setConfig(guildId, patch) {
  const all = readLocal(CONFIG_PATH);
  const current = getConfig(guildId);
  const next = normalizeConfig({
    ...current,
    ...patch,
    automod: { ...current.automod, ...(patch.automod || {}) },
  });
  all[guildId] = next;
  writeLocal(CONFIG_PATH, all);
  return next;
}

function getWarnings(guildId, userId) {
  const all = readLocal(WARNINGS_PATH);
  return all[guildId]?.[userId] || [];
}

function addWarning(guildId, userId, warning) {
  const all = readLocal(WARNINGS_PATH);
  if (!all[guildId]) all[guildId] = {};
  if (!all[guildId][userId]) all[guildId][userId] = [];
  all[guildId][userId].push(warning);
  writeLocal(WARNINGS_PATH, all);
  return all[guildId][userId];
}

function clearWarnings(guildId, userId) {
  const all = readLocal(WARNINGS_PATH);
  if (!all[guildId]) return [];
  all[guildId][userId] = [];
  writeLocal(WARNINGS_PATH, all);
  return [];
}

module.exports = {
  ensure,
  getConfig,
  setConfig,
  getWarnings,
  addWarning,
  clearWarnings,
  DEFAULT_CONFIG,
};
