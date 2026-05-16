const crypto = require('crypto');
const path = require('path');

/**
 * Read a required env var. Throws on missing/empty in production-ish paths.
 * Allows opt-out via DEV_INSECURE_DEFAULTS=1 for quick local hacking.
 */
function required(name, devDefault) {
  const v = process.env[name];
  if (v && v.trim()) return v;
  if (process.env.DEV_INSECURE_DEFAULTS === '1' && devDefault !== undefined) {
    console.warn(`[config] WARNING: using insecure dev default for ${name}. Set ${name} in .env for production.`);
    return devDefault;
  }
  throw new Error(`[config] Missing required env var: ${name}. See .env.example.`);
}

function optional(name, def) {
  return process.env[name] && process.env[name].trim() ? process.env[name] : def;
}

module.exports = {
  PORT: parseInt(optional('PORT', '3080'), 10),

  // Discord OAuth2
  DISCORD_CLIENT_ID: required('DISCORD_CLIENT_ID', 'dev-client-id'),
  DISCORD_CLIENT_SECRET: required('DISCORD_CLIENT_SECRET', 'dev-client-secret'),
  DISCORD_REDIRECT_URI: required('DISCORD_REDIRECT_URI', 'http://localhost:3080/auth/discord/callback'),

  // Discord Guild & Role 验证（可选；不填则不做角色校验）
  DISCORD_GUILD_ID: optional('DISCORD_GUILD_ID', ''),
  DISCORD_REQUIRED_ROLE_IDS: (optional('DISCORD_REQUIRED_ROLE_IDS', '') || '').split(',').filter(Boolean),
  DISCORD_ROLE_MATCH: optional('DISCORD_ROLE_MATCH', 'all'),
  DISCORD_BOT_TOKEN: optional('DISCORD_BOT_TOKEN', ''),
  DISCORD_AUTH_FAIL_MESSAGE: optional('DISCORD_AUTH_FAIL_MESSAGE', '请先加入指定服务器并完成创作者身份组验证'),

  // Session
  SESSION_SECRET: required('SESSION_SECRET', crypto.randomBytes(32).toString('hex')),

  // AES-256 encryption key (32 bytes / 64 hex chars). Used to encrypt user API keys at rest.
  // ⚠️ 一旦设定后绝不能变，否则数据库里所有已加密的 user API key 都会无法解密。
  ENCRYPTION_KEY: required('ENCRYPTION_KEY', crypto.randomBytes(32).toString('hex')),

  // Paths
  DATA_DIR: path.join(__dirname, 'data'),
  DB_PATH: path.join(__dirname, 'data', 'db.sqlite'),
  CARDS_DIR: path.join(__dirname, 'data', 'cards'),
  TEMPLATES_DIR: path.join(__dirname, 'templates'),

  // Card defaults
  CC_LICENSE: optional(
    'CC_LICENSE',
    '本角色卡采用 CC BY-NC 4.0 协议发布。\nhttps://creativecommons.org/licenses/by-nc/4.0/'
  ),
};
