# 🎤 欢欢制卡站

AI 驱动的 SillyTavern 角色卡创作平台。Discord OAuth 登录，用户自带 OpenAI 兼容 API key，分步生成角色设定 / 世界书 / 开场白 / MVU 变量。

## ✨ 功能

- **AI 分步生成** — 角色设定 → 世界书 → 开场白 → MVU 变量
- **多角色世界书** — 每个配角独立条目
- **小说导入** — 粘贴小说文本，AI 自动提取角色 / 世界观 / 时间线
- **世界书编辑器** — 关键词触发、阶段内容
- **MVU 变量系统** — zod schema + 状态栏
- **开场白美化** — 毛玻璃、渐变多种模板
- **正则定制** — 自定义正则脚本，导入 / 导出
- **草稿保存** — 自动写 localStorage
- **导入已有卡** — 读 `.png` 角色卡，保留世界书
- **Agent 模式** — 让 AI 直接编辑卡片

## 🚀 部署

### 准备

1. Node.js ≥ 18
2. Discord 应用（[创建](https://discord.com/developers/applications)）：
   - 拿 `client_id` / `client_secret`
   - OAuth2 Redirects 加 `https://你的域名/auth/discord/callback`
3. 生成两把密钥：
   ```bash
   openssl rand -hex 32  # → SESSION_SECRET
   openssl rand -hex 32  # → ENCRYPTION_KEY
   ```

### 启动

```bash
git clone https://github.com/<your>/huanhuan-card.git
cd huanhuan-card
npm install

cp .env.example .env
# 编辑 .env 填上面 4 项

node server.js
# 默认监听 http://0.0.0.0:3080
```

### 反代（推荐）

加一层 nginx + HTTPS，例如 `huan.example.com`：

```nginx
server {
    listen 443 ssl;
    server_name huan.example.com;

    location / {
        proxy_pass http://127.0.0.1:3080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### systemd（可选）

```ini
[Unit]
Description=huanhuan-card
After=network.target

[Service]
WorkingDirectory=/opt/huanhuan-card
EnvironmentFile=/opt/huanhuan-card/.env
ExecStart=/usr/bin/node server.js
Restart=always
User=nobody

[Install]
WantedBy=multi-user.target
```

## 📋 环境变量

完整说明见 [.env.example](.env.example)。

| 必填 | 说明 |
|------|------|
| `DISCORD_CLIENT_ID` | Discord OAuth2 client id |
| `DISCORD_CLIENT_SECRET` | Discord OAuth2 client secret |
| `DISCORD_REDIRECT_URI` | OAuth 回调地址 |
| `SESSION_SECRET` | session 签名（32+ 字节随机） |
| `ENCRYPTION_KEY` | AES-256 key（64 hex chars，⚠️ 一旦设定不能变） |

可选：`PORT` `DISCORD_GUILD_ID` `DISCORD_REQUIRED_ROLE_IDS` `DISCORD_ROLE_MATCH` `DISCORD_BOT_TOKEN` `CC_LICENSE`

## 🔐 安全说明

- 用户 API key 在数据库内用 `ENCRYPTION_KEY` 做 AES-256-CBC 加密存储
- session 数据存 SQLite（`data/sessions.sqlite`）
- 部署时务必走 HTTPS（cookie `secure` 依赖 trust proxy + 反代）

## 📂 数据

所有用户数据写到 `./data/`，含：
- `db.sqlite` — 主库
- `cards/` — 生成的角色卡 PNG
- `sessions.sqlite` — Express session

备份直接打包 `data/` 即可。

## 📄 License

MIT
