const fs = require('fs');
const path = require('path');
const {
  EndBehaviorType,
  getVoiceConnection,
} = require('@discordjs/voice');
const prism = require('prism-media');
const { PermissionFlagsBits } = require('discord.js');
const { brandEmbed } = require('./welcome');
const { ensureConnection } = require('./music');

const DATA_DIR = path.join(__dirname, '..', 'data');
const WARN_PATH = path.join(DATA_DIR, 'voice-warnings.json');
const SLURS_PATH = path.join(DATA_DIR, 'voice-slurs.json');

const DEFAULT_SLURS = [
  'nigger',
  'nigga',
  'faggot',
  'retard',
  'tranny',
  'kike',
  'chink',
  'spic',
];

/** @type {Map<string, { enabled: boolean, listening: Set<string> }>} */
const sessions = new Map();
const strikeLimit = 3;
const timeoutMs = 60 * 60 * 1000;

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(WARN_PATH)) fs.writeFileSync(WARN_PATH, '{}');
  if (!fs.existsSync(SLURS_PATH)) fs.writeFileSync(SLURS_PATH, JSON.stringify(DEFAULT_SLURS, null, 2));
}

function readJson(file, fallback) {
  ensureData();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  ensureData();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function getSlurs() {
  const list = readJson(SLURS_PATH, DEFAULT_SLURS);
  return Array.isArray(list) ? list.map((s) => String(s).toLowerCase()) : [...DEFAULT_SLURS];
}

function getWarnings(guildId, userId) {
  const all = readJson(WARN_PATH, {});
  return all[`${guildId}:${userId}`] || { count: 0, history: [] };
}

function saveWarning(guildId, userId, reason, transcript) {
  const all = readJson(WARN_PATH, {});
  const key = `${guildId}:${userId}`;
  const current = all[key] || { count: 0, history: [] };
  current.count += 1;
  current.history.push({ reason, transcript, at: Date.now() });
  current.history = current.history.slice(-20);
  all[key] = current;
  writeJson(WARN_PATH, all);
  return current;
}

function clearWarnings(guildId, userId) {
  const all = readJson(WARN_PATH, {});
  delete all[`${guildId}:${userId}`];
  writeJson(WARN_PATH, all);
}

function findSlur(text, slurs) {
  const lower = text.toLowerCase();
  return slurs.find((w) => w && lower.includes(w)) || null;
}

function pcmToWav(pcmBuffer, sampleRate = 48000, channels = 2) {
  const header = Buffer.alloc(44);
  const dataSize = pcmBuffer.length;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);
  return Buffer.concat([header, pcmBuffer]);
}

/** Convert Discord PCM (48k stereo s16le) → 16k mono float32 for Whisper */
function pcmToWhisperAudio(pcmBuffer) {
  const samples = Math.floor(pcmBuffer.length / 2);
  const input = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, samples);
  const frames = Math.floor(samples / 2);
  const mono48 = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const l = input[i * 2] / 32768;
    const r = input[i * 2 + 1] / 32768;
    mono48[i] = (l + r) / 2;
  }
  const outLen = Math.floor(frames / 3);
  const mono16 = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) mono16[i] = mono48[i * 3];
  return mono16;
}

let transcriberPromise = null;

async function getLocalTranscriber() {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline, env } = await import('@xenova/transformers');
      env.allowLocalModels = false;
      const model = process.env.WHISPER_MODEL || 'Xenova/whisper-tiny.en';
      console.log(`[voice] Loading local Whisper model: ${model}`);
      return pipeline('automatic-speech-recognition', model);
    })();
  }
  return transcriberPromise;
}

