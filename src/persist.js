const {
  ChannelType,
  PermissionFlagsBits,
  AttachmentBuilder,
} = require('discord.js');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const GUILD_CONFIG_PATH = path.join(DATA_DIR, 'guild-config.json');
const TICKETS_PATH = path.join(DATA_DIR, 'tickets.json');
const BACKUP_CHANNEL = 'ravex-helper-data';
const BACKUP_FILE = 'ravex-config.json';

let clientRef = null;
let backupTimer = null;

function setPersistenceClient(client) {
  clientRef = client;
}

function readLocal(filePath, fallback = '{}') {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(filePath)) fs.writeFileSync(filePath, fallback);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return JSON.parse(fallback);
  }
}

function writeLocal(filePath, data) {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
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
  let channel = guild.channels.cache.find(
    (c) => c.name === BACKUP_CHANNEL && c.isTextBased?.()
  );
  if (channel) return channel;

  const me = guild.members.me || (await guild.members.fetchMe().catch(() => null));
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return null;

  return guild.channels.create({
    name: BACKUP_CHANNEL,
    type: ChannelType.GuildText,
    topic: 'Ravex Helper config backup — do not delete. Keeps settings alive on Render restarts.',
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
    reason: 'Ravex Helper persistent config storage',
  });
}

async function backupToDiscord() {
  if (!clientRef?.guilds?.cache?.size) return;

  const payload = {
    guildConfig: readLocal(GUILD_CONFIG_PATH),
    tickets: readLocal(TICKETS_PATH),
    savedAt: new Date().toISOString(),
  };
  const buffer = Buffer.from(JSON.stringify(payload, null, 2), 'utf8');
  const file = new AttachmentBuilder(buffer, { name: BACKUP_FILE });

  for (const guild of clientRef.guilds.cache.values()) {
    try {
      const channel = await ensureBackupChannel(guild);
      if (!channel) continue;

      const messages = await channel.messages.fetch({ limit: 20 });
      const existing = messages.find(
        (m) => m.author.id === clientRef.user.id && m.attachments.some((a) => a.name === BACKUP_FILE)
      );

      const body = {
        content: `Ravex Helper config backup (\`${payload.savedAt}\`)`,
        files: [file],
      };

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
      const channel = guild.channels.cache.find(
        (c) => c.name === BACKUP_CHANNEL && c.isTextBased?.()
      );
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
        const local = readLocal(GUILD_CONFIG_PATH);
        const merged = { ...data.guildConfig, ...local };
        // Prefer Discord backup when local guild entry is empty/missing welcome channel
        for (const [gid, cfg] of Object.entries(data.guildConfig)) {
          const localCfg = local[gid];
          const localWelcome = localCfg?.welcome || localCfg || {};
          const hasLocalChannel = Boolean(localWelcome.channelId || localCfg?.welcomeChannelId);
          if (!localCfg || !hasLocalChannel) {
            merged[gid] = cfg;
          }
        }
        writeLocal(GUILD_CONFIG_PATH, merged);
        restored = true;
      }

      if (data.tickets && typeof data.tickets === 'object') {
        const localTickets = readLocal(TICKETS_PATH);
        if (!Object.keys(localTickets).length) {
          writeLocal(TICKETS_PATH, data.tickets);
        }
      }
    } catch (err) {
      console.error(`Restore failed for ${guild.id}:`, err.message);
    }
  }

  if (restored) console.log('Restored Ravex Helper config from Discord backup channel');
  return restored;
}

module.exports = {
  DATA_DIR,
  GUILD_CONFIG_PATH,
  TICKETS_PATH,
  setPersistenceClient,
  readLocal,
  writeLocal,
  restoreFromDiscord,
  backupToDiscord,
  scheduleBackup,
};
