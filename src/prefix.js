const { PermissionFlagsBits } = require('discord.js');
const { setAfk, getAfk, clearAfk, formatSince } = require('./afk');
const { brandEmbed, BRAND } = require('./welcome');

const PREFIX = '*';

function parseCommand(content) {
  if (!content || !content.startsWith(PREFIX)) return null;
  const body = content.slice(PREFIX.length).trim();
  if (!body) return null;
  const [name, ...rest] = body.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest,
    argString: rest.join(' ').trim(),
  };
}

async function maybeSetAfkNick(member, enable) {
  try {
    if (!member.manageable) return;
    const me = member.guild.members.me;
    if (!me?.permissions.has(PermissionFlagsBits.ManageNicknames)) return;
    const base = (member.displayName || member.user.username).replace(/^\[AFK\]\s*/i, '');
    if (enable) {
      const next = `[AFK] ${base}`.slice(0, 32);
      if (member.nickname !== next) await member.setNickname(next, 'AFK').catch(() => null);
    } else if (/^\[AFK\]\s*/i.test(member.displayName)) {
      await member.setNickname(base.slice(0, 32) || null, 'Back from AFK').catch(() => null);
    }
  } catch {
    // ignore nickname failures
  }
}

const commands = {
  async afk(message, { argString }) {
    const reason = argString || 'AFK';
    setAfk(message.guild.id, message.author.id, reason.slice(0, 200));
    await maybeSetAfkNick(message.member, true);
    await message.reply({
      embeds: [
        brandEmbed()
          .setTitle('AFK set')
          .setDescription(`${message.author} is now AFK: **${reason.slice(0, 200)}**\nUse any message (or \`*afk\` again) when you're back.`),
      ],
    });
  },

  async back(message) {
    const prev = clearAfk(message.guild.id, message.author.id);
    await maybeSetAfkNick(message.member, false);
    if (!prev) {
      await message.reply({ content: "You're not marked AFK." });
      return;
    }
    await message.reply({
      embeds: [
        brandEmbed()
          .setColor(0x22c55e)
          .setTitle('Welcome back')
          .setDescription(`You were AFK for **${formatSince(prev.since)}**.\nReason: ${prev.reason}`),
      ],
    });
  },

  async ping(message) {
    const sent = await message.reply({ content: 'Pinging…' });
    const latency = sent.createdTimestamp - message.createdTimestamp;
    await sent.edit({
      content: `Pong! Latency **${latency}ms** · WS **${Math.round(message.client.ws.ping)}ms**`,
    });
  },

  async help(message) {
    await message.reply({
      embeds: [
        brandEmbed()
          .setTitle(`${BRAND.name} — prefix commands`)
          .setDescription(
            [
              `Prefix: \`${PREFIX}\``,
              '',
              `\`${PREFIX}afk [reason]\` — set yourself AFK`,
              `\`${PREFIX}back\` — clear AFK`,
              `\`${PREFIX}ping\` — bot latency`,
              `\`${PREFIX}avatar [@user]\` — show avatar`,
              `\`${PREFIX}userinfo [@user]\` — user info`,
              `\`${PREFIX}serverinfo\` — server info`,
              `\`${PREFIX}help\` — this list`,
              '',
              'Slash commands still work too (`/welcome`, `/ticket`, …).',
            ].join('\n')
          ),
      ],
    });
  },

  async avatar(message, { args }) {
    const user = message.mentions.users.first() || message.author;
    await message.reply({
      embeds: [
        brandEmbed()
          .setTitle(`${user.username}'s avatar`)
          .setImage(user.displayAvatarURL({ size: 512 }))
          .setDescription(`[Open original](${user.displayAvatarURL({ size: 4096 })})`),
      ],
    });
  },

  async userinfo(message) {
    const user = message.mentions.users.first() || message.author;
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    const embed = brandEmbed()
      .setTitle('User info')
      .setThumbnail(user.displayAvatarURL({ size: 256 }))
      .addFields(
        { name: 'User', value: `${user} (\`${user.id}\`)`, inline: true },
        { name: 'Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:R>`, inline: true }
      );
    if (member) {
      embed.addFields(
        { name: 'Joined', value: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>`, inline: true },
        {
          name: 'Roles',
          value: member.roles.cache.filter((r) => r.id !== message.guild.id).map((r) => r.toString()).slice(0, 15).join(', ') || '*none*',
        }
      );
    }
    const afk = getAfk(message.guild.id, user.id);
    if (afk) {
      embed.addFields({ name: 'AFK', value: `${afk.reason} · ${formatSince(afk.since)}` });
    }
    await message.reply({ embeds: [embed] });
  },

  async serverinfo(message) {
    const g = message.guild;
    await message.reply({
      embeds: [
        brandEmbed()
          .setTitle(g.name)
          .setThumbnail(g.iconURL({ size: 256 }))
          .addFields(
            { name: 'Owner', value: `<@${g.ownerId}>`, inline: true },
            { name: 'Members', value: String(g.memberCount), inline: true },
            { name: 'Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Channels', value: String(g.channels.cache.size), inline: true },
            { name: 'Roles', value: String(g.roles.cache.size), inline: true },
            { name: 'Boosts', value: String(g.premiumSubscriptionCount || 0), inline: true }
          ),
      ],
    });
  },
};

// aliases
commands.a = commands.afk;
commands.p = commands.ping;
commands.h = commands.help;
commands.av = commands.avatar;
commands.whois = commands.userinfo;
commands.ui = commands.userinfo;
commands.si = commands.serverinfo;

async function handleAfkPassive(message) {
  if (!message.guild || message.author.bot) return;

  // Returning from AFK (any normal message except setting afk again)
  const parsed = parseCommand(message.content);
  const settingAfk = parsed && (parsed.name === 'afk' || parsed.name === 'a');
  if (!settingAfk) {
    const prev = getAfk(message.guild.id, message.author.id);
    if (prev) {
      clearAfk(message.guild.id, message.author.id);
      await maybeSetAfkNick(message.member, false);
      await message.reply({
        embeds: [
          brandEmbed()
            .setColor(0x22c55e)
            .setDescription(
              `Welcome back ${message.author} — you were AFK for **${formatSince(prev.since)}** (${prev.reason}).`
            ),
        ],
      }).catch(() => null);
    }
  }

  // Mention / reply notifications
  const targets = new Set(message.mentions.users.map((u) => u.id));
  if (message.reference?.messageId) {
    const ref = await message.channel.messages.fetch(message.reference.messageId).catch(() => null);
    if (ref?.author && !ref.author.bot) targets.add(ref.author.id);
  }

  for (const userId of targets) {
    if (userId === message.author.id) continue;
    const afk = getAfk(message.guild.id, userId);
    if (!afk) continue;
    await message.reply({
      embeds: [
        brandEmbed()
          .setColor(0xf59e0b)
          .setDescription(
            `<@${userId}> is AFK: **${afk.reason}** · since <t:${Math.floor(afk.since / 1000)}:R> (${formatSince(afk.since)})`
          ),
      ],
    }).catch(() => null);
  }
}

async function handlePrefixCommands(message) {
  if (!message.guild || message.author.bot) return false;
  const parsed = parseCommand(message.content);
  if (!parsed) return false;
  const cmd = commands[parsed.name];
  if (!cmd) return false;
  await cmd(message, parsed);
  return true;
}

module.exports = {
  PREFIX,
  handlePrefixCommands,
  handleAfkPassive,
  parseCommand,
};
