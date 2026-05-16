const Database = require('better-sqlite3');
const config = require('../config');
const fs = require('fs');
const path = require('path');

// Ensure data directory exists
fs.mkdirSync(config.DATA_DIR, { recursive: true });
fs.mkdirSync(config.CARDS_DIR, { recursive: true });

let db;

function getDb() {
  if (!db) {
    db = new Database(config.DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    initTables();
  }
  return db;
}

function initTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      discord_id TEXT UNIQUE NOT NULL,
      username TEXT NOT NULL,
      avatar TEXT,
      global_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      label TEXT DEFAULT '',
      api_key_encrypted TEXT NOT NULL,
      base_url TEXT DEFAULT '',
      model TEXT DEFAULT '',
      extra_config TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      character_data TEXT DEFAULT '{}',
      cover_image_path TEXT DEFAULT '',
      card_file_path TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
    CREATE INDEX IF NOT EXISTS idx_cards_user ON cards(user_id);
  `);

  // 增量迁移：添加 format 列
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN format TEXT DEFAULT 'png'`);
  } catch (e) {
    // 列已存在，忽略
  }

  // 增量迁移：添加 version 列
  try {
    db.exec(`ALTER TABLE cards ADD COLUMN version INTEGER DEFAULT 1`);
  } catch (e) {
    // 列已存在，忽略
  }
}

module.exports = { getDb };
