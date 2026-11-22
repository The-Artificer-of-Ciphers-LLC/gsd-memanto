'use strict';
// Round-7: lib/install-state.cjs classifies the install/load state once, and
// the four doctor records (loaded, consent, duplicate-install, gate-bundle) are
// built from that one result. This table covers every state in the closed
// enum, plus the reviewer's round-5 to round-7 repro shapes, and checks that
// the four records never contradict each other.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { STATES, REASON_CLASSES, classifyInstall, installRecords, reasonClass, POST_COLLISION_REASONS } = require('../lib/install-state.cjs');
const memanto = require('../memanto.cjs');
const { assertConsistent } = require('./helpers/install-invariants.cjs');

const D = { global: '/h/.gsd/capabilities/memanto', project: '/p/.gsd/capabilities/memanto' };
const COLL = 'id collides with an already-registered capability';
const ENG = 'incompatible with GSD 1.20.1 (requires engines.gsd ">=9.0.0")';
const SQUAT = 'owns config key "memanto.enabled" already owned by another capability';
const VALID = 'failed validation: title must be a non-empty string';
const FRAG = 'invalid hook fragment: memanto/contributions[0].fragment.path could not be read: missing-fragment.md';
const row = (scope, status = 'active', reason) => ({ id: 'memanto', scope, status, version: '0.1.0', ...(reason ? { reason } : {}) });

// Evidence in the shape memanto.cjs gatherEvidence builds. gateRuns follows
// lib/gate-bundle.cjs resolveGateBundle unless given.
function ev({ g = false, p = false, gInst = false, pInst = false, gGate, pGate, rows = [], ran = true, hook = false, reasons = [], same = false, gateRuns, enabled = true } = {}) {
  const dirs = same ? { global: D.global, project: D.global } : D;
  const runs = gateRuns !== undefined ? gateRuns : g ? (gInst ? dirs.global : null) : pInst ? dirs.project : null;
  return {
    dirs,
    manifest: { global: g, project: p },
    installed: { global: gInst, project: pInst },
    gateFile: { global: gGate === undefined ? g : gGate, project: pGate === undefined ? p : pGate },
    gateRuns: runs,
    rows,
    render: { ran, hook },
    reasons,
    enabled,
  };
}

const OPTS = { version: '0.1.0', reinstall: 'reinstall: gsd-tools capability install npm:@taoc/gsd-memanto@0.1.0 --yes' };