async function transcribeOpenAI(wavBuffer) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY missing');

  const form = new FormData();
  form.append('model', 'whisper-1');
  form.append('file', new Blob([wavBuffer], { type: 'audio/wav' }), 'speech.wav');
  form.append('response_format', 'text');

  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI Whisper failed: ${res.status} ${errText.slice(0, 200)}`);
  }
  return (await res.text()).trim();
}

async function transcribeLocal(pcmBuffer) {
  const audio = pcmToWhisperAudio(pcmBuffer);
  if (audio.length < 1600) return ''; // <0.1s
  const transcriber = await getLocalTranscriber();
  const result = await transcriber(audio, {
    sampling_rate: 16000,
    chunk_length_s: 30,
    return_timestamps: false,
  });
  return (result?.text || '').trim();
}

async function transcribePcm(pcmBuffer) {
  const mode = (process.env.VOICE_STT || 'local').toLowerCase();
  if (mode === 'openai') {
    return transcribeOpenAI(pcmToWav(pcmBuffer));
  }
  // default: local Whisper via transformers.js (works with Ollama setup, no cloud STT)
  return transcribeLocal(pcmBuffer);
}

function ollamaConfig() {
  return {
    url: (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL || 'llama3.2',
  };
}

async function ollamaDetectSlur(transcript) {
  const { url, model } = ollamaConfig();
  const slurs = getSlurs().join(', ');
  const prompt = [
    'You are a Discord voice chat moderator.',
    `Banned words/examples: ${slurs}`,
    `Transcript: """${transcript}"""`,
    'Does the transcript contain a slur, hate speech, or clear severe insult?',
    'Reply with ONLY JSON like {"hit":true,"word":"n-word"} or {"hit":false,"word":null}',
    'Be strict on real slurs; ignore mild swearing like damn/hell/shit unless it is a slur.',
  ].join('\n');

  const res = await fetch(`${url}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0, num_predict: 80 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama error ${res.status}: ${(await res.text()).slice(0, 180)}`);
  }

  const data = await res.json();
  const raw = data.response || '';
  try {
    const parsed = JSON.parse(raw);
    if (parsed.hit && parsed.word) return String(parsed.word);
    if (parsed.hit) return 'slur';
    return null;
  } catch {
    if (/\bhit\b.*\btrue\b/i.test(raw)) return 'slur';
    return null;
  }
}

async function detectViolation(transcript) {
  // Fast path: keyword list
  const keyword = findSlur(transcript, getSlurs());
  if (keyword) return keyword;

  const provider = (process.env.VOICE_MOD_PROVIDER || 'ollama').toLowerCase();
  if (provider === 'keywords') return null;

  // Ollama judgment (default)
  try {
    return await ollamaDetectSlur(transcript);
  } catch (err) {
    console.error('Ollama detect failed, using keywords only:', err.message);
    return null;
  }
}

async function collectUserAudio(receiver, userId) {
  const opus = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 800 },
  });
  const decoder = new prism.opus.Decoder({ frameSize: 960, channels: 2, rate: 48000 });
  const chunks = [];

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      opus.destroy();
      resolve();
    }, 15000);

    opus.pipe(decoder);
    decoder.on('data', (c) => chunks.push(c));
    decoder.on('end', () => {
      clearTimeout(timeout);
      resolve();
    });
    decoder.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
    opus.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  return Buffer.concat(chunks);
}

async function handleStrike(guild, member, hit, transcript, textChannel) {
  const record = saveWarning(guild.id, member.id, hit, transcript);
  const remaining = Math.max(0, strikeLimit - record.count);

  const warnEmbed = brandEmbed()
    .setColor(0xf59e0b)
    .setTitle('Voice warning')
    .setDescription(
      [
        `${member} said a banned word in voice.`,
        `**Detected:** \`${hit}\``,
        `**Transcript:** ${transcript.slice(0, 300) || '*empty*'}`,
        `**Strikes:** **${record.count}/${strikeLimit}**`,
        remaining
          ? `${remaining} more → 1 hour timeout`
          : 'Limit reached → **1 hour timeout**',
      ].join('\n')
    );

  if (textChannel?.isTextBased()) await textChannel.send({ embeds: [warnEmbed] }).catch(() => null);
  await member.send(`Voice warning in **${guild.name}**: detected \`${hit}\` (${record.count}/${strikeLimit}).`).catch(() => null);

  if (record.count >= strikeLimit) {
    await member.timeout(timeoutMs, `Voice automod: ${strikeLimit} slur warnings`).catch(() => null);
    const all = readJson(WARN_PATH, {});
    all[`${guild.id}:${member.id}`] = { count: 0, history: record.history };
    writeJson(WARN_PATH, all);

    const toEmbed = brandEmbed()
      .setColor(0xef4444)
      .setTitle('Voice timeout')
      .setDescription(`${member} hit **${strikeLimit}** voice warnings and was timed out for **1 hour**.`);
    if (textChannel?.isTextBased()) await textChannel.send({ embeds: [toEmbed] }).catch(() => null);
  }
}

