import { DatabaseSync } from 'node:sqlite';
import { config, ensureDataDir } from './config.js';

const SCHEMA_VERSION = 1;

export function nowIso() {
  return new Date().toISOString();
}

export function openDatabase(file = config.dbPath) {
  ensureDataDir();
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');
  migrate(db);
  return db;
}

export function migrate(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        login         TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        name          TEXT NOT NULL DEFAULT 'Администратор',
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token TEXT NOT NULL,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip         TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

      CREATE TABLE IF NOT EXISTS projects (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT NOT NULL,
        address           TEXT,
        total_area        TEXT,
        description       TEXT,
        public_token      TEXT UNIQUE,
        public_enabled    INTEGER NOT NULL DEFAULT 0,
        public_created_at TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_created ON projects(created_at DESC);

      CREATE TABLE IF NOT EXISTS rooms (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        area        TEXT,
        description TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_rooms_project ON rooms(project_id, sort_order, id);

      CREATE TABLE IF NOT EXISTS work_catalog (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        name          TEXT NOT NULL,
        category      TEXT,
        unit          TEXT NOT NULL DEFAULT 'м²',
        price_kopecks INTEGER NOT NULL DEFAULT 0,
        description   TEXT,
        is_active     INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_work_catalog_name ON work_catalog(name);
      CREATE INDEX IF NOT EXISTS idx_work_catalog_category ON work_catalog(category);

      CREATE TABLE IF NOT EXISTS material_catalog (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        name              TEXT NOT NULL,
        category          TEXT,
        purchase_unit     TEXT NOT NULL DEFAULT 'шт.',
        package_size      TEXT,
        consumption_unit  TEXT,
        consumption_rate  TEXT,
        price_kopecks     INTEGER NOT NULL DEFAULT 0,
        description       TEXT,
        is_active         INTEGER NOT NULL DEFAULT 1,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_material_catalog_name ON material_catalog(name);
      CREATE INDEX IF NOT EXISTS idx_material_catalog_category ON material_catalog(category);

      CREATE TABLE IF NOT EXISTS estimate_lines (
        id                INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id           INTEGER NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
        kind              TEXT NOT NULL CHECK (kind IN ('work', 'material')),
        source_item_id    INTEGER,
        name              TEXT NOT NULL,
        category          TEXT,
        unit              TEXT NOT NULL,
        price_kopecks     INTEGER NOT NULL DEFAULT 0,
        quantity          TEXT NOT NULL,
        amount_kopecks    INTEGER NOT NULL DEFAULT 0,
        sort_order        INTEGER NOT NULL DEFAULT 0,
        purchase_unit     TEXT,
        package_size      TEXT,
        consumption_unit  TEXT,
        consumption_rate  TEXT,
        calc_area         TEXT,
        calc_mode         TEXT CHECK (calc_mode IN ('auto', 'manual')),
        description       TEXT,
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_lines_room ON estimate_lines(room_id, kind, sort_order, id);

      CREATE TABLE IF NOT EXISTS app_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        login      TEXT,
        action     TEXT NOT NULL,
        entity     TEXT,
        entity_id  INTEGER,
        details    TEXT,
        ip         TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);
    `);
    db.exec('PRAGMA user_version = 1');
  }
}

export function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      /* ignore */
    }
    throw error;
  }
}

export function audit(db, { userId = null, login = null, action, entity = null, entityId = null, details = null, ip = null }) {
  db.prepare(
    `INSERT INTO audit_log (user_id, login, action, entity, entity_id, details, ip, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(userId, login, action, entity, entityId, details ? JSON.stringify(details) : null, ip, nowIso());
}