// [name, evidence, state, extra(records, cls)]
const CASES = [
  ['enabled, nothing installed, every render failed', ev({ ran: false }), STATES.NONE, (r) => assert.equal(r.gateBundle.status, 'error')],
  ['nothing installed (r7 nothing)', ev(), STATES.NONE, (r) => {
    assert.equal(r.gateBundle.status, 'error');
    assert.match(r.loaded.fix, /capability install/);
  }],
  ['nothing installed, memanto disabled (no render)', ev({ ran: false, enabled: false }), STATES.NONE, (r) => assert.equal(r.gateBundle.status, 'ok')],
  ['only a planted global gate.cjs', ev({ gGate: true }), STATES.NONE, (r, c) => assert.equal(c.stray.dir, D.global)],
  ['global install, hook rendered', ev({ g: true, gInst: true, rows: [row('global')], hook: true }), STATES.GLOBAL_LOADED, (r) => {
    for (const k of ['loaded', 'consent', 'duplicate', 'gateBundle']) assert.equal(r[k].status, 'ok', JSON.stringify(r[k]));
  }],
  ['project install, hook rendered', ev({ p: true, pInst: true, rows: [row('project')], hook: true }), STATES.PROJECT_LOADED, (r) => assert.equal(r.gateBundle.status, 'ok')],
  ['hand-copied global only (r7 strayglobal)', ev({ g: true, rows: [], hook: true }), STATES.GLOBAL_LOADED, (r) => {
    assert.equal(r.loaded.status, 'warn');
    assert.ok(r.gateBundle.fix.startsWith(`delete ${D.global} by hand`), r.gateBundle.fix);
    assert.ok(r.consent.fix.startsWith(`delete ${D.global} by hand`), r.consent.fix);
  }],
  ['hand-copied global plus project install, project collides', ev({ g: true, p: true, pInst: true, rows: [row('project')], hook: true, reasons: [COLL] }), STATES.GLOBAL_LOADED, (r) => {
    assert.ok(r.gateBundle.message.includes('as colliding'), r.gateBundle.message);
    assert.ok(r.gateBundle.fix.includes(`keep the installed project bundle at ${D.project}`), r.gateBundle.fix);
    assert.ok(r.duplicate.fix.startsWith(`delete ${D.global} by hand`), r.duplicate.fix);
  }],
  ['global install skipped (engines), project loads', ev({ g: true, p: true, gInst: true, pInst: true, rows: [row('global'), row('project')], hook: true, reasons: [ENG] }), STATES.PROJECT_LOADED, (r) => {
    assert.ok(r.gateBundle.message.includes(`would run ${D.global}/scripts/gate.cjs, but gsd-core loads the bundle at ${D.project}`), r.gateBundle.message);
  }],
  ['global install skipped (fragment), project loads', ev({ g: true, p: true, gInst: true, pInst: true, rows: [row('global'), row('project')], hook: true, reasons: [FRAG] }), STATES.PROJECT_LOADED],
  ['global row inactive, project loads', ev({ g: true, p: true, gInst: true, pInst: true, rows: [row('global', 'incompatible'), row('project')], hook: true }), STATES.PROJECT_LOADED],
  ['two copies, a pre-collision reason', ev({ g: true, p: true, gInst: true, pInst: true, rows: [row('global'), row('project')], hook: true, reasons: [VALID] }), STATES.UNDETERMINED, (r) => {
    assert.ok(r.loaded.message.includes('doctor cannot tell'), r.loaded.message);
    assert.equal(r.gateBundle.status, 'error');
  }],
  ['global only, engines (r6 gengines)', ev({ g: true, gInst: true, rows: [row('global', 'incompatible')], reasons: [ENG] }), STATES.GLOBAL_SKIPPED, (r) => {
    assert.ok(r.loaded.message.includes(`gsd-core did not load the global memanto copy at ${D.global}`), r.loaded.message);
    assert.ok(r.loaded.fix.includes('engines') && r.loaded.fix.includes('capability install'), r.loaded.fix);
    assert.ok(!r.loaded.fix.includes('does not clear'), r.loaded.fix);
  }],
  ['global only, squat (r6 gsquat)', ev({ g: true, gInst: true, rows: [row('global')], reasons: [SQUAT] }), STATES.GLOBAL_SKIPPED, (r) => {
    assert.ok(r.loaded.fix.includes('does not clear it'), r.loaded.fix);
    assert.ok(r.gateBundle.fix.includes('does not clear it'), r.gateBundle.fix);
  }],
  ['project only, squat (r6 psquat)', ev({ p: true, pInst: true, rows: [row('project')], reasons: [SQUAT] }), STATES.PROJECT_SKIPPED, (r) => {
    assert.ok(r.loaded.message.includes(`gsd-core did not load the project memanto copy at ${D.project}`), r.loaded.message);
  }],
  ['two copies, both squatted (r5 two-copy squat)', ev({ g: true, p: true, gInst: true, pInst: true, rows: [row('global'), row('project')], reasons: [SQUAT, SQUAT] }), STATES.BOTH_SKIPPED, (r) => {
    assert.ok(r.loaded.message.includes('gsd-core loaded neither memanto copy'), r.loaded.message);
    assert.ok(r.loaded.message.includes('reported for both copies'), r.loaded.message);
    assert.ok(r.duplicate.message.includes('gsd-core loaded neither of them'), r.duplicate.message);
    assert.ok(r.loaded.fix.includes('does not clear it'), r.loaded.fix);
  }],
  ['two copies, mixed reasons (validation then squat)', ev({ g: true, p: true, gInst: true, pInst: true, rows: [row('global'), row('project')], reasons: [VALID, SQUAT] }), STATES.BOTH_SKIPPED, (r) => {
    assert.ok(r.loaded.fix.includes('capability install'), r.loaded.fix);
    assert.ok(r.loaded.fix.includes('a reinstall does not clear the ownership clash'), r.loaded.fix);
    assert.ok(!r.loaded.fix.includes('does not clear it'), r.loaded.fix);
  }],
  ['hand-copied global manifest with no hooks, project collides (r7 collide)', ev({ g: true, gGate: false, p: true, pInst: true, rows: [row('project')], reasons: [COLL] }), STATES.GLOBAL_NO_HOOKS, (r) => {
    for (const k of ['loaded', 'gateBundle']) {
      assert.ok(!/neither/.test(r[k].message), r[k].message);
      assert.ok(!r[k].fix.includes('does not clear'), r[k].fix);
      assert.ok(r[k].message.includes(`gsd-core loaded the global memanto copy at ${D.global}, but it renders no memanto hook`), r[k].message);
      assert.ok(r[k].fix.startsWith(`delete ${D.global} by hand`), r[k].fix);
    }
    assert.ok(r.consent.fix.startsWith(`delete ${D.global} by hand`), r.consent.fix);
    assert.ok(r.duplicate.fix.startsWith(`delete ${D.global} by hand`), r.duplicate.fix);
  }],
  ['installed global renders nothing and gives no reason (r6 IN-01)', ev({ g: true, gInst: true, rows: [row('global')] }), STATES.GLOBAL_NO_HOOKS, (r) => {
    assert.ok(r.gateBundle.message.includes('printed no load error'), r.gateBundle.message);
    assert.ok(!r.gateBundle.message.includes('runs the installed bundle gsd-core loads'), r.gateBundle.message);
    assert.ok(r.loaded.fix.includes('memanto.enabled'), r.loaded.fix);
  }],
  ['hand-copied project bundle (r7 strayproj)', ev({ p: true, rows: [] }), STATES.PROJECT_INACTIVE, (r, c) => {
    assert.equal(c.stray.dir, D.project);
    assert.ok(r.gateBundle.message.includes('stray or planted gate code'), r.gateBundle.message);
    assert.ok(r.gateBundle.fix.startsWith(`delete ${D.project} by hand`), r.gateBundle.fix);
  }],
  ['project install without consent', ev({ p: true, pInst: true, rows: [row('project', 'inactive', 'no user consent record')] }), STATES.PROJECT_INACTIVE, (r) => {
    assert.match(r.consent.fix, /re-consent/);
    assert.match(r.loaded.fix, /re-consent/);
  }],
  ['activated project install renders nothing and gives no reason', ev({ p: true, pInst: true, rows: [row('project')] }), STATES.UNEXPLAINED, (r) => {
    assert.ok(r.gateBundle.message.includes('printed no load error'), r.gateBundle.message);
  }],
  ['project root is GSD_HOME, one copy, engines (r7 homeproj)', ev({ same: true, g: true, p: true, gInst: true, pInst: true, rows: [row('global')], reasons: [ENG] }), STATES.GLOBAL_SKIPPED, (r) => {
    assert.equal(r.duplicate.status, 'ok');
  }],
  ['global engines plus a stray project gate.cjs (r7 globalplusstray)', ev({ g: true, gInst: true, pGate: true, rows: [row('global', 'incompatible')], reasons: [ENG] }), STATES.GLOBAL_SKIPPED, (r, c) => {
    assert.equal(c.stray.dir, D.project);
  }],
  ['project install next to a planted global gate.cjs', ev({ p: true, pInst: true, gGate: true, rows: [row('project')], hook: true }), STATES.PROJECT_LOADED, (r, c) => {
    assert.equal(c.stray.dir, D.global);
    assert.ok(r.gateBundle.fix.includes(`keep the installed project bundle at ${D.project}`), r.gateBundle.fix);
  }],
  ['no render: hand-copied global plus project install (memanto disabled)', ev({ g: true, p: true, pInst: true, rows: [row('project')], ran: false, enabled: false }), STATES.GLOBAL_LOADED, (r) => {
    assert.ok(r.gateBundle.message.includes('gsd-core scans the global copy first'), r.gateBundle.message);
    assert.ok(!r.gateBundle.message.includes('as colliding'), r.gateBundle.message);
  }],
  ['no render: project install only, capability list unreadable', ev({ p: true, pInst: true, rows: null, ran: false }), STATES.PROJECT_LOADED],
  ['no render: unledgered project copy, capability list unreadable', ev({ p: true, rows: null, ran: false }), STATES.PROJECT_INACTIVE, (r) => {
    assert.ok(!/delete \/p\b/.test(r.loaded.fix), 'deletes a copy without ledger evidence');
  }],
  ['no render: global row incompatible, no project', ev({ g: true, gInst: true, rows: [row('global', 'incompatible')], ran: false }), STATES.GLOBAL_SKIPPED],
  ['no render: global incompatible, project not consented', ev({ g: true, p: true, gInst: true, pInst: true, rows: [row('global', 'incompatible'), row('project', 'inactive', 'no user consent record')], ran: false }), STATES.BOTH_SKIPPED],
];

