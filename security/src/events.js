const { brandEmbed, sendLog, truncate, findDeleter, BRAND } = require('./logger');
const { handleAutomod } = require('./automod');
const { cacheMessage, takeCached, peekCached, updateCached } = require('./messageCache');
const { getConfig } = require('./storage');

function isLogChannel(guild, channelId) {
  const config = getConfig(guild.id);
  return channelId && (channelId === config.logChannelId || channelId === config.modLogChannelId);
}

function formatAttachments(list = []) {
  if (!list.length) return null;
  return list.map((a) => `[${a.name || 'file'}](${a.url})`).join('\n').slice(0, 1000);
}

async function logDeletedMessage(guild, info) {
  if (!guild || info.authorBot) return;
  if (isLogChannel(guild, info.channelId)) return;

  const deleter = await findDeleter(guild, info.channelId, info.authorId);
  const embed = brandEmbed(BRAND.danger)
    .setTitle('Message deleted')
    .addFields(
      {
        name: 'Author',
        value: info.authorId ? `<@${info.authorId}> (\`${info.authorId}\`)` : info.authorTag || 'Unknown',
        inline: true,
      },
      {
        name: 'Channel',
        value: info.channelId ? `<#${info.channelId}>` : 'Unknown',
        inline: true,
      },
      {
        name: 'Deleted by',
        value: deleter ? `${deleter} (\`${deleter.id}\`)` : 'Unknown / self-delete',
        inline: true,
      },
      { name: 'Content', value: truncate(info.content, 1024) }
    );

  if (info.attachments?.length) {
    embed.addFields({ name: 'Attachments', value: formatAttachments(info.attachments) });
  }
  if (info.stickers?.length) {
    embed.addFields({ name: 'Stickers', value: info.stickers.join(', ') });
  }
  if (info.id) {
    embed.setFooter({ text: `Ravex Security · message ${info.id}` });
  }

  const files = (info.attachments || [])
    .filter((a) => a.url && (!a.contentType || a.contentType.startsWith('image/')))
    .slice(0, 3)
    .map((a) => a.url);

  await sendLog(guild, embed, { files });
}

