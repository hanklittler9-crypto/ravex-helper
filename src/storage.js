const { DEFAULT_WELCOME, normalizeWelcome } = require('./welcomeDefaults');
const { GUILD_CONFIG_PATH, TICKETS_PATH, readLocal, writeLocal } = require('./persist');

function ensureDataFiles() {
  readLocal(GUILD_CONFIG_PATH);
  readLocal(TICKETS_PATH);
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
  const all = readLocal(GUILD_CONFIG_PATH);
  const raw = all[guildId] || {};
  const base = { ...defaultGuildConfig(), ...raw };
  base.welcome = normalizeWelcome(raw.welcome || raw);
  return base;
}

function setGuildConfig(guildId, patch) {
  const all = readLocal(GUILD_CONFIG_PATH);
  const current = getGuildConfig(guildId);
  const next = { ...current, ...patch };
  if (patch.welcome) next.welcome = normalizeWelcome({ ...current.welcome, ...patch.welcome });
  all[guildId] = next;
  writeLocal(GUILD_CONFIG_PATH, all);
  return all[guildId];
}

function getTickets() {
  return readLocal(TICKETS_PATH);
}

function saveTickets(tickets) {
  writeLocal(TICKETS_PATH, tickets);
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
