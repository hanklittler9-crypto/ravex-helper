const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { AttachmentBuilder } = require('discord.js');

const BANNER_PATH = path.join(__dirname, '..', 'assets', 'welcome-banner.png');

const DEFAULT_CARD = {
  enabled: true,
  x: 50, // center — between VL logo and VLOCITY text
  y: 48,
  size: 38,
  borderColor: '#60a5fa',
  borderWidth: 6,
  showName: true,
  nameColor: '#ffffff',
};

function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

async function loadAvatar(member) {
  const url = member.user.displayAvatarURL({ extension: 'png', size: 256 });
  return loadImage(url);
}

async function renderWelcomeCard(member, options = {}) {
  const opts = { ...DEFAULT_CARD, ...options };
  const banner = await loadImage(BANNER_PATH);
  const canvas = createCanvas(banner.width, banner.height);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(banner, 0, 0, banner.width, banner.height);

  const diameter = (clamp(Number(opts.size) || DEFAULT_CARD.size, 15, 70) / 100) * banner.height;
  const radius = diameter / 2;
  const cx = (clamp(Number(opts.x) || DEFAULT_CARD.x, 5, 95) / 100) * banner.width;
  const cy = (clamp(Number(opts.y) || DEFAULT_CARD.y, 5, 95) / 100) * banner.height;

  const avatar = await loadAvatar(member);

  // soft blue glow
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 10, 0, Math.PI * 2);
  ctx.shadowColor = opts.borderColor || DEFAULT_CARD.borderColor;
  ctx.shadowBlur = 28;
  ctx.fillStyle = 'rgba(96, 165, 250, 0.35)';
  ctx.fill();
  ctx.restore();

  // circular clip for avatar
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(avatar, cx - radius, cy - radius, diameter, diameter);
  ctx.restore();

  // neon ring
  const borderWidth = clamp(Number(opts.borderWidth) || DEFAULT_CARD.borderWidth, 2, 16);
  ctx.beginPath();
  ctx.arc(cx, cy, radius + borderWidth / 2, 0, Math.PI * 2);
  ctx.strokeStyle = opts.borderColor || DEFAULT_CARD.borderColor;
  ctx.lineWidth = borderWidth;
  ctx.stroke();

  // thin white inner ring
  ctx.beginPath();
  ctx.arc(cx, cy, radius - 1, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (opts.showName !== false) {
    const name = (member.displayName || member.user.globalName || member.user.username || 'Member').slice(0, 24);
    ctx.font = 'bold 28px Sans-Serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.fillStyle = opts.nameColor || DEFAULT_CARD.nameColor;
    const textY = Math.min(banner.height - 40, cy + radius + 14);
    ctx.strokeText(name, cx, textY);
    ctx.fillText(name, cx, textY);
  }

  return canvas.toBuffer('image/png');
}

async function buildWelcomeCardAttachment(member, options = {}) {
  const buffer = await renderWelcomeCard(member, options);
  return new AttachmentBuilder(buffer, { name: 'ravex-welcome.png' });
}

module.exports = {
  DEFAULT_CARD,
  BANNER_PATH,
  renderWelcomeCard,
  buildWelcomeCardAttachment,
};
