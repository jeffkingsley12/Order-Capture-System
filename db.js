'use strict';

/**
 * db.js
 * Single source of truth: SQLite via better-sqlite3 (synchronous API).
 *
 * Design rules:
 *  - All writes go through prepared statements (SQL injection prevention).
 *  - WAL mode enabled for concurrent reads during writes.
 *  - Every schema change is a numbered migration — never edit previous ones.
 *  - parse_events is the observability log; orders is the canonical record.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');

// ─── Setup ───────────────────────────────────────────────────────────────────

function createDb(dbPath) {
  const resolved = path.resolve(dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });

  const db = new Database(resolved);

  // Performance + concurrency settings
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');     // wait up to 5 s if locked
  db.pragma('synchronous = NORMAL');    // safe with WAL

  runMigrations(db);

  return db;
}

// ─── Migrations ───────────────────────────────────────────────────────────────

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS orders (
        id            TEXT PRIMARY KEY,          -- UUID
        name          TEXT NOT NULL DEFAULT 'Unknown',
        item          TEXT NOT NULL DEFAULT '',
        quantity      INTEGER NOT NULL DEFAULT 1 CHECK(quantity > 0),
        status        TEXT NOT NULL DEFAULT 'parsed'
                        CHECK(status IN ('parsed', 'needs_review', 'confirmed', 'rejected')),
        needs_review  INTEGER NOT NULL DEFAULT 0,
        review_flags  TEXT,                      -- JSON blob
        raw_key       TEXT NOT NULL,             -- sha256 of normalized raw input
        semantic_key  TEXT NOT NULL,             -- sha256 of name|item|qty
        raw_input     TEXT NOT NULL,
        sheets_synced INTEGER NOT NULL DEFAULT 0,
        sheets_row    INTEGER,                   -- row number in Google Sheet
        confirmed_at  TEXT,
        rejected_at   TEXT,
        created_at    TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_raw_key    ON orders(raw_key);
      CREATE        INDEX IF NOT EXISTS idx_orders_status     ON orders(status);
      CREATE        INDEX IF NOT EXISTS idx_orders_created_at ON orders(created_at);
      CREATE        INDEX IF NOT EXISTS idx_orders_semantic   ON orders(semantic_key, created_at);

      CREATE TABLE IF NOT EXISTS parse_events (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id    TEXT REFERENCES orders(id) ON DELETE CASCADE,
        raw_input   TEXT NOT NULL,
        status      TEXT NOT NULL,   -- 'parsed' | 'needs_review' | 'failed' | 'duplicate'
        error       TEXT,            -- populated on 'failed'
        created_at  TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_events_created_at ON parse_events(created_at);
      CREATE INDEX IF NOT EXISTS idx_events_status     ON parse_events(status);

      CREATE TABLE IF NOT EXISTS failed_syncs (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
        error       TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        resolved    INTEGER NOT NULL DEFAULT 0,
        created_at  TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        applied_at  TEXT NOT NULL
      );
    `,
  },
];

function runMigrations(db) {
  // Ensure migrations table exists before querying it
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version),
  );

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue;

    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString());
    });

    run();
    console.log(`[db] migration ${migration.version} applied`);
  }
}

// ─── Orders ───────────────────────────────────────────────────────────────────

/**
 * Insert a parsed order. Returns the inserted record or a duplicate signal.
 *
 * @param {object} db
 * @param {object} parsed - Output of parseOrder()
 * @returns {{ inserted: boolean, order: object, duplicate: boolean }}
 */
function insertOrder(db, parsed) {
  const now = new Date().toISOString();

  // Check raw_key uniqueness (exact duplicate message)
  const existing = db
    .prepare('SELECT * FROM orders WHERE raw_key = ?')
    .get(parsed.raw_key);

  if (existing) {
    logEvent(db, {
      order_id: existing.id,
      raw_input: parsed.raw_input,
      status: 'duplicate',
      created_at: now,
    });
    return { inserted: false, duplicate: true, order: existing };
  }

  // Check semantic_key within 10-minute window (rephrased duplicate)
  const windowStart = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const semantic = db
    .prepare(`
      SELECT * FROM orders
      WHERE semantic_key = ? AND created_at >= ?
      ORDER BY created_at DESC LIMIT 1
    `)
    .get(parsed.semantic_key, windowStart);

  const id = uuidv4();

  const insertStmt = db.prepare(`
    INSERT INTO orders (
      id, name, item, quantity, status, needs_review, review_flags,
      raw_key, semantic_key, raw_input, created_at
    ) VALUES (
      @id, @name, @item, @quantity, @status, @needs_review, @review_flags,
      @raw_key, @semantic_key, @raw_input, @created_at
    )
  `);

  const insert = db.transaction(() => {
    insertStmt.run({
      id,
      name: parsed.name,
      item: parsed.item,
      quantity: parsed.quantity,
      status: parsed.status,
      needs_review: parsed.needs_review ? 1 : 0,
      review_flags: JSON.stringify(parsed.review_flags),
      raw_key: parsed.raw_key,
      semantic_key: parsed.semantic_key,
      raw_input: parsed.raw_input,
      created_at: now,
    });

    logEvent(db, {
      order_id: id,
      raw_input: parsed.raw_input,
      status: parsed.status,
      created_at: now,
    });
  });

  insert();

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);

  return {
    inserted: true,
    duplicate: false,
    semantic_duplicate: !!semantic,
    semantic_match_id: semantic?.id ?? null,
    order,
  };
}

