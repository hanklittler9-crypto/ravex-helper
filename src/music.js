const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
} = require('@discordjs/voice');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const play = require('play-dl');
const { brandEmbed } = require('./welcome');

try {
  const ffmpegPath = require('ffmpeg-static');
  if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFMPEG_BIN = ffmpegPath;
  }
} catch {
  // ffmpeg-static is optional for voice receive; required for music
}

/** @type {Map<string, { queue: object[], player: import('@discordjs/voice').AudioPlayer, textChannelId: string|null, playing: object|null }>} */
const guildPlayers = new Map();

function getStore(guildId) {
  if (!guildPlayers.has(guildId)) {
    const player = createAudioPlayer();
    const store = { queue: [], player, textChannelId: null, playing: null };
    player.on(AudioPlayerStatus.Idle, () => {
      store.playing = null;
      playNext(guildId).catch((err) => console.error('Music playNext error:', err.message));
    });
    player.on('error', (err) => {
      console.error('Audio player error:', err.message);
      store.playing = null;
      playNext(guildId).catch(() => null);
    });
    guildPlayers.set(guildId, store);
  }
  return guildPlayers.get(guildId);
}

function attachConnectionHandlers(connection) {
  if (connection._ravexHandlers) return;
  connection._ravexHandlers = true;

  connection.on('error', (err) => {
    console.error('Voice connection error:', err.message);
  });

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      try {
        connection.destroy();
      } catch {
        // already destroyed
      }
    }
  });
}

function voiceChannelOf(member) {
  return member.voice?.channel || member.guild.voiceStates.cache.get(member.id)?.channel || null;
}

async function waitUntilReady(connection) {
  if (connection.state.status === VoiceConnectionStatus.Ready) return;
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
}

function joinFailedMessage(err) {
  const detail = err?.message ? ` (${err.message})` : '';
  return (
    `Could not join the voice channel${detail}. Discord voice never became ready. ` +
    'Sit in a VC, make sure the bot has **Connect** + **Speak**, and if you host on Render/cloud, run the bot on a VPS or your PC (voice needs UDP).'
  );
}

async function ensureConnection(member) {
  const channel = voiceChannelOf(member);
  if (!channel) {
    return { error: 'Join a voice channel first, then run `*join` (or `*vm join`).' };
  }

  const me = channel.guild.members.me;
  const perms = channel.permissionsFor(me);
  if (perms && (!perms.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak))) {
    return { error: `I need **Connect** and **Speak** in **${channel.name}**.` };
  }

  const player = getStore(member.guild.id).player;
  let existing = getVoiceConnection(member.guild.id);
  if (
    existing &&
    (existing.state.status === VoiceConnectionStatus.Destroyed ||
      existing.state.status === VoiceConnectionStatus.Disconnected)
  ) {
    try {
      existing.destroy();
    } catch {
      // ignore
    }
    existing = null;
  }

  if (existing) {
    const sameChannel = existing.joinConfig?.channelId === channel.id;
    if (!sameChannel) {
      try {
        existing.rejoin({
          channelId: channel.id,
          selfDeaf: false,
          selfMute: false,
        });
      } catch {
        try {
          existing.destroy();
        } catch {
          // ignore
        }
        existing = null;
      }
    }
  }

  const connection =
    existing ||
    joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: false,
      decryptionFailureTolerance: 32,
    });

  attachConnectionHandlers(connection);
  connection.subscribe(player);

  try {
    await waitUntilReady(connection);
  } catch (err) {
    try {
      connection.destroy();
    } catch {
      // ignore
    }
    return { error: joinFailedMessage(err) };
  }

  if (channel.type === ChannelType.GuildStageVoice) {
    await me?.voice?.setSuppressed(false).catch(() => null);
  }

  return { connection, channel };
}

async function resolveTrack(query) {
  if (play.yt_validate(query) === 'video') {
    const info = await play.video_info(query);
    const details = info.video_details;
    return {
      title: details.title,
      url: details.url,
      duration: details.durationInSec,
      thumbnail: details.thumbnails?.[0]?.url,
    };
  }

  const results = await play.search(query, { limit: 1 });
  const hit = results?.[0];
  if (!hit) return null;
  return {
    title: hit.title,
    url: hit.url,
    duration: hit.durationInSec,
    thumbnail: hit.thumbnails?.[0]?.url,
  };
}

