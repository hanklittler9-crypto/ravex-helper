const fs = require('fs');
const path = require('path');
const { DEFAULT_WELCOME, normalizeWelcome } = require('./welcomeDefaults');

const DATA_DIR = path.join(__dirname, '..', 'data');
const GUILD_CONFIG_PATH = path.join(DATA_DIR, 'guild-config.json');
const TICKETS_PATH = path.join(DATA_DIR, 'tickets.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(GUILD_CONFIG_PATH)) fs.writeFileSync(GUILD_CONFIG_PATH, '{}');
  if (!fs.existsSync(TICKETS_PATH)) fs.writeFileSync(TICKETS_PATH, '{}');
}

function readJson(filePath) {
  ensureDataFiles();
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  ensureDataFiles();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function defaultGuildConfig() {
  return {
    welcome: { ...DEFAULT_WELCOME },
    welcomeChannelId: null,
    welcomeMessage: DEFAULT_WELCOME.description,
    ticketCategoryId: null,
    ticketLogChannelId: null,
    supportRoleId: null,
    ticketCounter: 0,
  };
}

function getGuildConfig(guildId) {
  const all = readJson(GUILD_CONFIG_PATH);
  const raw = all[guildId] || {};
  const base = { ...defaultGuildConfig(), ...raw };
  base.welcome = normalizeWelcome(raw.welcome || raw);
  return base;
}

function setGuildConfig(guildId, patch) {
  const all = readJson(GUILD_CONFIG_PATH);
  const current = getGuildConfig(guildId);
  const next = { ...current, ...patch };
  if (patch.welcome) next.welcome = normalizeWelcome({ ...current.welcome, ...patch.welcome });
  all[guildId] = next;
  writeJson(GUILD_CONFIG_PATH, all);
  return all[guildId];
}

function getTickets() {
  return readJson(TICKETS_PATH);
}

function saveTickets(tickets) {
  writeJson(TICKETS_PATH, tickets);
}

function getTicketByChannel(channelId) {
  const tickets = getTickets();
  return tickets[channelId] || null;
}

function getOpenTicketForUser(guildId, userId) {
  const tickets = getTickets();
  return Object.values(tickets).find(
    (t) => t.guildId === guildId && t.userId === userId && t.status === 'open'
  );
}

function createTicketRecord(channelId, data) {
  const tickets = getTickets();
  tickets[channelId] = data;
  saveTickets(tickets);
  return data;
}

function updateTicket(channelId, patch) {
  const tickets = getTickets();
  if (!tickets[channelId]) return null;
  tickets[channelId] = { ...tickets[channelId], ...patch };
  saveTickets(tickets);
  return tickets[channelId];
}

function deleteTicket(channelId) {
  const tickets = getTickets();
  delete tickets[channelId];
  saveTickets(tickets);
}

module.exports = {
  ensureDataFiles,
  getGuildConfig,
  setGuildConfig,
  getTickets,
  getTicketByChannel,
  getOpenTicketForUser,
  createTicketRecord,
  updateTicket,
  deleteTicket,
};
