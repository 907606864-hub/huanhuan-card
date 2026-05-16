const config = require('../config');

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_AUTH_URL = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';

function getAuthUrl(state) {
  // 需要 guilds.members.read scope 来验证服务器成员身份
  const scopes = ['identify'];
  if (config.DISCORD_GUILD_ID) {
    scopes.push('guilds.members.read');
  }

  const params = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    redirect_uri: config.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: scopes.join(' '),
    state: state || '',
  });
  return `${DISCORD_AUTH_URL}?${params}`;
}

async function exchangeCode(code) {
  const body = new URLSearchParams({
    client_id: config.DISCORD_CLIENT_ID,
    client_secret: config.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.DISCORD_REDIRECT_URI,
  });

  const res = await fetch(DISCORD_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'HuanhuanCard/1.0' },
    body,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discord token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function getUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}`, 'User-Agent': 'HuanhuanCard/1.0' },
  });

  if (!res.ok) {
    throw new Error(`Discord user fetch failed: ${res.status}`);
  }

  return res.json();
}

/**
 * 验证 Guild 成员身份 + 身份组
 * 方法一：用户 OAuth token（需要 guilds.members.read scope）
 * 方法二：Bot token 回退（需要 Bot 在服务器中）
 * @returns {object|null} member 对象，null 表示非成员
 */
async function getGuildMember(discordUserId, userAccessToken) {
  // 方法一：用户 OAuth token
  {
    const url = `${DISCORD_API}/users/@me/guilds/${config.DISCORD_GUILD_ID}/member`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${userAccessToken}`, 'User-Agent': 'HuanhuanCard/1.0' },
    });

    if (res.status === 200) {
      return res.json();
    }
    if (res.status === 404) {
      return null; // 不是成员
    }
    // 其他错误，继续尝试方法二
    console.warn(`[AUTH] User token guild check returned ${res.status}`);
  }

  // 方法二：Bot token 回退
  if (config.DISCORD_BOT_TOKEN) {
    const url = `${DISCORD_API}/guilds/${config.DISCORD_GUILD_ID}/members/${discordUserId}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bot ${config.DISCORD_BOT_TOKEN}`, 'User-Agent': 'HuanhuanCard/1.0' },
    });

    if (res.status === 200) {
      return res.json();
    }
    if (res.status === 404) {
      return null;
    }
    const text = await res.text();
    throw new Error(`Bot API returned ${res.status}: ${text}`);
  }

  throw new Error('无法验证服务器成员身份');
}

/**
 * 检查身份组
 */
function checkRoles(memberRoles) {
  if (config.DISCORD_REQUIRED_ROLE_IDS.length === 0) {
    return true;
  }

  const roleSet = new Set(memberRoles);

  if (config.DISCORD_ROLE_MATCH === 'any') {
    return config.DISCORD_REQUIRED_ROLE_IDS.some(id => roleSet.has(id));
  }

  // 默认 'all'
  return config.DISCORD_REQUIRED_ROLE_IDS.every(id => roleSet.has(id));
}

module.exports = function (router) {
  const { getDb } = require('../db/init');
  const crypto = require('crypto');

  // Login redirect
  router.get('/discord', (req, res) => {
    const state = crypto.randomBytes(16).toString('hex');
    req.session.oauthState = state;
    res.redirect(getAuthUrl(state));
  });

  // Callback
  router.get('/discord/callback', async (req, res) => {
    try {
      const { code, state } = req.query;

      if (!code) {
        return res.redirect('/?error=no_code');
      }

      // Exchange code for token
      const tokenData = await exchangeCode(code);
      const discordUser = await getUser(tokenData.access_token);

      // ============ Guild + Role 验证 ============
      if (config.DISCORD_GUILD_ID) {
        let member;
        try {
          member = await getGuildMember(discordUser.id, tokenData.access_token);
        } catch (err) {
          console.warn(`[AUTH] Guild member lookup failed for ${discordUser.username} (${discordUser.id}):`, err.message);
          return res.redirect(`/?error=guild_check_failed&msg=${encodeURIComponent(config.DISCORD_AUTH_FAIL_MESSAGE)}`);
        }

        if (!member) {
          console.log(`[AUTH] Denied: ${discordUser.username} (${discordUser.id}) not in guild ${config.DISCORD_GUILD_ID}`);
          return res.redirect(`/?error=not_member&msg=${encodeURIComponent(config.DISCORD_AUTH_FAIL_MESSAGE)}`);
        }

        console.log(`[AUTH] ${discordUser.username} (${discordUser.id}) is guild member, roles: ${member.roles?.join(', ')}`);

        // 检查身份组
        if (config.DISCORD_REQUIRED_ROLE_IDS.length > 0) {
          if (!checkRoles(member.roles || [])) {
            console.log(`[AUTH] Denied: ${discordUser.username} missing roles. Has: [${member.roles?.join(', ')}], Needs: [${config.DISCORD_REQUIRED_ROLE_IDS.join(', ')}] (${config.DISCORD_ROLE_MATCH})`);
            return res.redirect(`/?error=missing_role&msg=${encodeURIComponent(config.DISCORD_AUTH_FAIL_MESSAGE)}`);
          }
          console.log(`[AUTH] ${discordUser.username} passed role verification`);
        }
      }

      // ============ 用户入库 ============
      const db = getDb();
      const userId = crypto.randomUUID();

      const existing = db.prepare('SELECT id FROM users WHERE discord_id = ?').get(discordUser.id);

      if (existing) {
        db.prepare(`
          UPDATE users SET username = ?, avatar = ?, global_name = ?, updated_at = CURRENT_TIMESTAMP
          WHERE discord_id = ?
        `).run(discordUser.username, discordUser.avatar, discordUser.global_name || discordUser.username, discordUser.id);
        req.session.userId = existing.id;
      } else {
        db.prepare(`
          INSERT INTO users (id, discord_id, username, avatar, global_name) VALUES (?, ?, ?, ?, ?)
        `).run(userId, discordUser.id, discordUser.username, discordUser.avatar, discordUser.global_name || discordUser.username);
        req.session.userId = userId;
      }

      req.session.discordUser = {
        id: discordUser.id,
        username: discordUser.username,
        avatar: discordUser.avatar,
        global_name: discordUser.global_name || discordUser.username,
      };

      res.redirect('/#/dashboard');
    } catch (err) {
      console.error('OAuth callback error:', err);
      const msg = String(err.message || '');
      if (msg.includes('rate limit')) {
        res.redirect('/?error=rate_limited');
      } else {
        res.redirect('/?error=oauth_failed');
      }
    }
  });

  // Get current user
  router.get('/me', (req, res) => {
    if (!req.session.userId) {
      return res.json({ loggedIn: false });
    }
    res.json({
      loggedIn: true,
      user: req.session.discordUser,
      userId: req.session.userId,
    });
  });

  // Logout
  router.post('/logout', (req, res) => {
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  });

  return router;
};
