const {
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'guild-config.json');
const WARNINGS_PATH = path.join(DATA_DIR, 'warnings.json');
const BACKUP_CHANNEL = 'ravex-security-data';
const BACKUP_FILE = 'ravex-security-config.json';

let clientRef = null;
let backupTimer = null;

function setPersistenceClient(client) {
  clientRef = client;
}

function ensureLocal() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(CONFIG_PATH)) fs.writeFileSync(CONFIG_PATH, '{}');
  if (!fs.existsSync(WARNINGS_PATH)) fs.writeFileSync(WARNINGS_PATH, '{}');
}

function readLocal(filePath, fallback = '{}') {
  ensureLocal();
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return JSON.parse(fallback);
  }
}

function writeLocal(filePath, data) {
  ensureLocal();
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  scheduleBackup();
}

function scheduleBackup() {
  if (!clientRef) return;
  clearTimeout(backupTimer);
  backupTimer = setTimeout(() => {
    backupToDiscord().catch((err) => console.error('Config backup failed:', err.message));
  }, 1500);
}

async function ensureBackupChannel(guild) {
  await guild.channels.fetch().catch(() => null);
  let channel = guild.channels.cache.find((c) => c.name === BACKUP_CHANNEL && c.isTextBased?.());
  if (channel) return channel;

  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;

  return guild.channels.create({
    name: BACKUP_CHANNEL,
    type: ChannelType.GuildText,
    topic: 'Ravex Security config backup — do not delete',
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
          PermissionFlagsBits.ManageMessages,
        ],
      },
    ],
    reason: 'Ravex Security persistent config',
  });
}

async function backupToDiscord() {
  if (!clientRef?.guilds?.cache?.size) return;
  const payload = {
    guildConfig: readLocal(CONFIG_PATH),
    warnings: readLocal(WARNINGS_PATH),
    savedAt: new Date().toISOString(),
  };
  const file = new AttachmentBuilder(Buffer.from(JSON.stringify(payload, null, 2)), {
    name: BACKUP_FILE,
  });

  for (const guild of clientRef.guilds.cache.values()) {
    try {
      const channel = await ensureBackupChannel(guild);
      if (!channel) continue;
      const messages = await channel.messages.fetch({ limit: 20 });
      const existing = messages.find(
        (m) => m.author.id === clientRef.user.id && m.attachments.some((a) => a.name === BACKUP_FILE)
      );
      const body = { content: `Ravex Security config backup (\`${payload.savedAt}\`)`, files: [file] };
      if (existing) await existing.edit(body);
      else await channel.send(body);
    } catch (err) {
      console.error(`Backup failed for ${guild.id}:`, err.message);
    }
  }
}

async function restoreFromDiscord(client) {
  setPersistenceClient(client);
  let restored = false;

  for (const guild of client.guilds.cache.values()) {
    try {
      await guild.channels.fetch().catch(() => null);
      const channel = guild.channels.cache.find((c) => c.name === BACKUP_CHANNEL && c.isTextBased?.());
      if (!channel) continue;
      const messages = await channel.messages.fetch({ limit: 20 });
      const existing = messages.find(
        (m) => m.author.id === client.user.id && m.attachments.some((a) => a.name === BACKUP_FILE)
      );
      if (!existing) continue;
      const att = existing.attachments.find((a) => a.name === BACKUP_FILE);
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const data = await res.json();
      if (data.guildConfig && typeof data.guildConfig === 'object') {
        const local = readLocal(CONFIG_PATH);
        const merged = { ...data.guildConfig, ...local };
        for (const [gid, cfg] of Object.entries(data.guildConfig)) {
          const localCfg = local[gid];
          if (!localCfg?.logChannelId) merged[gid] = { ...cfg, ...localCfg };
        }
        // write without scheduling nested restore loops oddly
        ensureLocal();
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2));
        restored = true;
      }
      if (data.warnings && typeof data.warnings === 'object') {
        const localWarn = readLocal(WARNINGS_PATH);
        if (!Object.keys(localWarn).length) {
          fs.writeFileSync(WARNINGS_PATH, JSON.stringify(data.warnings, null, 2));
        }
      }
    } catch (err) {
      console.error(`Restore failed for ${guild.id}:`, err.message);
    }
  }

  if (restored) console.log('Restored Ravex Security config from Discord backup');
  return restored;
}

module.exports = {
  DATA_DIR,
  CONFIG_PATH,
  WARNINGS_PATH,
  setPersistenceClient,
  readLocal,
  writeLocal,
  restoreFromDiscord,
  backupToDiscord,
  ensureLocal,
};
