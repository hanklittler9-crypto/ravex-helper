const DEFAULT_WELCOME = {
  enabled: true,
  channelId: null,
  pingUser: true,
  useEmbed: true,
  message: '', // plain text outside embed (or sole message if embed off)
  description: 'Welcome to **{server}**, {user}!\nYou are member **#{count}**.',
  messages: [], // random description pool; if set, overrides description
  title: 'Welcome to {server}!',
  color: '#a855f7',
  footer: '{server} · member #{count}',
  footerIcon: 'server', // server | user | none | url
  footerIconUrl: '',
  authorText: '',
  authorIcon: 'none', // server | user | none | url
  authorIconUrl: '',
  showTimestamp: true,
  thumbnail: 'user', // user | server | none | url
  thumbnailUrl: '',
  imageUrl: '',
  fields: [], // [{ name, value, inline }]
  dmEnabled: false,
  dmMessage: 'Hey {username}! Welcome to **{server}**. Glad you are here.',
  dmUseEmbed: true,
  leaveEnabled: false,
  leaveChannelId: null,
  leaveMessage: '**{username}** left **{server}**. We now have **{count}** members.',
  leaveUseEmbed: true,
  leaveColor: '#ef5b5b',
  autoRoleIds: [],
  rulesChannelId: null,
  // Generated welcome card (avatar circle on Ravex banner)
  cardEnabled: true,
  cardX: 82,
  cardY: 58,
  cardSize: 42,
  cardBorderColor: '#c084fc',
  cardBorderWidth: 6,
  cardShowName: true,
};

function normalizeWelcome(raw = {}) {
  // migrate legacy flat keys
  const migrated = { ...DEFAULT_WELCOME, ...raw };
  if (raw.welcomeChannelId && !raw.channelId) migrated.channelId = raw.welcomeChannelId;
  if (raw.welcomeMessage && !raw.description && !raw.messages?.length) {
    migrated.description = raw.welcomeMessage;
  }
  if (!Array.isArray(migrated.messages)) migrated.messages = [];
  if (!Array.isArray(migrated.fields)) migrated.fields = [];
  if (!Array.isArray(migrated.autoRoleIds)) migrated.autoRoleIds = [];
  return migrated;
}

module.exports = { DEFAULT_WELCOME, normalizeWelcome };
