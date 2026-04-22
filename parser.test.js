'use strict';

/**
 * parser.test.js
 * Run with: node src/parser.test.js
 * No test framework dependency — pure Node.js assertions.
 */

const assert = require('assert');
const { parseOrder } = require('./parser');

let passed = 0;
let failed = 0;

function test(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${label}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

// ─── Core message formats ─────────────────────────────────────────────────────

console.log('\n── Core WhatsApp formats ──');

test('"John: 2 pizzas"', () => {
  const r = parseOrder('John: 2 pizzas');
  assert.strictEqual(r.name, 'John');
  assert.ok(r.item.includes('pizza'));
  assert.strictEqual(r.quantity, 2);
  assert.strictEqual(r.needs_review, false);
});

test('"Order – Mary, 3 sodas"', () => {
  const r = parseOrder('Order – Mary, 3 sodas');
  assert.strictEqual(r.name, 'Mary');
  assert.ok(r.item.includes('soda'));
  assert.strictEqual(r.quantity, 3);
});

test('"I need 5 chapati – James" (en-dash)', () => {
  const r = parseOrder('I need 5 chapati \u2013 James');
  assert.strictEqual(r.name, 'James');
  assert.ok(r.item.includes('chapati'));
  assert.strictEqual(r.quantity, 5);
});

test('"Peter wants 10 eggs"', () => {
  const r = parseOrder('Peter wants 10 eggs');
  assert.strictEqual(r.name, 'Peter');
  assert.ok(r.item.includes('egg'));
  assert.strictEqual(r.quantity, 10);
});

// ─── Name extraction ──────────────────────────────────────────────────────────

console.log('\n── Name extraction ──');

test('Blocklisted word "order" is not captured as name', () => {
  const r = parseOrder('Order: 3 samosas');
  assert.strictEqual(r.name, 'Unknown');
  assert.strictEqual(r.needs_review, true);
});

test('"from Mary" pattern', () => {
  const r = parseOrder('5 burgers from Mary');
  assert.strictEqual(r.name, 'Mary');
});

test('"Sarah needs 4 rolls" pattern', () => {
  const r = parseOrder('Sarah needs 4 rolls');
  assert.strictEqual(r.name, 'Sarah');
  assert.strictEqual(r.quantity, 4);
});

// ─── Quantity extraction ──────────────────────────────────────────────────────

console.log('\n── Quantity extraction ──');

test('No number → quantity defaults to 1, explicit=false', () => {
  const r = parseOrder('John: pizza');
  assert.strictEqual(r.quantity, 1);
  assert.strictEqual(r.review_flags.quantityDefault, true);
});

test('Large number (>10000) rejected as quantity, defaults to 1', () => {
  const r = parseOrder('John: 99999 pizzas');
  assert.strictEqual(r.quantity, 1);
});

test('Alphanumeric like "7UP" does not trip quantity extractor', () => {
  const r = parseOrder('Alice: 2 7UP');
  assert.strictEqual(r.quantity, 2);   // should pick 2, not 7
});

// ─── Item extraction ──────────────────────────────────────────────────────────

console.log('\n── Item extraction ──');

test('Name does not appear in item', () => {
  const r = parseOrder('John: 2 pizzas');
  assert.ok(!r.item.toLowerCase().includes('john'), `item contains name: "${r.item}"`);
});

test('Quantity number does not appear in item', () => {
  const r = parseOrder('Mary: 3 sodas');
  assert.ok(!r.item.includes('3'), `item contains quantity: "${r.item}"`);
});

test('Noise words stripped from item', () => {
  const r = parseOrder('I would like 2 chapati please – Alice');
  assert.ok(!r.item.toLowerCase().includes('would'), `"would" in item: "${r.item}"`);
  assert.ok(!r.item.toLowerCase().includes('please'), `"please" in item: "${r.item}"`);
});

// ─── Deduplication ───────────────────────────────────────────────────────────

console.log('\n── Deduplication ──');

test('Same message → same raw_key', () => {
  const a = parseOrder('John: 2 pizzas');
  const b = parseOrder('John: 2 pizzas');
  assert.strictEqual(a.raw_key, b.raw_key);
});

test('Different phrasing, same meaning → different raw_key, same semantic_key', () => {
  const a = parseOrder('John: 2 pizzas');
  const b = parseOrder('2 pizzas – John');
  assert.notStrictEqual(a.raw_key, b.raw_key);
  assert.strictEqual(a.semantic_key, b.semantic_key);
});

// ─── Review flags ────────────────────────────────────────────────────────────

console.log('\n── Review flags ──');

test('Unknown name → needs_review=true', () => {
  const r = parseOrder('2 sodas please');
  assert.strictEqual(r.needs_review, true);
  assert.strictEqual(r.review_flags.nameUnknown, true);
});

test('No item → needs_review=true', () => {
  const r = parseOrder('John: 5');
  assert.strictEqual(r.needs_review, true);
  assert.strictEqual(r.review_flags.itemEmpty, true);
});

test('Clean order → needs_review=false, status="parsed"', () => {
  const r = parseOrder('Alice: 3 chapati');
  assert.strictEqual(r.needs_review, false);
  assert.strictEqual(r.status, 'parsed');
});

// ─── Input guards ────────────────────────────────────────────────────────────

console.log('\n── Input guards ──');

test('Empty string throws', () => {
  assert.throws(() => parseOrder(''), /empty/i);
});

test('null throws', () => {
  assert.throws(() => parseOrder(null), /non-null/i);
});

test('Oversized input throws', () => {
  assert.throws(() => parseOrder('x'.repeat(501)), /too long/i);
});

test('raw_input preserved exactly', () => {
  const raw = '  John: 2 pizzas  ';
  const r = parseOrder(raw);
  assert.strictEqual(r.raw_input, raw.trim());
});

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(40)}`);
console.log(`  ${passed} passed  /  ${failed} failed  /  ${passed + failed} total`);
console.log(`${'─'.repeat(40)}\n`);

if (failed > 0) process.exit(1);
