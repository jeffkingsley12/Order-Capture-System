'use strict';

/**
 * server.js
 * Express API — thin HTTP layer over parser + db.
 *
 * Routes:
 *  POST   /api/orders           Parse a raw message and store it
 *  GET    /api/orders           List orders (filterable by status)
 *  GET    /api/orders/:id       Get a single order
 *  PATCH  /api/orders/:id/confirm  Confirm (with optional field overrides)
 *  PATCH  /api/orders/:id/reject   Reject
 *  GET    /api/metrics          Parser performance metrics
 *  GET    /health               Uptime check
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { parseOrder } = require('./parser');
const { createDb, insertOrder, getOrder, listOrders, countOrders,
        confirmOrder, rejectOrder, getMetrics } = require('./db');
const { startSyncJob, stopSyncJob } = require('./sheets');

// ─── Bootstrap ───────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT, 10) || 3001;
const DB_PATH = process.env.DB_PATH || './data/orders.db';

const db = createDb(DB_PATH);
const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use(cors());
app.use(express.json({ limit: '16kb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Optional API key gate
app.use((req, res, next) => {
  const requiredKey = process.env.API_KEY;
  if (!requiredKey) return next();

  const provided = req.headers['x-api-key'] ?? req.query.api_key;
  if (provided !== requiredKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// Rate limiting — protect the parse endpoint
const parseLimiter = rateLimit({
  windowMs: 60 * 1000,   // 1 minute
  max: 60,               // 60 parse requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down' },
});

// ─── Routes ───────────────────────────────────────────────────────────────────

// ── Health ──
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

// ── Parse + store a raw message ──
app.post('/api/orders', parseLimiter, (req, res) => {
  const { message } = req.body;

  if (typeof message !== 'string') {
    return res.status(400).json({ error: 'Body must include a "message" string field' });
  }

  let parsed;
  try {
    parsed = parseOrder(message);
  } catch (err) {
    return res.status(422).json({
      error: 'Parse failed',
      reason: err.message,
    });
  }

  const result = insertOrder(db, parsed);

  if (result.duplicate) {
    return res.status(200).json({
      duplicate: true,
      message: 'Exact duplicate — original record returned',
      order: formatOrder(result.order),
    });
  }

  const status = result.order.needs_review ? 207 : 201; // 207 = partial success
  return res.status(status).json({
    duplicate: false,
    semantic_duplicate: result.semantic_duplicate ?? false,
    semantic_match_id: result.semantic_match_id ?? null,
    order: formatOrder(result.order),
  });
});

// ── List orders ──
app.get('/api/orders', (req, res) => {
  const { status, limit = '50', offset = '0' } = req.query;

  const VALID_STATUSES = ['parsed', 'needs_review', 'confirmed', 'rejected'];
  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({
      error: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
    });
  }

  const lim = clamp(parseInt(limit, 10) || 50, 1, 200);
  const off = Math.max(0, parseInt(offset, 10) || 0);

  const orders = listOrders(db, { status, limit: lim, offset: off });
  const total = countOrders(db, { status });

  return res.json({
    total,
    limit: lim,
    offset: off,
    orders: orders.map(formatOrder),
  });
});

// ── Get single order ──
app.get('/api/orders/:id', (req, res) => {
  const order = getOrder(db, req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  return res.json(formatOrder(order));
});

// ── Confirm ──
app.patch('/api/orders/:id/confirm', (req, res) => {
  const order = getOrder(db, req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  if (order.status === 'rejected') {
    return res.status(409).json({ error: 'Cannot confirm a rejected order' });
  }

  // Optional field overrides from the human reviewer
  const { name, item, quantity } = req.body;

  if (quantity !== undefined && (!Number.isInteger(quantity) || quantity < 1)) {
    return res.status(400).json({ error: 'quantity must be a positive integer' });
  }

  const updated = confirmOrder(db, req.params.id, { name, item, quantity });
  return res.json(formatOrder(updated));
});

// ── Reject ──
app.patch('/api/orders/:id/reject', (req, res) => {
  const order = getOrder(db, req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const updated = rejectOrder(db, req.params.id);
  return res.json(formatOrder(updated));
});

// ── Metrics ──
app.get('/api/metrics', (req, res) => {
  return res.json(getMetrics(db));
});

// ─── Error handler ────────────────────────────────────────────────────────────

app.use((err, _req, res, _next) => {
  console.error('[server] unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    item: row.item,
    quantity: row.quantity,
    status: row.status,
    needs_review: !!row.needs_review,
    review_flags: row.review_flags ? JSON.parse(row.review_flags) : {},
    raw_input: row.raw_input,
    sheets_synced: !!row.sheets_synced,
    confirmed_at: row.confirmed_at ?? null,
    rejected_at: row.rejected_at ?? null,
    created_at: row.created_at,
  };
}

function clamp(n, min, max) {
  return Math.min(Math.max(n, min), max);
}

// ─── Start ────────────────────────────────────────────────────────────────────

const server = app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
  startSyncJob(db).catch(err =>
    console.error('[server] sheets sync startup error:', err.message),
  );
});

// ─── Graceful shutdown ────────────────────────────────────────────────────────

function shutdown(signal) {
  console.log(`\n[server] received ${signal} — shutting down gracefully`);
  stopSyncJob();
  server.close(() => {
    db.close();
    console.log('[server] closed');
    process.exit(0);
  });

  // Force exit if still running after 8 s
  setTimeout(() => {
    console.error('[server] force exit after timeout');
    process.exit(1);
  }, 8_000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = { app }; // exported for integration tests
