const { brandEmbed, sendLog, truncate, BRAND } = require('./logger');
const { handleAutomod } = require('./automod');

function registerEvents(client) {
  client.on('messageCreate', async (message) => {
    try {
      await handleAutomod(message);
    } catch (err) {
      console.error('Automod error:', err);
    }
  });

  client.on('messageDelete', async (message) => {
    try {
      if (!message.guild || message.author?.bot) return;
      await sendLog(
        message.guild,
        brandEmbed(BRAND.danger)
          .setTitle('Message deleted')
          .addFields(
            { name: 'Author', value: message.author ? `${message.author} (\`${message.author.id}\`)` : 'Unknown', inline: true },
            { name: 'Channel', value: `${message.channel}`, inline: true },
            { name: 'Content', value: truncate(message.content) }
          )
      );
    } catch (err) {
      console.error('messageDelete log error:', err);
    }
  });

  client.on('messageUpdate', async (oldMessage, newMessage) => {
    try {
      if (!newMessage.guild || newMessage.author?.bot) return;
      if (oldMessage.content === newMessage.content) return;
      await sendLog(
        newMessage.guild,
        brandEmbed(BRAND.warn)
          .setTitle('Message edited')
          .addFields(
            { name: 'Author', value: `${newMessage.author} (\`${newMessage.author.id}\`)`, inline: true },
            { name: 'Channel', value: `${newMessage.channel}`, inline: true },
            { name: 'Before', value: truncate(oldMessage.content) },
            { name: 'After', value: truncate(newMessage.content) },
            { name: 'Jump', value: `[Go to message](${newMessage.url})` }
          )
      );
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
          brandEmbed(BRAND.info)
            .setTitle('Voice joined')
            .setDescription(`${member} joined ${newState.channel}`)
        );
      } else if (oldState.channelId && !newState.channelId) {
        await sendLog(
          guild,
          brandEmbed(BRAND.info)
            .setTitle('Voice left')
            .setDescription(`${member} left ${oldState.channel}`)
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
