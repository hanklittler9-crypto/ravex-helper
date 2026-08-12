const fs = require('fs');
const path = require('path');
const { DEFAULT_CONFIG, normalizeConfig } = require('./defaults');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'guild-config.json');
const WARNINGS_PATH = path.join(DATA_DIR, 'warnings.json');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
  if (!fs.existsSync(WARNINGS_PATH)) fs.writeFileSync(WARNINGS_PATH, '{}');
}

function read(file) {
  ensure();
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function write(file, data) {
  ensure();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getConfig(guildId) {
  const all = read(CONFIG_PATH);
  return normalizeConfig(all[guildId] || {});
}

function setConfig(guildId, patch) {
  const all = read(CONFIG_PATH);
  const current = getConfig(guildId);
  const next = normalizeConfig({
    ...current,
    ...patch,
    automod: { ...current.automod, ...(patch.automod || {}) },
  });
  all[guildId] = next;
  write(CONFIG_PATH, all);
  return next;
}

function getWarnings(guildId, userId) {
  const all = read(WARNINGS_PATH);
  return all[guildId]?.[userId] || [];
}

function addWarning(guildId, userId, warning) {
  const all = read(WARNINGS_PATH);
  if (!all[guildId]) all[guildId] = {};
  if (!all[guildId][userId]) all[guildId][userId] = [];
  all[guildId][userId].push(warning);
  write(WARNINGS_PATH, all);
  return all[guildId][userId];
}

function clearWarnings(guildId, userId) {
  const all = read(WARNINGS_PATH);
  if (!all[guildId]) return [];
  all[guildId][userId] = [];
  write(WARNINGS_PATH, all);
  return [];
}

module.exports = {
  ensure,
  getConfig,
  setConfig,
  getWarnings,
  addWarning,
  clearWarnings,
};
