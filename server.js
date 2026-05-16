const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const pkg = require('./package.json');
const APP_VERSION = pkg.version;
const APP_DISPLAY_VERSION = APP_VERSION.replace(/\.0$/, '');

// Initialize database
const { getDb } = require('./db/init');
getDb();

const app = express();
app.set('trust proxy', 1);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Session with SQLite store
const SQLiteStore = require('connect-sqlite3')(session);
app.use(session({
  store: new SQLiteStore({
    db: 'sessions.sqlite',
    dir: config.DATA_DIR,
  }),
  secret: config.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    httpOnly: true,
    secure: true, /* behind HTTPS reverse proxy */
    sameSite: 'lax',
  },
}));

// Serve index.html with version injection (before static middleware)
const indexPath = path.join(__dirname, 'public', 'index.html');
function serveIndex(req, res) {
  let html = fs.readFileSync(indexPath, 'utf-8');
  html = html.replace(/__APP_DISPLAY_VERSION__/g, APP_DISPLAY_VERSION);
  html = html.replace(/__APP_VERSION__/g, APP_VERSION);
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Content-Type', 'text/html');
  res.send(html);
}
app.get('/', serveIndex);

// Static files (JS/CSS/HTML all no-cache during development)
app.use(express.static(path.join(__dirname, 'public'), {
  index: false,
  setHeaders(res, filePath) {
    // 所有文件都不缓存，确保更新即时生效
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
}));

// Version API
app.get('/api/version', (req, res) => res.json({ version: APP_VERSION }));

// Routes
app.use('/auth', require('./routes/auth')(express.Router()));
app.use('/api/keys', require('./routes/api-keys')(express.Router()));
app.use('/api/generate', require('./routes/generate')(express.Router()));
app.use('/api/cards', require('./routes/cards')(express.Router()));
app.use('/api/agent', require('./routes/agent')(express.Router()));

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/auth/')) {
    serveIndex(req, res);
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: '服务器内部错误' });
});

const HOST = process.env.HOST || '127.0.0.1';
app.listen(config.PORT, HOST, () => {
  console.log(`🎴 欢欢卡站已启动: http://${HOST}:${config.PORT}`);
});