test('every state of the closed enum is covered by the table', () => {
  const covered = new Set(CASES.map((c) => c[2]));
  assert.deepEqual([...covered].sort(), Object.values(STATES).sort());
});

for (const [name, evidence, state, extra] of CASES) {
  test(`classifyInstall: ${name} -> ${state}, and the four records agree`, () => {
    const cls = classifyInstall(evidence);
    assert.equal(cls.state, state, JSON.stringify(cls));
    const recs = installRecords(cls, OPTS);
    const facts = {
      stray: cls.stray && cls.stray.dir,
      twoCopies: cls.copies.length === 2,
      installedDirs: cls.copies.filter((c) => c.installed).map((c) => c.dir),
      loaded: Boolean(cls.loaded),
    };
    // doctor prints loaded only when memanto is enabled.
    assertConsistent([cls.enabled ? recs.loaded : null, recs.consent, recs.duplicate, recs.gateBundle], facts, name);
    // gate-bundle is ok only when the gate runs the copy gsd-core loads and no stray gate code exists.
    const runsLoaded = Boolean(cls.loaded && cls.gateRuns === cls.loaded.dir && state !== STATES.GLOBAL_NO_HOOKS);
    const nothingToRun = state === STATES.NONE && !cls.enabled;
    assert.equal(recs.gateBundle.status === 'ok', !cls.stray && (runsLoaded || nothingToRun), JSON.stringify(recs.gateBundle));
    if (extra) extra(recs, cls);
  });
}

