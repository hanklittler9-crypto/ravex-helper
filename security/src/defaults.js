const DEFAULT_CONFIG = {
  logChannelId: null,
  modLogChannelId: null,
  muteRoleId: null,
  staffRoleIds: [],
  automod: {
    enabled: true,
    ignoreStaff: true,
    deleteInvite: true,
    deleteLinks: false,
    maxMentions: 5,
    maxCapsPercent: 80,
    minCapsLength: 12,
    spamThreshold: 5,
    spamWindowMs: 7000,
    bannedWords: [],
    action: 'timeout', // delete | timeout | kick
    timeoutSeconds: 300,
  },
};

function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    staffRoleIds: Array.isArray(raw.staffRoleIds) ? raw.staffRoleIds : [],
    automod: {
      ...DEFAULT_CONFIG.automod,
      ...(raw.automod || {}),
      bannedWords: Array.isArray(raw.automod?.bannedWords) ? raw.automod.bannedWords : [],
    },
  };
}

module.exports = { DEFAULT_CONFIG, normalizeConfig };
