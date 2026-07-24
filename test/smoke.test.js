// Minimal smoke test — pure logic only.
//
// HONEST SCOPE: this covers the handful of functions in app.js that don't
// touch the DOM. It does NOT test rendering, checkout, void/undo, import/
// merge, or the PIN encryption flow — those are all wired directly into
// document.getElementById() calls throughout app.js, so testing them for
// real would mean pulling in a headless browser (Playwright/jsdom) as a
// project dependency, which this static, buildless PWA doesn't have.
//
// This file exists so at least the money-math bug class (the whole reason
// round2() was added) has a standing regression check, instead of relying
// on someone remembering to re-verify it by hand after every future change.
//
// Run: node test/smoke.test.js

const assert = require('assert');

// Copied intentionally, not required from app.js — app.js expects a
// browser global scope (window, document) and will throw immediately if
// loaded under plain Node. Keeping these in sync by hand is a real cost of
// this approach; a proper fix would extract shared logic into its own
// dependency-free module that both app.js and this test import.
const round2 = n => Math.round((Number(n)||0) * 100 + (n>=0?1:-1)*Number.EPSILON) / 100;
function csvEscape(v){
  const s = String(v==null?'':v);
  return /[",\n]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}

let passed = 0, failed = 0;
function test(name, fn){
  try{ fn(); passed++; console.log(`  ok  - ${name}`); }
  catch(e){ failed++; console.log(`FAIL  - ${name}\n        ${e.message}`); }
}

console.log('round2()');
test('adds without float drift over many operations', () => {
  let balance = 0;
  for(let i=0;i<20;i++) balance = round2(balance + 0.1);
  assert.strictEqual(balance, 2);
});
test('handles a charge then a payment landing back at zero', () => {
  let balance = round2(0 + 79.95);
  balance = round2(Math.max(0, balance - 79.95));
  assert.strictEqual(balance, 0);
});
test('rounds to 2 decimal places, not more', () => {
  assert.strictEqual(round2(10/3), 3.33);
});
test('handles negative-adjacent values (e.g. Math.max(0, ...) clamp) correctly', () => {
  assert.strictEqual(round2(Math.max(0, 5 - 5.004)), 0);
});

console.log('csvEscape()');
test('leaves plain text untouched', () => {
  assert.strictEqual(csvEscape('Coke 8oz'), 'Coke 8oz');
});
test('quotes and escapes a field containing a comma', () => {
  assert.strictEqual(csvEscape('Rice, Sardines'), '"Rice, Sardines"');
});
test('escapes embedded double-quotes', () => {
  assert.strictEqual(csvEscape('12" pan'), '"12"" pan"');
});
test('quotes fields containing newlines', () => {
  assert.strictEqual(csvEscape('line1\nline2'), '"line1\nline2"');
});
test('treats null/undefined as an empty field, not the string "null"', () => {
  assert.strictEqual(csvEscape(null), '');
  assert.strictEqual(csvEscape(undefined), '');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