test('classifyInstall and installRecords are safe without optional arguments', () => {
  const cls = classifyInstall(undefined);
  assert.equal(cls.state, STATES.NONE);
  const recs = installRecords(cls);
  for (const r of Object.values(recs)) assert.equal(typeof r.message, 'string');
  assert.doesNotThrow(() => installRecords(classifyInstall({ manifest: { project: true }, dirs: D })));
});

test('reason classes: owns is an ownership clash, id collides means gsd-core accepted the global copy', () => {
  assert.equal(reasonClass(SQUAT), REASON_CLASSES.CLASH);
  assert.equal(reasonClass('owns command family "memanto" already owned by another capability'), REASON_CLASSES.CLASH);
  assert.equal(reasonClass(COLL), REASON_CLASSES.COLLISION);
  assert.equal(reasonClass(ENG), REASON_CLASSES.ENGINES);
  for (const r of [VALID, FRAG, 'unreadable or invalid capability.json: x', 'hook fragment could not be materialized: EACCES', 'cross-capability validation failed: x', 'configHome confinement rejected: x']) {
    assert.equal(reasonClass(r), REASON_CLASSES.INVALID, r);
  }
  assert.equal(reasonClass('overlay processing error: x'), REASON_CLASSES.UNKNOWN);
});

// The loader inference (ported from the round-4/5 loadedCopy tests): with two
// copies and a hook rendered, a post-collision reason names the global copy,
// a collision proves the global copy loaded, and any other reason is undetermined.
test('classifyInstall: post-collision reasons name the global copy as skipped; other reasons are undetermined', () => {
  const two = { g: true, p: true, gInst: true, pInst: true, rows: [row('global'), row('project')], hook: true };
  for (const p of POST_COLLISION_REASONS) {
    const cls = classifyInstall(ev({ ...two, reasons: [`${p}x`] }));
    assert.equal(cls.state, STATES.PROJECT_LOADED, p);
    assert.equal(cls.loaded.dir, D.project, p);
  }
  for (const r of [VALID, 'unreadable or invalid capability.json: x', 'id uses a reserved first-party prefix (gsd-/gsd-core-/anthropic-)', 'a reason this gsd-core version does not give']) {
    assert.equal(classifyInstall(ev({ ...two, reasons: [r] })).state, STATES.UNDETERMINED, r);
  }
  assert.equal(classifyInstall(ev({ ...two, reasons: [COLL] })).state, STATES.GLOBAL_LOADED);
  // With no hook rendered, no reason makes a copy loaded except a collision.
  for (const reasons of [[SQUAT], [SQUAT, SQUAT], [VALID, SQUAT]]) {
    assert.equal(classifyInstall(ev({ ...two, hook: false, reasons })).loaded, null, JSON.stringify(reasons));
  }
});

test('memanto.cjs exports the classifier and no longer exports the per-record helpers', () => {
  assert.equal(memanto.classifyInstall, classifyInstall);
  assert.equal(memanto.installRecords, installRecords);
  for (const gone of ['loadedCopy', 'loadedCheck', 'gateBundleCheck']) assert.equal(memanto[gone], undefined, gone);
});