function getOrder(db, id) {
  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id) ?? null;
}

function listOrders(db, { status, limit = 50, offset = 0 } = {}) {
  if (status) {
    return db
      .prepare('SELECT * FROM orders WHERE status = ? ORDER BY created_at DESC LIMIT ? OFFSET ?')
      .all(status, limit, offset);
  }
  return db
    .prepare('SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?')
    .all(limit, offset);
}

function countOrders(db, { status } = {}) {
  if (status) {
    return db.prepare('SELECT COUNT(*) as n FROM orders WHERE status = ?').get(status).n;
  }
  return db.prepare('SELECT COUNT(*) as n FROM orders').get().n;
}

/**
 * Confirm a needs_review order (human accepted the parsed data).
 */
function confirmOrder(db, id, overrides = {}) {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    UPDATE orders
    SET status       = 'confirmed',
        needs_review = 0,
        name         = COALESCE(@name, name),
        item         = COALESCE(@item, item),
        quantity     = COALESCE(@quantity, quantity),
        confirmed_at = @confirmed_at
    WHERE id = @id AND status != 'rejected'
  `);

  const result = db.transaction(() => {
    stmt.run({
      id,
      name: overrides.name ?? null,
      item: overrides.item ?? null,
      quantity: overrides.quantity ?? null,
      confirmed_at: now,
    });
    logEvent(db, { order_id: id, raw_input: '', status: 'confirmed', created_at: now });
  });

  result();

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

/**
 * Reject an order (human dismissed it).
 */
function rejectOrder(db, id) {
  const now = new Date().toISOString();
  db.prepare(`
    UPDATE orders SET status = 'rejected', rejected_at = ? WHERE id = ?
  `).run(now, id);

  return db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
}

/**
 * Mark an order as synced to Google Sheets with the assigned row number.
 */
function markSheetsSync(db, id, sheetsRow) {
  db.prepare(`
    UPDATE orders SET sheets_synced = 1, sheets_row = ? WHERE id = ?
  `).run(sheetsRow, id);
}

/**
 * All confirmed orders not yet synced to Sheets.
 */
function getPendingSyncs(db) {
  return db
    .prepare(`
      SELECT * FROM orders
      WHERE sheets_synced = 0
        AND status = 'confirmed'
      ORDER BY created_at ASC
    `)
    .all();
}

function logFailedSync(db, orderId, error) {
  db.prepare(`
    INSERT INTO failed_syncs (order_id, error, created_at)
    VALUES (?, ?, ?)
  `).run(orderId, String(error), new Date().toISOString());
}

// ─── Observability ───────────────────────────────────────────────────────────

function logEvent(db, { order_id, raw_input, status, error, created_at }) {
  db.prepare(`
    INSERT INTO parse_events (order_id, raw_input, status, error, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(order_id ?? null, raw_input, status, error ?? null, created_at);
}

/**
 * Parser performance metrics for the dashboard.
 */
function getMetrics(db) {
  const totals = db.prepare(`
    SELECT
      COUNT(*)                                   AS total,
      SUM(CASE WHEN status = 'confirmed'     THEN 1 ELSE 0 END) AS confirmed,
      SUM(CASE WHEN status = 'needs_review'  THEN 1 ELSE 0 END) AS needs_review,
      SUM(CASE WHEN status = 'rejected'      THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'parsed'        THEN 1 ELSE 0 END) AS parsed
    FROM orders
  `).get();

  const daily = db.prepare(`
    SELECT
      date(created_at)                            AS day,
      COUNT(*)                                    AS total,
      SUM(CASE WHEN needs_review = 0 THEN 1 ELSE 0 END) AS clean,
      SUM(CASE WHEN needs_review = 1 THEN 1 ELSE 0 END) AS review
    FROM orders
    GROUP BY date(created_at)
    ORDER BY day DESC
    LIMIT 14
  `).all();

  const duplicates = db.prepare(`
    SELECT COUNT(*) AS n FROM parse_events WHERE status = 'duplicate'
  `).get().n;

  return { totals, daily, duplicates };
}

// ─── CLI: run migrations directly ────────────────────────────────────────────

if (require.main === module) {
  const dbPath = process.env.DB_PATH || './data/orders.db';
  createDb(dbPath);
  console.log('[db] migrations complete');
}

module.exports = {
  createDb,
  insertOrder,
  getOrder,
  listOrders,
  countOrders,
  confirmOrder,
  rejectOrder,
  markSheetsSync,
  getPendingSyncs,
  logFailedSync,
  logEvent,
  getMetrics,
};
