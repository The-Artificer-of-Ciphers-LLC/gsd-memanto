'use strict';
// Owner follow-up to round-4 WR-01: doctor treats a load-failure reason as the
// global copy's when gsd-core's loader gives it only AFTER its id-collision
// check (memanto.cjs POST_COLLISION_REASONS). That holds only while the
// installed loader keeps that order. This test reads the installed loader
// SOURCE as text (never require()s it, so the builtin-only require contract
// holds) and fails with a clear message when the order of its skip() checks no
// longer matches the list. CI runs it against every gsd-core in the matrix.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./helpers/gsd-env.cjs');
const { POST_COLLISION_REASONS } = require('../memanto.cjs');

const LOADER = path.join(env.coreDir(), 'bin', 'lib', 'capability-loader.cjs');
const COLLISION = 'id collides';
// Reasons the loader can give at any stage, so they never name a copy: the
// catch of the per-candidate try block that wraps every check.
const ANY_STAGE = ['overlay processing error: '];

// The leading string literal of every skip(...) call after the skip helper is
// defined, in source order, with its line number.
function skipReasons(src) {
  const lines = src.split('\n');
  const start = lines.findIndex((l) => /\bconst skip = \(reason\) =>/.test(l));
  assert.ok(start !== -1, `${LOADER}: no "const skip = (reason) =>" helper; the loader changed shape, recheck POST_COLLISION_REASONS in memanto.cjs`);
  const out = [];
  for (let i = start + 1; i < lines.length; i++) {
    for (const m of lines[i].matchAll(/\bskip\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) out.push({ line: i + 1, text: m[2] });
  }
  return { lines, out };
}

test('the installed gsd-core loader gives the POST_COLLISION reasons, in order, only after its id-collision check', () => {
  assert.ok(Array.isArray(POST_COLLISION_REASONS) && POST_COLLISION_REASONS.length > 0, 'memanto.cjs must export POST_COLLISION_REASONS');
  assert.ok(fs.existsSync(LOADER), `no gsd-core loader at ${LOADER} (set GSD_CORE_DIR)`);
  const { lines, out } = skipReasons(fs.readFileSync(LOADER, 'utf8'));
  const where = (r) => `${path.basename(LOADER)}:${r.line} skip('${r.text}...')`;
  const collision = out.findIndex((r) => r.text.startsWith(COLLISION));
  assert.ok(collision !== -1, `${LOADER}: no skip('${COLLISION}...') check; recheck POST_COLLISION_REASONS in memanto.cjs`);
  const listed = (r) => POST_COLLISION_REASONS.some((p) => r.text.startsWith(p));

  const early = out.slice(0, collision).filter(listed);
  assert.deepEqual(
    early.map(where),
    [],
    'these POST_COLLISION reasons now come BEFORE the id-collision check, so a project copy can get them; remove them from memanto.cjs POST_COLLISION_REASONS',
  );

  for (const r of out.slice(collision + 1).filter((x) => ANY_STAGE.some((p) => x.text.startsWith(p)))) {
    // The nearest code line above it (comments and the cleanup statement skipped) opens the catch block.
    const above = lines.slice(Math.max(0, r.line - 15), r.line - 1).filter((l) => !/^\s*\/\//.test(l) && l.trim() !== '');
    const opener = above.reverse().find((l) => /\bcatch\b|\{\s*$/.test(l)) || '';
    assert.match(opener, /\bcatch\b/, `${where(r)} is no longer in a catch block; decide whether it belongs in POST_COLLISION_REASONS`);
  }
  const after = out.slice(collision + 1).filter((r) => !ANY_STAGE.some((p) => r.text.startsWith(p)));
  const unlisted = after.filter((r) => !listed(r));
  assert.deepEqual(unlisted.map(where), [], 'the loader has new skip reasons after its id-collision check; add them to memanto.cjs POST_COLLISION_REASONS (or ANY_STAGE here)');
  const order = after.map((r) => POST_COLLISION_REASONS.findIndex((p) => r.text.startsWith(p)));
  assert.deepEqual(
    order,
    POST_COLLISION_REASONS.map((_, i) => i),
    `the loader's post-collision skip order (${after.map(where).join(', ')}) no longer matches memanto.cjs POST_COLLISION_REASONS`,
  );
});

test('POST_COLLISION matches the reasons as gsd-core prints them, and no pre-collision reason', () => {
  const { loadedCopy } = require('../memanto.cjs');
  assert.equal(typeof loadedCopy, 'function');
  const { POST_COLLISION } = require('../memanto.cjs');
  for (const p of POST_COLLISION_REASONS) assert.ok(POST_COLLISION.test(`${p}x`), p);
  for (const r of ['id collides with an already-registered capability', 'failed validation: x', 'id uses a reserved first-party prefix (gsd-/gsd-core-/anthropic-)', 'overlay processing error: x']) {
    assert.ok(!POST_COLLISION.test(r), r);
  }
});