function isStaff(member) {
  return (
    member.permissions.has(PermissionFlagsBits.ModerateMembers) ||
    member.permissions.has(PermissionFlagsBits.ManageMessages) ||
    member.permissions.has(PermissionFlagsBits.Administrator)
  );
}

function startListening(guild, connection, textChannel) {
  const session = sessions.get(guild.id) || { enabled: true, listening: new Set(), hooked: false };
  session.enabled = true;
  session.textChannelId = textChannel?.id || session.textChannelId;
  if (session.connection !== connection) {
    session.hooked = false;
    session.connection = connection;
  }
  sessions.set(guild.id, session);

  if (session.hooked) return;
  session.hooked = true;

  const receiver = connection.receiver;

  receiver.speaking.on('start', async (userId) => {
    const current = sessions.get(guild.id);
    if (!current?.enabled) return;
    if (current.listening.has(userId)) return;
    if (userId === guild.client.user.id) return;

    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member || member.user.bot || isStaff(member)) return;

    const channel =
      (current.textChannelId && (await guild.channels.fetch(current.textChannelId).catch(() => null))) ||
      textChannel;

    current.listening.add(userId);
    try {
      const pcm = await collectUserAudio(receiver, userId);
      if (!pcm.length || pcm.length < 48000) return;

      const transcript = await transcribePcm(pcm);
      if (!transcript) return;

      const hit = await detectViolation(transcript);
      if (!hit) return;

      await handleStrike(guild, member, hit, transcript, channel);
    } catch (err) {
      console.error('Voice mod error:', err.message);
    } finally {
      current.listening.delete(userId);
    }
  });
}

function joinSuccessPayload(channel) {
  const { url, model } = ollamaConfig();
  const stt = (process.env.VOICE_STT || 'local').toLowerCase();
  return {
    embeds: [
      brandEmbed()
        .setTitle('Joined voice')
        .setDescription(
          [
            `Connected to **${channel.name}** and listening.`,
            `STT: **${stt}** (local Whisper by default)`,
            `Judge: **Ollama** \`${model}\` @ \`${url}\``,
            `Slurs → warn. **${strikeLimit} warns** → **1 hour** timeout.`,
            'Staff ignored. `*leave` or `*vm leave` to stop.',
          ].join('\n')
        ),
    ],
  };
}

async function joinVoiceMod(member, textChannel) {
  const joined = await ensureConnection(member);
  if (joined.error) return { error: joined.error };

  const stt = (process.env.VOICE_STT || 'local').toLowerCase();
  if (stt !== 'openai') {
    getLocalTranscriber().catch((err) => console.error('Whisper load failed:', err.message));
  }

  startListening(member.guild, joined.connection, textChannel);
  return { channel: joined.channel };
}

async function joinListen(message) {
  const result = await joinVoiceMod(message.member, message.channel);
  if (result.error) return message.reply({ content: result.error });
  return message.reply(joinSuccessPayload(result.channel));
}

async function leaveListen(message) {
  const session = sessions.get(message.guild.id);
  if (session) session.enabled = false;
  return message.reply({ content: 'Voice moderation listening paused. (Use `*leave` to disconnect from VC entirely.)' });
}

