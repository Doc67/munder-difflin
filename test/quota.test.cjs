'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const loadTs = require('./load-ts.cjs');

const { pickSnapshot, parseRateLimitSnapshot } = loadTs('src/main/quotaService.ts');
const { windowLabel, codexText } = loadTs('src/renderer/src/components/quotaFormat.ts');

// ─── pickSnapshot ─────────────────────────────────────────────────────────────

test('pickSnapshot prefers rateLimitsByLimitId.codex over rateLimits', () => {
  const fallback = { primary: { usedPercent: 50 }, secondary: null };
  const codexSpecific = { primary: { usedPercent: 2 }, secondary: null };
  const result = { rateLimits: fallback, rateLimitsByLimitId: { codex: codexSpecific } };
  assert.equal(pickSnapshot(result), codexSpecific);
});

test('pickSnapshot falls back to rateLimits when codex key absent', () => {
  const rl = { primary: { usedPercent: 40 }, secondary: null };
  const result = { rateLimits: rl, rateLimitsByLimitId: {} };
  assert.equal(pickSnapshot(result), rl);
});

test('pickSnapshot falls back to rateLimits when rateLimitsByLimitId is null', () => {
  const rl = { primary: { usedPercent: 10 }, secondary: null };
  const result = { rateLimits: rl, rateLimitsByLimitId: null };
  assert.equal(pickSnapshot(result), rl);
});

// ─── parseRateLimitSnapshot ───────────────────────────────────────────────────

test('parseRateLimitSnapshot classifies 5h and weekly by windowDurationMins', () => {
  const snap = {
    primary: { usedPercent: 10, windowDurationMins: 300 },    // 5h
    secondary: { usedPercent: 25, windowDurationMins: 10080 } // weekly (≥9000)
  };
  const result = parseRateLimitSnapshot(snap);
  assert.equal(result.primary?.usedPct, 10);
  assert.equal(result.primary?.windowMins, 300);
  assert.equal(result.secondary?.usedPct, 25);
  assert.equal(result.secondary?.windowMins, 10080);
});

test('parseRateLimitSnapshot falls back to positional order when windowDurationMins absent', () => {
  const snap = {
    primary: { usedPercent: 15 },
    secondary: { usedPercent: 33 }
  };
  const result = parseRateLimitSnapshot(snap);
  // First unclassified → primary (5h slot), second → secondary (weekly slot)
  assert.equal(result.primary?.usedPct, 15);
  assert.equal(result.secondary?.usedPct, 33);
});

test('parseRateLimitSnapshot preserves both windows independently', () => {
  const snap = {
    primary: { usedPercent: 2, windowDurationMins: 300 },
    secondary: { usedPercent: 98, windowDurationMins: 10080 }
  };
  const { primary, secondary } = parseRateLimitSnapshot(snap);
  assert.ok(primary, 'primary window must be present');
  assert.ok(secondary, 'secondary window must be present');
  assert.equal(primary.usedPct, 2);
  assert.equal(secondary.usedPct, 98);
});

test('parseRateLimitSnapshot handles missing secondary gracefully', () => {
  const snap = { primary: { usedPercent: 5, windowDurationMins: 300 } };
  const result = parseRateLimitSnapshot(snap);
  assert.ok(result.primary);
  assert.equal(result.secondary, null);
});

// ─── push-notification path (rateLimitsByLimitId.codex preference) ─────────────

test('push handler: codex-specific window is used when rateLimitsByLimitId.codex present', () => {
  // Simulate what handleLine does for account/rateLimits/updated params
  const pushParams = {
    rateLimits: { primary: { usedPercent: 0 }, secondary: null },
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 42, windowDurationMins: 300 }, secondary: null }
    }
  };
  const chosen = pickSnapshot(pushParams);
  const snap = parseRateLimitSnapshot(chosen);
  assert.equal(snap.primary?.usedPct, 42, 'must use codex-specific usedPercent, not legacy 0');
});

test('push handler: falls back to rateLimits when codex key absent', () => {
  const pushParams = {
    rateLimits: { primary: { usedPercent: 77, windowDurationMins: 300 }, secondary: null },
    rateLimitsByLimitId: {}
  };
  const chosen = pickSnapshot(pushParams);
  const snap = parseRateLimitSnapshot(chosen);
  assert.equal(snap.primary?.usedPct, 77);
});

// ─── windowLabel ──────────────────────────────────────────────────────────────

test('windowLabel: 5h window', () => {
  assert.equal(windowLabel(300), '5h');
});

test('windowLabel: weekly window returns "Week" not "W"', () => {
  assert.equal(windowLabel(10080), 'Week');
  assert.equal(windowLabel(9000), 'Week');
});

test('windowLabel: null/zero returns ?h', () => {
  assert.equal(windowLabel(null), '?h');
  assert.equal(windowLabel(0), '?h');
});

// ─── codexText ────────────────────────────────────────────────────────────────

test('codexText: both windows shown without dot separator', () => {
  const snap = {
    primary: { usedPct: 2, windowMins: 300, resetsAt: null },
    secondary: { usedPct: 0, windowMins: 10080, resetsAt: null }
  };
  assert.equal(codexText(snap), '5h 98% Week 100%');
});

test('codexText: single window fallback when only primary present', () => {
  const snap = { primary: { usedPct: 50, windowMins: 300, resetsAt: null }, secondary: null };
  assert.equal(codexText(snap), '5h 50%');
});

test('codexText: empty snap returns --', () => {
  assert.equal(codexText({ primary: null, secondary: null }), '--');
});