function registerEvents(client) {
  client.on('messageCreate', async (message) => {
    try {
      cacheMessage(message);
      await handleAutomod(message);
    } catch (err) {
      console.error('messageCreate error:', err);
    }
  });

  client.on('messageDelete', async (message) => {
    try {
      const guild = message.guild || (message.guildId ? await client.guilds.fetch(message.guildId).catch(() => null) : null);
      if (!guild) return;

      const cached = takeCached(message.id) || {};
      const author = message.author;
      const info = {
        id: message.id,
        channelId: message.channelId || cached.channelId,
        authorId: author?.id || cached.authorId || null,
        authorTag: author?.tag || cached.authorTag || 'Unknown',
        authorBot: author ? Boolean(author.bot) : Boolean(cached.authorBot),
        content: message.content || cached.content || '',
        attachments:
          message.attachments?.size
            ? [...message.attachments.values()].map((a) => ({
                name: a.name,
                url: a.url,
                contentType: a.contentType,
              }))
            : cached.attachments || [],
        stickers:
          message.stickers?.size
            ? [...message.stickers.values()].map((s) => s.name)
            : cached.stickers || [],
      };

      // If we have zero info, still log a minimal delete event
      if (!info.authorId && !info.content && !info.attachments.length) {
        info.content = '*content unavailable (message was not cached — bot may have just restarted)*';
      }

      await logDeletedMessage(guild, info);
    } catch (err) {
      console.error('messageDelete log error:', err);
    }
  });

  client.on('messageDeleteBulk', async (messages, channel) => {
    try {
      const guild = channel.guild;
      if (!guild || isLogChannel(guild, channel.id)) return;

      const samples = [];
      for (const msg of messages.values()) {
        const cached = takeCached(msg.id) || peekCached(msg.id) || {};
        if (msg.author?.bot || cached.authorBot) continue;
        samples.push({
          author: msg.author?.tag || cached.authorTag || 'Unknown',
          content: truncate(msg.content || cached.content || '', 120),
        });
        if (samples.length >= 8) break;
      }

      const embed = brandEmbed(BRAND.danger)
        .setTitle('Bulk messages deleted')
        .addFields(
          { name: 'Channel', value: `${channel}`, inline: true },
          { name: 'Count', value: String(messages.size), inline: true },
          {
            name: 'Sample',
            value: samples.length
              ? samples.map((s) => `**${s.author}:** ${s.content}`).join('\n')
              : '*no cached content*',
          }
        );

      await sendLog(guild, embed);
    } catch (err) {
      console.error('messageDeleteBulk log error:', err);
    }
  });

  client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
      if (newMessage.partial) {
        try {
          newMessage = await newMessage.fetch();
        } catch {
          return;
        }
      }
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (isLogChannel(newMessage.guild, newMessage.channelId)) return;

      const cached = peekCached(newMessage.id);
      const before = oldMessage.content ?? cached?.content ?? '';
      const after = newMessage.content ?? '';
      if (before === after) {
        updateCached(newMessage);
        return;
      }

      updateCached(newMessage);

      const embed = brandEmbed(BRAND.warn)
        .setTitle('Message edited')
        .addFields(
          { name: 'Author', value: `${newMessage.author} (\`${newMessage.author.id}\`)`, inline: true },
          { name: 'Channel', value: `${newMessage.channel}`, inline: true },
          { name: 'Before', value: truncate(before, 1024) },
          { name: 'After', value: truncate(after, 1024) },
          { name: 'Jump', value: `[Go to message](${newMessage.url})` }
        )
        .setFooter({ text: `Ravex Security · message ${newMessage.id}` });

      await sendLog(newMessage.guild, embed);
    } catch (err) {
      console.error('messageUpdate log error:', err);
    }
  });

  client.on('guildMemberAdd', async (member) => {
    try {
      await sendLog(
        member.guild,
        brandEmbed(BRAND.ok)
          .setTitle('Member joined')
          .setThumbnail(member.user.displayAvatarURL())
          .addFields(
            { name: 'User', value: `${member} (\`${member.id}\`)`, inline: true },
            { name: 'Account created', value: `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Member count', value: String(member.guild.memberCount), inline: true }
          )
      );
    } catch (err) {
      console.error('guildMemberAdd log error:', err);
    }
  });

  client.on('guildMemberRemove', async (member) => {
    try {
      await sendLog(
        member.guild,
        brandEmbed(BRAND.warn)
          .setTitle('Member left')
          .setThumbnail(member.user.displayAvatarURL())
          .addFields(
            { name: 'User', value: `${member.user.tag} (\`${member.id}\`)`, inline: true },
            { name: 'Member count', value: String(member.guild.memberCount), inline: true }
          )
      );
    } catch (err) {
      console.error('guildMemberRemove log error:', err);
    }
  });

  client.on('guildBanAdd', async (ban) => {
    try {
      await sendLog(
        ban.guild,
        brandEmbed(BRAND.danger)
          .setTitle('User banned')
          .addFields(
            { name: 'User', value: `${ban.user.tag} (\`${ban.user.id}\`)`, inline: true },
            { name: 'Reason', value: ban.reason || 'No reason provided' }
          ),
        { mod: true }
      );
    } catch (err) {
      console.error('guildBanAdd log error:', err);
    }
  });

  client.on('guildBanRemove', async (ban) => {
    try {
      await sendLog(
        ban.guild,
        brandEmbed(BRAND.ok)
          .setTitle('User unbanned')
          .addFields({ name: 'User', value: `${ban.user.tag} (\`${ban.user.id}\`)` }),
        { mod: true }
      );
    } catch (err) {
      console.error('guildBanRemove log error:', err);
    }
  });

  client.on('guildMemberUpdate', async (oldMember, newMember) => {
    try {
      if (oldMember.nickname !== newMember.nickname) {
        await sendLog(
          newMember.guild,
          brandEmbed(BRAND.info)
            .setTitle('Nickname changed')
            .addFields(
              { name: 'User', value: `${newMember}`, inline: true },
              { name: 'Before', value: oldMember.nickname || '*none*', inline: true },
              { name: 'After', value: newMember.nickname || '*none*', inline: true }
            )
        );
      }

      const added = newMember.roles.cache.filter((r) => !oldMember.roles.cache.has(r.id) && r.id !== newMember.guild.id);
      const removed = oldMember.roles.cache.filter((r) => !newMember.roles.cache.has(r.id) && r.id !== newMember.guild.id);
      if (added.size || removed.size) {
        await sendLog(
          newMember.guild,
          brandEmbed(BRAND.info)
            .setTitle('Roles updated')
            .addFields(
              { name: 'User', value: `${newMember}` },
              ...(added.size ? [{ name: 'Added', value: added.map((r) => r.toString()).join(', ') }] : []),
              ...(removed.size ? [{ name: 'Removed', value: removed.map((r) => r.toString()).join(', ') }] : [])
            )
        );
      }
    } catch (err) {
      console.error('guildMemberUpdate log error:', err);
    }
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      const member = newState.member || oldState.member;
      if (!member || member.user.bot) return;
      const guild = newState.guild || oldState.guild;

      if (!oldState.channelId && newState.channelId) {
        await sendLog(
          guild,
          brandEmbed(BRAND.info).setTitle('Voice joined').setDescription(`${member} joined ${newState.channel}`)
        );
      } else if (oldState.channelId && !newState.channelId) {
        await sendLog(
          guild,
          brandEmbed(BRAND.info).setTitle('Voice left').setDescription(`${member} left ${oldState.channel}`)
        );
      } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        await sendLog(
          guild,
          brandEmbed(BRAND.info)
            .setTitle('Voice moved')
            .setDescription(`${member}: ${oldState.channel} → ${newState.channel}`)
        );
      }
    } catch (err) {
      console.error('voiceStateUpdate log error:', err);
    }
  });

  client.on('channelCreate', async (channel) => {
    try {
      if (!channel.guild) return;
      await sendLog(
        channel.guild,
        brandEmbed(BRAND.ok).setTitle('Channel created').setDescription(`${channel} (\`${channel.name}\`)`)
      );
    } catch (err) {
      console.error('channelCreate log error:', err);
    }
  });

  client.on('channelDelete', async (channel) => {
    try {
      if (!channel.guild) return;
      await sendLog(
        channel.guild,
        brandEmbed(BRAND.danger).setTitle('Channel deleted').setDescription(`#${channel.name} (\`${channel.id}\`)`)
      );
    } catch (err) {
      console.error('channelDelete log error:', err);
    }
  });
}

module.exports = { registerEvents };