function status(message) {
  const session = sessions.get(message.guild.id);
  const conn = getVoiceConnection(message.guild.id);
  const warns = getWarnings(message.guild.id, message.author.id);
  const { url, model } = ollamaConfig();
  return message.reply({
    embeds: [
      brandEmbed()
        .setTitle('Voice moderation')
        .setDescription(
          [
            `Listening: **${session?.enabled ? 'yes' : 'no'}**`,
            `In VC: **${conn ? 'yes' : 'no'}**`,
            `STT: **${process.env.VOICE_STT || 'local'}**`,
            `Ollama: \`${model}\` @ \`${url}\``,
            `Your strikes: **${warns.count}/${strikeLimit}**`,
            `Banned words loaded: **${getSlurs().length}**`,
          ].join('\n')
        ),
    ],
  });
}

function showWarnings(message) {
  const user = message.mentions.users.first() || message.author;
  const record = getWarnings(message.guild.id, user.id);
  if (!record.count && !record.history?.length) {
    return message.reply({ content: `${user} has no voice warnings.` });
  }
  const lines = (record.history || [])
    .slice(-10)
    .map((h, i) => `**${i + 1}.** \`${h.reason}\` — ${h.transcript?.slice(0, 80) || '?'} (<t:${Math.floor(h.at / 1000)}:R>)`)
    .join('\n');
  return message.reply({
    embeds: [
      brandEmbed()
        .setTitle(`Voice warnings — ${user.username}`)
        .setDescription(`Strikes: **${record.count}/${strikeLimit}**\n\n${lines || '*none*'}`),
    ],
  });
}

function clearUserWarnings(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
    return message.reply({ content: 'You need Timeout Members permission.' });
  }
  const user = message.mentions.users.first();
  if (!user) return message.reply({ content: 'Usage: `*vm clear @user`' });
  clearWarnings(message.guild.id, user.id);
  return message.reply({ content: `Cleared voice warnings for ${user}.` });
}

function addSlur(message, word) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply({ content: 'Need Manage Server.' });
  }
  if (!word) return message.reply({ content: 'Usage: `*vm addword <word>`' });
  const list = getSlurs();
  const w = word.toLowerCase();
  if (!list.includes(w)) list.push(w);
  writeJson(SLURS_PATH, list);
  return message.reply({ content: `Added \`${w}\`. Total: ${list.length}` });
}

function listSlurs(message) {
  if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return message.reply({ content: 'Need Manage Server.' });
  }
  const list = getSlurs();
  return message.reply({ content: list.length ? list.map((w) => `\`${w}\``).join(', ') : 'No words.' });
}

async function handleVoiceModCommand(message, { args, argString }) {
  const sub = (args[0] || 'status').toLowerCase();
  const rest = args.slice(1).join(' ').trim();

  if (sub === 'join' || sub === 'start' || sub === 'listen') return joinListen(message);
  if (sub === 'leave' || sub === 'stop') return leaveListen(message);
  if (sub === 'status') return status(message);
  if (sub === 'warnings' || sub === 'warns') return showWarnings(message);
  if (sub === 'clear') return clearUserWarnings(message);
  if (sub === 'addword') return addSlur(message, rest || args[1]);
  if (sub === 'words' || sub === 'list') return listSlurs(message);

  return message.reply({
    content: [
      '**Voice mod commands**',
      '`*join` / `*vm join` — join your VC and listen for slurs',
      '`*leave` / `*vm leave` — leave / stop listening',
      '`*vm status` — status',
      '`*vm warnings [@user]` — strikes',
      '`*vm clear @user` — clear strikes',
      '`*vm addword <word>` / `*vm words`',
      '',
      'Needs Ollama running locally (and first-time Whisper model download). 3 strikes → 1h timeout.',
    ].join('\n'),
  });
}

module.exports = {
  handleVoiceModCommand,
  joinListen,
  joinVoiceMod,
  joinSuccessPayload,
  getSlurs,
};
