'use strict';

/**
 * sheets.js
 * Background job: confirmed SQLite orders → Google Sheets (view layer only).
 *
 * Design rules:
 *  - Sheets is NEVER the source of truth. SQLite is.
 *  - Writes are retried with exponential backoff.
 *  - Failed writes go to failed_syncs table (dead-letter queue).
 *  - Sync loop is independent of the HTTP request path.
 *  - If GOOGLE_SHEET_ID is not configured, this module is a no-op.
 */

const { google } = require('googleapis');
const { getPendingSyncs, markSheetsSync, logFailedSync } = require('./db');

// ─── Config ───────────────────────────────────────────────────────────────────

const REQUIRED_ENV = [
  'GOOGLE_SERVICE_ACCOUNT_EMAIL',
  'GOOGLE_PRIVATE_KEY',
  'GOOGLE_SHEET_ID',
];

function sheetsEnabled() {
  return REQUIRED_ENV.every(k => !!process.env[k]);
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _sheetsClient = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

// ─── Sheet bootstrap ──────────────────────────────────────────────────────────

/**
 * Ensure the header row exists. Safe to call multiple times.
 */
async function ensureHeader() {
  const sheets = await getSheetsClient();
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Orders';

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetName}!A1:G1`,
  });

  const existingHeader = res.data.values?.[0];
  const expectedHeader = ['ID', 'Name', 'Item', 'Quantity', 'Status', 'Raw Input', 'Created At'];

  if (!existingHeader || existingHeader.join('|') !== expectedHeader.join('|')) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: `${sheetName}!A1`,
      valueInputOption: 'RAW',
      resource: { values: [expectedHeader] },
    });
  }
}

// ─── Write with retry ─────────────────────────────────────────────────────────

/**
 * Append a single row to the sheet with exponential backoff.
 * Returns the 1-based row number written.
 *
 * @param {object[]} rowValues - Flat array of cell values.
 * @param {number}   retries   - Max attempts.
 * @returns {number} Row number in the sheet.
 */
async function appendRowWithRetry(rowValues, retries = 4) {
  const sheets = await getSheetsClient();
  const sheetName = process.env.GOOGLE_SHEET_NAME || 'Orders';

  let lastError;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await sheets.spreadsheets.values.append({
        spreadsheetId: process.env.GOOGLE_SHEET_ID,
        range: `${sheetName}!A1`,
        valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS',
        resource: { values: [rowValues] },
      });

      // Parse the updated range to extract the row number written
      const updatedRange = res.data.updates?.updatedRange ?? '';
      const rowMatch = updatedRange.match(/:([A-Z]+)(\d+)$/);
      return rowMatch ? parseInt(rowMatch[2], 10) : null;
    } catch (err) {
      lastError = err;
      if (attempt < retries - 1) {
        const delay = 300 * Math.pow(2, attempt); // 300, 600, 1200 ms
        await sleep(delay);
      }
    }
  }

  throw lastError;
}

// ─── Sync loop ────────────────────────────────────────────────────────────────

let _syncTimer = null;

/**
 * Push all confirmed, un-synced orders to Google Sheets.
 * Called by the background job on an interval.
 */
async function syncPendingOrders(db) {
  if (!sheetsEnabled()) return;

  const pending = getPendingSyncs(db);
  if (pending.length === 0) return;

  console.log(`[sheets] syncing ${pending.length} order(s)`);

  for (const order of pending) {
    const row = [
      order.id,
      order.name,
      order.item,
      order.quantity,
      order.status,
      order.raw_input,
      order.created_at,
    ];

    try {
      const sheetsRow = await appendRowWithRetry(row);
      markSheetsSync(db, order.id, sheetsRow);
      console.log(`[sheets] synced order ${order.id} → row ${sheetsRow}`);
    } catch (err) {
      console.error(`[sheets] failed to sync order ${order.id}:`, err.message);
      logFailedSync(db, order.id, err.message);
      // Continue — don't let one failure block the rest of the batch
    }
  }
}

/**
 * Start the background sync job.
 * @param {object} db - better-sqlite3 db instance
 * @param {number} intervalMs - How often to run (default: env var or 30s)
 */
async function startSyncJob(db, intervalMs) {
  if (!sheetsEnabled()) {
    console.log('[sheets] not configured — sync disabled');
    return;
  }

  const interval = intervalMs
    ?? parseInt(process.env.SHEETS_SYNC_INTERVAL_MS, 10)
    ?? 30_000;

  try {
    await ensureHeader();
    console.log('[sheets] header verified');
  } catch (err) {
    console.error('[sheets] could not verify header — check credentials:', err.message);
    return;
  }

  // Run immediately on start, then on interval
  await syncPendingOrders(db).catch(err =>
    console.error('[sheets] initial sync error:', err.message),
  );

  _syncTimer = setInterval(async () => {
    await syncPendingOrders(db).catch(err =>
      console.error('[sheets] sync error:', err.message),
    );
  }, interval);

  console.log(`[sheets] sync job started — interval ${interval}ms`);
}

function stopSyncJob() {
  if (_syncTimer) {
    clearInterval(_syncTimer);
    _syncTimer = null;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  startSyncJob,
  stopSyncJob,
  syncPendingOrders,
  sheetsEnabled,
};
