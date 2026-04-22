<<<<<<< HEAD
# Order-Capture-System
Smart order capture system that converts unstructured messages into structured data (Name, Item, Quantity) and stores them reliably.
=======
# Order Capture System

WhatsApp/SMS message → structured order → SQLite + Google Sheets.

```
Raw message → Parser → Validation + Dedup → SQLite (truth) → Sheets (view)
```

---

## Quick Start

```bash
cp .env.example .env        # fill in your values
npm install
npm run migrate             # create DB + run schema migrations
npm start                   # http://localhost:3001
```

Open `dashboard.jsx` in your React project for the UI.

---

## Project Structure

```
src/
  parser.js        Core extractor — Name, Item, Quantity from free text
  parser.test.js   22 unit tests (no test framework dependency)
  db.js            SQLite layer — schema, migrations, all queries
  sheets.js        Background sync job — SQLite confirmed → Sheets
  server.js        Express API — HTTP thin layer over parser + db
.env.example       All environment variables documented
```

---

## API Reference

### POST /api/orders
Parse a raw message and store it.

```json
{ "message": "John: 2 pizzas" }
```

Response `201` (clean) or `207` (needs review):
```json
{
  "duplicate": false,
  "order": {
    "id": "uuid",
    "name": "John",
    "item": "pizzas",
    "quantity": 2,
    "status": "parsed",
    "needs_review": false,
    "review_flags": { "nameUnknown": false, "itemEmpty": false, "quantityDefault": false },
    "raw_input": "John: 2 pizzas",
    "created_at": "2026-04-22T08:00:00Z"
  }
}
```

Response `200` (exact duplicate):
```json
{ "duplicate": true, "message": "Exact duplicate — original record returned", "order": {...} }
```

### GET /api/orders?status=needs_review&limit=50&offset=0
List orders. `status` filter: `parsed | needs_review | confirmed | rejected`.

### GET /api/orders/:id
Single order by UUID.

### PATCH /api/orders/:id/confirm
Confirm a reviewed order. Optional body to override parsed fields:
```json
{ "name": "John", "item": "pizza", "quantity": 2 }
```

### PATCH /api/orders/:id/reject
Mark order as rejected (void).

### GET /api/metrics
Parser performance stats + daily volume.

### GET /health
Uptime check: `{ "status": "ok" }`.

---

## Parser — Supported Message Formats

| Input | Name | Item | Qty |
|---|---|---|---|
| `John: 2 pizzas` | John | pizzas | 2 |
| `Order – Mary, 3 sodas` | Mary | sodas | 3 |
| `I need 5 chapati – James` | James | chapati | 5 |
| `Peter wants 10 eggs` | Peter | eggs | 10 |
| `5 burgers from Alice` | Alice | burgers | 5 |
| `Sarah needs 4 rolls` | Sarah | rolls | 4 |

Orders with unknown name or empty item get `needs_review: true` and appear in the review queue.

---

## Google Sheets Setup (Optional)

1. Create a Google Cloud project → enable Sheets API
2. Create a service account → download JSON key
3. Share your spreadsheet with the service account email (Editor)
4. Set env vars:
   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL=...
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   GOOGLE_SHEET_ID=your_spreadsheet_id
   ```

Sheets is the **view layer only** — SQLite is always the source of truth.  
The sync job runs every 30 seconds (configurable via `SHEETS_SYNC_INTERVAL_MS`).  
Failed syncs are logged to `failed_syncs` table — no data is ever silently lost.

---

## Architecture Decisions

**Why SQLite not JSON?**  
Atomic writes, WAL mode for concurrent reads, UNIQUE indexes for dedup, zero ops overhead.

**Two dedup keys — why?**  
`raw_key`: prevents the same message from being stored twice (exact retry).  
`semantic_key`: flags `"John: 2 pizzas"` vs `"2 pizzas – John"` as likely the same order within 10 minutes.

**Why is Sheets a background job, not inline?**  
HTTP request time must not depend on Sheets API latency (~200–800ms). Orders are written to SQLite synchronously, then synced asynchronously. Sheets outage = zero order loss.

**Status flow:**
```
needs_review → confirmed (human accepted)
needs_review → rejected  (human dismissed)
parsed       → confirmed (auto-clean orders, one-click confirm)
```

---

## Running Tests

```bash
node src/parser.test.js
```

22 tests, no dependencies, covers all message formats + edge cases.
>>>>>>> 62a21f6 (Initial commit)
