'use strict';

/**
 * parser.js
 * Unstructured text → structured order record.
 *
 * Design rules:
 *  1. extractName runs first — its output feeds extractItem.
 *  2. extractQuantity runs second — its output (value + explicit flag) feeds extractItem.
 *  3. extractItem strips name + quantity only when they were confidently found.
 *  4. Every function is pure — no side effects, no global state.
 */

const crypto = require('crypto');

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_INPUT_LENGTH = 500;

/** Words that look like names in patterns but are never real customer names. */
const NAME_BLOCKLIST = new Set([
  'order', 'orders', 'from', 'by', 'request', 'need', 'want',
  'wants', 'needs', 'please', 'hello', 'hi', 'hey', 'dear',
  'good', 'morning', 'evening', 'afternoon', 'i', 'a', 'an',
  'the', 'for', 'me', 'my', 'our',
]);

/** Filler words stripped from the item field. */
const NOISE_WORDS = [
  'from', 'by', 'order', 'orders', 'for', 'please',
  'want', 'wants', 'need', 'needs', 'i', 'a', 'an', 'the',
  'would', 'like', 'get', 'have', 'some', 'just',
];

// ─── Step 1: Normalize ───────────────────────────────────────────────────────

/**
 * Canonical form used by all extractors.
 * - Unicode dashes → ASCII dash
 * - Newlines / commas → space
 * - Collapse whitespace
 */
function normalize(text) {
  return text
    .replace(/[\u2013\u2014\u2212]/g, '-') // en-dash, em-dash, minus sign
    .replace(/[\n\r,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Step 2: Extract Name ────────────────────────────────────────────────────

/**
 * Returns { value: string, confidence: 'high'|'low' }.
 * 'high' = pattern matched and not blocklisted.
 * 'low'  = fell back to 'Unknown'.
 */
function extractName(text) {
  const patterns = [
    /^([a-z]+)\s*:/i,                      // "John: 2 pizzas"         — leading name:
    /\bfrom\s+([a-z]{2,})\b/i,             // "order from Mary"
    /\bby\s+([a-z]{2,})\b/i,              // "by James"
    /-+\s*([a-z]{2,})\s*$/i,              // "5 chapati – James"       — trailing after dash
    /^[a-z]+\s*-+\s*([a-z]{2,})\b/i,     // "Order – Mary, 3 sodas"  — separator after keyword
    /([a-z]{2,})\s+wants?\b/i,            // "Peter wants 10 eggs"
    /([a-z]{2,})\s+needs?\b/i,            // "Sarah needs 4 rolls"
    /([a-z]{2,})\s+ordered?\b/i,          // "Mike ordered 2 burgers"
  ];

  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (m) {
      const candidate = m[1].toLowerCase();
      if (!NAME_BLOCKLIST.has(candidate) && candidate.length >= 2) {
        return { value: capitalize(candidate), confidence: 'high' };
      }
    }
  }

  return { value: 'Unknown', confidence: 'low' };
}

// ─── Step 3: Extract Quantity ─────────────────────────────────────────────────

/**
 * Returns { value: number, explicit: boolean }.
 * explicit = false means the default 1 was used — callers must not strip '1'
 * from the item text when explicit is false.
 */
function extractQuantity(text) {
  // Match all standalone integers (not part of larger numbers like "7UP")
  const matches = [...text.matchAll(/(?<![a-z])\b(\d+)\b(?![a-z])/gi)];
  if (!matches.length) return { value: 1, explicit: false };

  // Prefer the LAST number — quantities tend to trail in natural language.
  // If only one number, use it regardless.
  const raw = parseInt(matches[matches.length - 1][1], 10);

  // Sanity guard: quantities above 10 000 are almost certainly not order quantities
  if (raw > 10_000) return { value: 1, explicit: false };

  return { value: raw, explicit: true };
}

// ─── Step 4: Extract Item ────────────────────────────────────────────────────

/**
 * Strips everything that isn't the food/product name.
 * Depends on name + quantity results so they aren't left as residue.
 */
function extractItem(text, name, quantityResult) {
  let working = text;

  // Remove name (case-insensitive whole-word)
  if (name.confidence === 'high') {
    const escaped = escapeRegex(name.value);
    working = working.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }

  // Remove quantity number only when it was explicitly found
  if (quantityResult.explicit) {
    working = working.replace(
      new RegExp(`(?<![a-z])\\b${quantityResult.value}\\b(?![a-z])`, 'gi'),
      '',
    );
  }

  // Remove noise words (whole-word, case-insensitive)
  const noisePattern = new RegExp(
    `\\b(${NOISE_WORDS.map(escapeRegex).join('|')})\\b`,
    'gi',
  );
  working = working.replace(noisePattern, '');

  // Remove separators: dashes, colons
  working = working.replace(/[\u2013\u2014:\-]/g, '');

  // Collapse and trim
  working = working.replace(/\s+/g, ' ').trim();

  return working;
}

// ─── Step 5: Assemble ────────────────────────────────────────────────────────

/**
 * Parses a raw customer message into a structured order record.
 *
 * @param {string} raw - The original, unmodified message text.
 * @returns {object} Structured order with status, dedup keys, and review flag.
 * @throws {Error} If input is invalid or too long.
 */
function parseOrder(raw) {
  // ── Input guards ──
  if (raw === null || raw === undefined) throw new Error('Input must be a non-null string');
  if (typeof raw !== 'string') throw new Error(`Input must be a string, got ${typeof raw}`);

  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error('Input must not be empty');
  if (trimmed.length > MAX_INPUT_LENGTH) {
    throw new Error(`Input too long: ${trimmed.length} chars (max ${MAX_INPUT_LENGTH})`);
  }

  // ── Extraction (order matters) ──
  const text = normalize(trimmed);
  const name = extractName(text);
  const quantityResult = extractQuantity(text);
  const item = extractItem(text, name, quantityResult);

  // ── Confidence scoring ──
  const flags = {
    nameUnknown: name.confidence === 'low',
    itemEmpty: item.length < 2,
    quantityDefault: !quantityResult.explicit,
  };
  const needsReview = flags.nameUnknown || flags.itemEmpty;

  // ── Dedup keys ──
  // rawKey: catches exact retries (same message sent twice)
  const rawKey = sha256(trimmed.toLowerCase());
  // semanticKey: catches rephrased duplicates within a time window
  const semanticKey = sha256(
    `${name.value.toLowerCase()}|${item.toLowerCase()}|${quantityResult.value}`,
  );

  return {
    name: name.value,
    item,
    quantity: quantityResult.value,
    status: needsReview ? 'needs_review' : 'parsed',
    needs_review: needsReview,
    review_flags: flags,
    raw_key: rawKey,
    semantic_key: semanticKey,
    raw_input: trimmed,
    created_at: new Date().toISOString(),
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  parseOrder,
  normalize,
  extractName,
  extractQuantity,
  extractItem,
};