async function playNext(guildId) {
  const store = getStore(guildId);
  const next = store.queue.shift();
  if (!next) {
    store.playing = null;
    return;
  }

  const stream = await play.stream(next.url);
  const resource = createAudioResource(stream.stream, { inputType: stream.type });
  store.playing = next;
  store.player.play(resource);
}

async function enqueue(message, query) {
  if (!query) return message.reply({ content: 'Usage: `*play <song or url>`' });

  const joined = await ensureConnection(message.member);
  if (joined.error) return message.reply({ content: joined.error });

  const store = getStore(message.guild.id);
  store.textChannelId = message.channel.id;

  const status = await message.reply({ content: `Searching… **${query.slice(0, 80)}**` });
  let track;
  try {
    track = await resolveTrack(query);
  } catch (err) {
    return status.edit({ content: `Search failed: ${err.message}` });
  }
  if (!track) return status.edit({ content: 'No results found.' });

  track.requestedBy = message.author.id;
  const wasIdle = !store.playing && store.queue.length === 0;
  store.queue.push(track);

  if (wasIdle) {
    try {
      await playNext(message.guild.id);
      return status.edit({
        embeds: [
          brandEmbed()
            .setTitle('Now playing')
            .setDescription(`[${track.title}](${track.url})`)
            .setThumbnail(track.thumbnail || null)
            .addFields({ name: 'Requested by', value: `${message.author}`, inline: true }),
        ],
      });
    } catch (err) {
      store.queue = [];
      store.playing = null;
      return status.edit({ content: `Could not play: ${err.message}` });
    }
  }

  return status.edit({
    embeds: [
      brandEmbed()
        .setTitle('Added to queue')
        .setDescription(`[${track.title}](${track.url})`)
        .setThumbnail(track.thumbnail || null)
        .addFields({ name: 'Position', value: String(store.queue.length), inline: true }),
    ],
  });
}

function skip(message) {
  const store = getStore(message.guild.id);
  if (!store.playing) return message.reply({ content: 'Nothing is playing.' });
  store.player.stop(true);
  return message.reply({ content: 'Skipped.' });
}

function stop(message) {
  const store = getStore(message.guild.id);
  store.queue = [];
  store.playing = null;
  store.player.stop(true);
  return message.reply({ content: 'Stopped and cleared the queue.' });
}

function pause(message) {
  const store = getStore(message.guild.id);
  if (!store.playing) return message.reply({ content: 'Nothing is playing.' });
  store.player.pause();
  return message.reply({ content: 'Paused.' });
}

function resume(message) {
  const store = getStore(message.guild.id);
  store.player.unpause();
  return message.reply({ content: 'Resumed.' });
}

function queue(message) {
  const store = getStore(message.guild.id);
  if (!store.playing && !store.queue.length) {
    return message.reply({ content: 'Queue is empty.' });
  }
  const lines = [];
  if (store.playing) lines.push(`**Now:** [${store.playing.title}](${store.playing.url})`);
  store.queue.slice(0, 10).forEach((t, i) => {
    lines.push(`**${i + 1}.** [${t.title}](${t.url})`);
  });
  if (store.queue.length > 10) lines.push(`…and ${store.queue.length - 10} more`);
  return message.reply({
    embeds: [brandEmbed().setTitle('Music queue').setDescription(lines.join('\n'))],
  });
}

function nowPlaying(message) {
  const store = getStore(message.guild.id);
  if (!store.playing) return message.reply({ content: 'Nothing is playing.' });
  const t = store.playing;
  return message.reply({
    embeds: [
      brandEmbed()
        .setTitle('Now playing')
        .setDescription(`[${t.title}](${t.url})`)
        .setThumbnail(t.thumbnail || null),
    ],
  });
}

function leave(message) {
  const store = getStore(message.guild.id);
  store.queue = [];
  store.playing = null;
  store.player.stop(true);
  const conn = getVoiceConnection(message.guild.id);
  if (conn) conn.destroy();
  return message.reply({ content: 'Left the voice channel.' });
}

module.exports = {
  enqueue,
  skip,
  stop,
  pause,
  resume,
  queue,
  nowPlaying,
  leave,
  ensureConnection,
  getStore,
};
