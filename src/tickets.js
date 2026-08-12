const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  getGuildConfig,
  setGuildConfig,
  getOpenTicketForUser,
  createTicketRecord,
  updateTicket,
  deleteTicket,
  getTicketByChannel,
} = require('./storage');
const { BRAND, brandEmbed } = require('./welcome');

function ticketPanelEmbed() {
  return brandEmbed()
    .setTitle('Support Tickets')
    .setDescription(
      [
        'Need help from the staff team?',
        '',
        'Click **Open Ticket** below to create a private channel.',
        'You can also DM this bot to start modmail.',
        '',
        'One open ticket per person. Staff will respond as soon as they can.',
      ].join('\n')
    );
}

function ticketPanelRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_open')
      .setLabel('Open Ticket')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫')
  );
}

async function ensureTicketInfrastructure(guild) {
  const config = getGuildConfig(guild.id);
  let categoryId = config.ticketCategoryId;
  let logChannelId = config.ticketLogChannelId;
  let supportRoleId = config.supportRoleId;

  if (!supportRoleId) {
    const existing = guild.roles.cache.find((r) => r.name === 'Support');
    const role =
      existing ||
      (await guild.roles.create({
        name: 'Support',
        color: BRAND.color,
        reason: 'Ravex Helper ticket support role',
      }));
    supportRoleId = role.id;
  }

  if (!categoryId) {
    const category = await guild.channels.create({
      name: 'Tickets',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: supportRoleId,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.ManageChannels,
          ],
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ManageChannels,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });
    categoryId = category.id;
  }

  if (!logChannelId) {
    const log = await guild.channels.create({
      name: 'ticket-logs',
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: supportRoleId,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        },
        {
          id: guild.members.me.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
          ],
        },
      ],
    });
    logChannelId = log.id;
  }

  return setGuildConfig(guild.id, { ticketCategoryId: categoryId, ticketLogChannelId: logChannelId, supportRoleId });
}

function ticketControlRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setStyle(ButtonStyle.Danger).setEmoji('🔒'),
    new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setStyle(ButtonStyle.Secondary).setEmoji('🙋')
  );
}

async function openTicket(guild, user, source = 'panel', initialMessage = null) {
  const existing = getOpenTicketForUser(guild.id, user.id);
  if (existing) {
    return { error: `You already have an open ticket: <#${existing.channelId}>` };
  }

  const config = await ensureTicketInfrastructure(guild);
  const next = (config.ticketCounter || 0) + 1;
  setGuildConfig(guild.id, { ticketCounter: next });

  const channelName = `ticket-${String(next).padStart(4, '0')}`;
  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: config.ticketCategoryId,
    topic: `Ticket for ${user.tag} (${user.id}) | source: ${source}`,
    permissionOverwrites: [
      { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
      {
        id: user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: config.supportRoleId,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.AttachFiles,
        ],
      },
      {
        id: guild.members.me.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ReadMessageHistory,
        ],
      },
    ],
  });

  const record = createTicketRecord(channel.id, {
    channelId: channel.id,
    guildId: guild.id,
    userId: user.id,
    number: next,
    source,
    status: 'open',
    claimedBy: null,
    createdAt: Date.now(),
  });

  const embed = brandEmbed()
    .setTitle(`Ticket #${String(next).padStart(4, '0')}`)
    .setDescription(
      [
        `Hello <@${user.id}> — staff will be with you shortly.`,
        '',
        `**Opened by:** ${user.tag}`,
        `**Source:** ${source}`,
        initialMessage ? `\n**First message:**\n${initialMessage}` : '',
        '',
        'Staff: use the buttons below to claim or close this ticket.',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .setTimestamp();

  const ping = config.supportRoleId ? `<@&${config.supportRoleId}>` : '';
  await channel.send({ content: `${ping} <@${user.id}>`.trim(), embeds: [embed], components: [ticketControlRow()] });

  const logChannel = await guild.channels.fetch(config.ticketLogChannelId).catch(() => null);
  if (logChannel?.isTextBased()) {
    await logChannel.send({
      embeds: [
        brandEmbed()
          .setTitle('Ticket opened')
          .setDescription(`<#${channel.id}> by <@${user.id}> (${source})`)
          .setTimestamp(),
      ],
    });
  }

  return { channel, record };
}

async function closeTicket(channel, closer) {
  const ticket = getTicketByChannel(channel.id);
  if (!ticket || ticket.status !== 'open') {
    return { error: 'This channel is not an open ticket.' };
  }

  updateTicket(channel.id, { status: 'closed', closedBy: closer.id, closedAt: Date.now() });

  const config = getGuildConfig(channel.guild.id);
  const logChannel = await channel.guild.channels.fetch(config.ticketLogChannelId).catch(() => null);
  if (logChannel?.isTextBased()) {
    await logChannel.send({
      embeds: [
        brandEmbed()
          .setTitle('Ticket closed')
          .setDescription(
            `Ticket #${String(ticket.number).padStart(4, '0')} (<#${channel.id}>) closed by <@${closer.id}>`
          )
          .setTimestamp(),
      ],
    });
  }

  const owner = await channel.client.users.fetch(ticket.userId).catch(() => null);
  if (owner) {
    await owner
      .send({
        embeds: [
          brandEmbed()
            .setTitle('Ticket closed')
            .setDescription(`Your ticket in **${channel.guild.name}** was closed by staff.`)
            .setTimestamp(),
        ],
      })
      .catch(() => null);
  }

  await channel.send({
    embeds: [
      brandEmbed()
        .setTitle('Closing ticket')
        .setDescription('This channel will be deleted in 5 seconds.')
        .setTimestamp(),
    ],
  });

  setTimeout(async () => {
    deleteTicket(channel.id);
    await channel.delete('Ticket closed').catch(() => null);
  }, 5000);

  return { ok: true };
}

async function claimTicket(channel, claimer) {
  const ticket = getTicketByChannel(channel.id);
  if (!ticket || ticket.status !== 'open') {
    return { error: 'This channel is not an open ticket.' };
  }

  updateTicket(channel.id, { claimedBy: claimer.id });
  await channel.send({
    embeds: [
      brandEmbed()
        .setTitle('Ticket claimed')
        .setDescription(`<@${claimer.id}> is handling this ticket.`)
        .setTimestamp(),
    ],
  });
  return { ok: true };
}

module.exports = {
  BRAND,
  brandEmbed,
  ticketPanelEmbed,
  ticketPanelRow,
  ensureTicketInfrastructure,
  openTicket,
  closeTicket,
  claimTicket,
};
