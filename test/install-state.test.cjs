'use strict';
// Round-7/8: lib/install-state.cjs classifies the install/load state once, and
// the four doctor records (loaded, consent, duplicate-install, gate-bundle) are
// built from that one result. This table covers every state in the closed
// enum, plus the reviewer's round-5 to round-8 repro shapes, and checks that
// the four records never contradict each other.
//
// Round-8 WR-03: the facts the shared rules check come from the raw evidence
// and from each case's own definition (the loaded column), never from the
// classifier's output.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { STATES, REASON_CLASSES, classifyInstall, installRecords, reasonClass, POST_COLLISION_REASONS } = require('../lib/install-state.cjs');
const memanto = require('../memanto.cjs');
const { assertConsistent } = require('./helpers/install-invariants.cjs');

const D = { global: '/h/.gsd/capabilities/memanto', project: '/p/.gsd/capabilities/memanto' };
const COLL = 'id collides with an already-registered capability';
const ENG = 'incompatible with GSD 1.20.1 (requires engines.gsd ">=9.0.0")';
const SQUAT = 'owns config key "memanto.enabled" already owned by another capability';
const VALID = 'failed validation: title must be a non-empty string';
const FRAG = 'invalid hook fragment: memanto/contributions[0].fragment.path could not be read: missing-fragment.md';
const NOCONSENT = 'discovered — no user consent record (inactive)';
const row = (scope, status = 'active', reason) => ({ id: 'memanto', scope, status, version: '0.1.0', ...(reason ? { reason } : {}) });

// The raw case: which files exist in each scope, the ledger state, what
// capability list and render-hooks returned.
//   g, p              capability.json exists in that scope
//   gInst, pInst      a committed ledger entry (shorthand for gLed/pLed 'committed')
//   gLed, pLed        'committed' | 'pending' | 'none'
//   gBad, pBad        the capability.json is unreadable (or not id memanto)
//   gNoGate, pNoGate  the capability.json declares no discuss:pre gate
//   gGate, pGate      scripts/gate.cjs exists (default: when the manifest does)
//   hook / gate       a memanto hook / the memanto gate rendered (gate defaults to hook)
//   same              'text': GSD_HOME is the project root; 'alias': a symlink to it
//   demoted           gsd-core demotes the global root to project scope (default with same)
function raw(o = {}) {
  const r = { g: false, p: false, rows: [], ran: true, hook: false, reasons: [], enabled: true, ...o };
  r.gLed = o.gLed || (o.gInst ? 'committed' : 'none');
  r.pLed = o.pLed || (o.pInst ? 'committed' : 'none');
  r.gate = o.gate !== undefined ? o.gate : r.hook;
  r.dirs = r.same === 'text' ? { global: D.global, project: D.global } : r.same === 'alias' ? { global: '/hs/.gsd/capabilities/memanto', project: D.global } : D;
  r.demoted = r.same ? o.demoted !== false : false;
  r.gGate = o.gGate === undefined ? r.g : o.gGate;
  r.pGate = o.pGate === undefined ? r.p : o.pGate;
  return r;
}

// Evidence in the shape memanto.cjs gatherEvidence builds.
function evOf(r) {
  const installed = (led, ok) => led === 'committed' && ok;
  const gOk = r.g && !r.gBad;
  const pOk = r.p && !r.pBad;
  // lib/gate-bundle.cjs resolveGateBundle, as the predicate decides.
  let gateRuns = null;
  if (r.gateRuns !== undefined) gateRuns = r.gateRuns;
  else if (r.same) gateRuns = (r.g || r.p) && installed(r.gLed !== 'none' ? r.gLed : r.pLed, gOk || pOk) ? 'global' : null;
  else if (r.g) gateRuns = installed(r.gLed, gOk) ? 'global' : null;
  else gateRuns = installed(r.pLed, pOk) ? 'project' : null;
  return {
    dirs: r.dirs,
    sameDir: Boolean(r.same),
    demoted: r.demoted,
    manifest: { global: r.g, project: r.p },
    manifestOk: { global: gOk, project: pOk },
    declaresGate: { global: gOk && !r.gNoGate, project: pOk && !r.pNoGate },
    gateFile: { global: r.gGate, project: r.pGate },
    ledger: { global: r.gLed, project: r.pLed },
    gateRuns,
    rows: r.rows,
    render: { ran: r.ran, hook: r.hook, gate: r.gate, ...(r.mismatch ? { mismatch: r.mismatch } : {}) },
    reasons: r.reasons,
    enabled: r.enabled,
  };
}

const ev = (o) => evOf(raw(o));

// The facts the shared rules check, from the raw case and its loaded column.
function factsOf(r, loadedScope) {
  const scopes = ['global', 'project'];
  const led = { global: r.gLed !== 'none', project: r.pLed !== 'none' };
  const man = { global: r.g, project: r.p };
  const gateFile = { global: r.gGate, project: r.pGate };
  let stray = null;
  let copyScopes;
  let unledgered = [];
  let ledgeredDirs;
  if (r.same) {
    const scope = r.demoted ? 'project' : 'global';
    copyScopes = r.g || r.p ? [scope] : [];
    const anyLed = led.global || led.project;
    if ((gateFile.global || gateFile.project) && !anyLed) stray = r.dirs[scope];
    if (copyScopes.length && !anyLed) unledgered = [r.dirs[scope]];
    ledgeredDirs = anyLed ? [r.dirs.global, r.dirs.project] : [];
  } else {
    copyScopes = scopes.filter((s) => man[s]);
    stray = (scopes.find((s) => gateFile[s] && !led[s]) && r.dirs[scopes.find((s) => gateFile[s] && !led[s])]) || null;
    unledgered = copyScopes.filter((s) => !led[s]).map((s) => r.dirs[s]);
    ledgeredDirs = scopes.filter((s) => led[s]).map((s) => r.dirs[s]);
  }
  const ge = evOf(r).gateRuns;
  return {
    stray,
    twoCopies: copyScopes.length === 2,
    ledgeredDirs,
    dirs: r.same ? { global: r.dirs[copyScopes[0] || 'global'], project: r.dirs[copyScopes[0] || 'global'] } : r.dirs,
    enabled: r.enabled,
    gateRendered: Boolean(r.gate),
    loadedScope,
    gateRunsDir: ge === 'global' || ge === 'project' ? r.dirs[ge] : ge,
    onlyScope: copyScopes.length === 1 ? copyScopes[0] : undefined,
    unledgeredDirs: unledgered,
    rowsKnown: Array.isArray(r.rows),
  };
}

const OPTS = { version: '0.1.0', reinstall: 'reinstall: gsd-tools capability install npm:@taoc/gsd-memanto@0.1.0 --yes' };
const G = 'global';
const P = 'project';

// [name, raw case, state, the copy gsd-core loaded (null: none; '?': cannot tell), extra(records, cls)]
const CASES = [
  ['enabled, nothing installed, every render failed', {}, STATES.NONE, null, (r) => assert.equal(r.gateBundle.status, 'error')],
  ['nothing installed (r7 nothing)', {}, STATES.NONE, null, (r) => {
    assert.equal(r.gateBundle.status, 'error');
    assert.match(r.loaded.fix, /capability install/);
  }],
  ['nothing installed, memanto disabled (no render)', { ran: false, enabled: false }, STATES.NONE, null, (r) => assert.equal(r.gateBundle.status, 'warn')],
  ['only a planted global gate.cjs', { gGate: true }, STATES.NONE, null, (r, c) => assert.equal(c.stray.dir, D.global)],
  ['global install, gate rendered', { g: true, gInst: true, rows: [row(G)], hook: true }, STATES.GLOBAL_LOADED, G, (r) => {
    for (const k of ['loaded', 'consent', 'duplicate', 'gateBundle']) assert.equal(r[k].status, 'ok', JSON.stringify(r[k]));
  }],
  ['project install, gate rendered', { p: true, pInst: true, rows: [row(P)], hook: true }, STATES.PROJECT_LOADED, P, (r) => assert.equal(r.gateBundle.status, 'ok')],
  ['hand-copied global only (r7 strayglobal)', { g: true, rows: [], hook: true }, STATES.GLOBAL_LOADED, G, (r) => {
    assert.equal(r.loaded.status, 'warn');
    assert.ok(r.gateBundle.fix.startsWith(`delete ${D.global} by hand`), r.gateBundle.fix);
    assert.ok(r.consent.fix.startsWith(`delete ${D.global} by hand`), r.consent.fix);
  }],
  ['hand-copied global plus project install, project collides', { g: true, p: true, pInst: true, rows: [row(P)], hook: true, reasons: [COLL] }, STATES.GLOBAL_LOADED, G, (r) => {
    assert.ok(r.gateBundle.message.includes('as colliding'), r.gateBundle.message);
    assert.ok(r.gateBundle.fix.includes(`keep the installed project bundle at ${D.project}`), r.gateBundle.fix);
    assert.ok(r.duplicate.fix.startsWith(`delete ${D.global} by hand`), r.duplicate.fix);
  }],
  ['global install skipped (engines), project loads', { g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P)], hook: true, reasons: [ENG] }, STATES.PROJECT_LOADED, P, (r) => {
    assert.ok(r.gateBundle.message.includes(`would run ${D.global}/scripts/gate.cjs, but gsd-core loads the bundle at ${D.project}`), r.gateBundle.message);
  }],
  ['global install skipped (fragment), project loads', { g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P)], hook: true, reasons: [FRAG] }, STATES.PROJECT_LOADED, P],
  ['global row inactive, project loads', { g: true, p: true, gInst: true, pInst: true, rows: [row(G, 'incompatible'), row(P)], hook: true }, STATES.PROJECT_LOADED, P],
  ['two copies, a pre-collision reason', { g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P)], hook: true, reasons: [VALID] }, STATES.UNDETERMINED, '?', (r) => {
    assert.ok(r.loaded.message.includes('doctor cannot tell'), r.loaded.message);
    assert.equal(r.gateBundle.status, 'error');
  }],
  ['global only, engines (r6 gengines)', { g: true, gInst: true, rows: [row(G, 'incompatible')], reasons: [ENG] }, STATES.GLOBAL_SKIPPED, null, (r) => {
    assert.ok(r.loaded.message.includes(`gsd-core did not load the global memanto copy at ${D.global}`), r.loaded.message);
    assert.ok(r.loaded.fix.includes('engines') && r.loaded.fix.includes('capability install'), r.loaded.fix);
    assert.ok(!r.loaded.fix.includes('does not clear'), r.loaded.fix);
  }],
  ['global only, squat (r6 gsquat)', { g: true, gInst: true, rows: [row(G)], reasons: [SQUAT] }, STATES.GLOBAL_SKIPPED, null, (r) => {
    assert.ok(r.loaded.fix.includes('does not clear it'), r.loaded.fix);
    assert.ok(r.gateBundle.fix.includes('does not clear it'), r.gateBundle.fix);
  }],
  ['project only, squat (r6 psquat)', { p: true, pInst: true, rows: [row(P)], reasons: [SQUAT] }, STATES.PROJECT_SKIPPED, null, (r) => {
    assert.ok(r.loaded.message.includes(`gsd-core did not load the project memanto copy at ${D.project}`), r.loaded.message);
  }],
  ['two copies, both squatted (r5 two-copy squat)', { g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P)], reasons: [SQUAT, SQUAT] }, STATES.BOTH_SKIPPED, null, (r) => {
    assert.ok(r.loaded.message.includes('gsd-core loaded neither memanto copy'), r.loaded.message);
    assert.ok(r.loaded.message.includes('reported for both copies'), r.loaded.message);
    assert.ok(r.duplicate.message.includes('gsd-core loaded neither of them'), r.duplicate.message);
    assert.ok(r.loaded.fix.includes('does not clear it'), r.loaded.fix);
  }],
  ['two copies, mixed reasons (validation then squat)', { g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P)], reasons: [VALID, SQUAT] }, STATES.BOTH_SKIPPED, null, (r) => {
    assert.ok(r.loaded.fix.includes('capability install'), r.loaded.fix);
    assert.ok(r.loaded.fix.includes('a reinstall does not clear the ownership clash'), r.loaded.fix);
    assert.ok(!r.loaded.fix.includes('does not clear it'), r.loaded.fix);
  }],
  ['hand-copied global manifest with no hooks, project collides (r7 collide)', { g: true, gGate: false, gNoGate: true, p: true, pInst: true, rows: [row(P)], reasons: [COLL] }, STATES.GLOBAL_NO_GATE, G, (r) => {
    for (const k of ['loaded', 'gateBundle']) {
      assert.ok(!/neither/.test(r[k].message), r[k].message);
      assert.ok(!r[k].fix.includes('does not clear'), r[k].fix);
      assert.ok(r[k].message.includes(`gsd-core loaded the global memanto copy at ${D.global}, but it renders no memanto gate at discuss:pre`), r[k].message);
      assert.ok(r[k].fix.startsWith(`delete ${D.global} by hand`), r[k].fix);
    }
    assert.ok(r.consent.fix.startsWith(`delete ${D.global} by hand`), r.consent.fix);
    assert.ok(r.duplicate.fix.startsWith(`delete ${D.global} by hand`), r.duplicate.fix);
  }],
  // Round-8 CR-01: the installed manifests declare no gate.
  ['installed global declares no gate (r8 gnogate)', { g: true, gInst: true, gNoGate: true, rows: [row(G)] }, STATES.UNEXPLAINED, null, (r) => {
    for (const k of ['loaded', 'gateBundle']) {
      assert.equal(r[k].status, 'error', JSON.stringify(r[k]));
      assert.ok(r[k].message.includes('declares no discuss:pre gate'), r[k].message);
      assert.ok(r[k].fix.includes('reinstall the global copy in place'), r[k].fix);
    }
  }],
  ['two installs, the global declares no gate and holds the id (r8 twonogate)', { g: true, p: true, gInst: true, pInst: true, gNoGate: true, rows: [row(G), row(P)], reasons: [COLL] }, STATES.GLOBAL_NO_GATE, G, (r) => {
    assert.ok(r.duplicate.message.includes('gsd-core keeps the global one, which renders no memanto gate'), r.duplicate.message);
    assert.ok(r.loaded.fix.includes('reinstall it in place'), r.loaded.fix);
  }],
  ['two installs, the global is silently rejected and the project gate renders (r8 twoinvalid)', { g: true, p: true, gInst: true, pInst: true, gNoGate: true, rows: [row(G), row(P)], hook: true }, STATES.PROJECT_LOADED, P, (r) => {
    assert.equal(r.gateBundle.status, 'error', JSON.stringify(r.gateBundle));
    assert.ok(r.gateBundle.message.includes(`would run ${D.global}/scripts/gate.cjs, but gsd-core loads the bundle at ${D.project}`), r.gateBundle.message);
    assert.ok(!r.duplicate.message.includes('keeps the global one'), r.duplicate.message);
  }],
  ['two installs, a hook renders, the activated project copy declares no gate', { g: true, p: true, gInst: true, pInst: true, pNoGate: true, rows: [row(G), row(P)], hook: true }, STATES.UNDETERMINED, '?'],
  ['two installs, the gate renders, the project copy is not activated', { g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P, 'inactive', NOCONSENT)], hook: true }, STATES.GLOBAL_LOADED, G, (r) => {
    assert.equal(r.gateBundle.status, 'ok', JSON.stringify(r.gateBundle));
  }],
  ['global install renders a hook elsewhere but no gate', { g: true, gInst: true, rows: [row(G)], hook: true, gate: false }, STATES.GLOBAL_NO_GATE, G, (r) => {
    assert.ok(r.loaded.message.includes('renders no memanto gate at discuss:pre'), r.loaded.message);
  }],
  // Round-9 WR-01: a memanto gate renders, but it is not the shipped one.
  ['installed global gate does not match this release (r9 gexit0)', { g: true, gInst: true, rows: [row(G)], hook: true, gate: false, mismatch: 'command' }, STATES.GLOBAL_NO_GATE, G, (r) => {
    for (const k of ['loaded', 'gateBundle']) {
      assert.equal(r[k].status, 'error', JSON.stringify(r[k]));
      assert.ok(r[k].message.includes('the installed memanto gate at discuss:pre does not match this release: command'), r[k].message);
      assert.ok(r[k].fix.startsWith(`reinstall the global copy at ${D.global} in place`), r[k].fix);
    }
  }],
  ['two installs, the global gate does not match and holds the id (r9 gnonblock)', { g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P)], hook: true, gate: false, mismatch: 'blocking, onError', reasons: [COLL] }, STATES.GLOBAL_NO_GATE, G, (r) => {
    assert.ok(r.duplicate.message.includes('does not match this release (blocking, onError)'), r.duplicate.message);
  }],
  ['project copy loads, renders no gate',{ g: true, p: true, gInst: true, pInst: true, pNoGate: true, rows: [row(G, 'incompatible'), row(P)], hook: true, gate: false }, STATES.PROJECT_NO_GATE, P, (r) => {
    assert.ok(r.loaded.message.includes(`gsd-core loaded the project memanto copy at ${D.project}, but it renders no memanto gate`), r.loaded.message);
  }],
  ['installed global renders nothing and gives no reason (r6 IN-01)', { g: true, gInst: true, rows: [row(G)] }, STATES.UNEXPLAINED, null, (r) => {
    assert.ok(r.gateBundle.message.includes('printed no load error'), r.gateBundle.message);
    assert.ok(!r.gateBundle.message.includes('runs the installed bundle gsd-core loads'), r.gateBundle.message);
    assert.ok(r.loaded.fix.includes('memanto.enabled'), r.loaded.fix);
  }],
  ['hand-copied project bundle (r7 strayproj)', { p: true, rows: [] }, STATES.PROJECT_INACTIVE, null, (r, c) => {
    assert.equal(c.stray.dir, D.project);
    assert.ok(r.gateBundle.message.includes('stray or planted gate code'), r.gateBundle.message);
    assert.ok(r.gateBundle.fix.startsWith(`delete ${D.project} by hand`), r.gateBundle.fix);
  }],
  ['project install without consent', { p: true, pInst: true, rows: [row(P, 'inactive', 'no user consent record')] }, STATES.PROJECT_INACTIVE, null, (r) => {
    assert.match(r.consent.fix, /re-consent/);
    assert.match(r.loaded.fix, /re-consent/);
  }],
  ['activated project install renders nothing and gives no reason', { p: true, pInst: true, rows: [row(P)] }, STATES.UNEXPLAINED, null, (r) => {
    assert.ok(r.gateBundle.message.includes('printed no load error'), r.gateBundle.message);
  }],
  // Round-8 WR-01: a ledgered copy is a broken or unfinished install, never stray.
  ['ledgered global install with a corrupt capability.json (r8 gcorrupt)', { g: true, gInst: true, gBad: true, rows: [row(G)] }, STATES.BROKEN, null, (r) => {
    for (const k of ['loaded', 'gateBundle']) {
      assert.equal(r[k].status, 'error', JSON.stringify(r[k]));
      assert.ok(r[k].message.includes('is broken'), r[k].message);
      assert.ok(r[k].fix.startsWith('reinstall the global copy in place'), r[k].fix);
      assert.ok(!/\bdelete\b/.test(r[k].fix), r[k].fix);
    }
  }],
  ['ledgered project install with a corrupt capability.json', { p: true, pInst: true, pBad: true, rows: [row(P)] }, STATES.BROKEN, null, (r) => {
    assert.ok(r.loaded.fix.includes('--scope project'), r.loaded.fix);
  }],
  ['global install with an _pending ledger entry, capability list unreadable (r8 gpending)', { g: true, gLed: 'pending', rows: null }, STATES.PENDING, null, (r) => {
    for (const k of ['loaded', 'gateBundle']) {
      assert.equal(r[k].status, 'error', JSON.stringify(r[k]));
      assert.ok(r[k].message.includes('_pending'), r[k].message);
      assert.ok(r[k].fix.startsWith('finish or roll back the interrupted global install'), r[k].fix);
    }
    assert.ok(!r.gateBundle.message.includes('gsd-core loads memanto from'), r.gateBundle.message);
  }],
  ['broken global install next to a project install that loads', { g: true, gInst: true, gBad: true, p: true, pInst: true, rows: [row(P)], hook: true }, STATES.PROJECT_LOADED, P, (r) => {
    assert.equal(r.gateBundle.status, 'error');
    assert.ok(r.gateBundle.fix.startsWith(`reinstall the global copy at ${D.global} in place`), r.gateBundle.fix);
  }],
  // Round-8 WR-02: the project root is GSD_HOME (or a symlink to it): one copy, in project scope.
  ['project root is GSD_HOME, one copy, engines (r7 homeproj)', { same: 'text', g: true, p: true, gInst: true, pInst: true, rows: [row(G)], reasons: [ENG] }, STATES.PROJECT_SKIPPED, null, (r) => {
    assert.equal(r.duplicate.status, 'ok');
  }],
  ['project root is GSD_HOME, no consent (r8 homeplain)', { same: 'text', g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P, 'inactive', NOCONSENT)] }, STATES.PROJECT_INACTIVE, null, (r) => {
    for (const k of ['loaded', 'gateBundle', 'consent']) assert.ok(r[k].fix.includes('re-consent') && r[k].fix.includes('--scope project'), `${k}: ${r[k].fix}`);
    assert.equal(r.duplicate.status, 'ok');
  }],
  ['GSD_HOME is a symlink to the project root, no consent (r8 homesym)', { same: 'alias', g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P, 'inactive', NOCONSENT)] }, STATES.PROJECT_INACTIVE, null, (r) => {
    assert.equal(r.duplicate.status, 'ok', JSON.stringify(r.duplicate));
    assert.match(r.loaded.fix, /re-consent/);
  }],
  ['project root is GSD_HOME, consented, gate rendered', { same: 'text', g: true, p: true, gInst: true, pInst: true, rows: [row(G), row(P)], hook: true }, STATES.PROJECT_LOADED, P, (r) => {
    assert.equal(r.gateBundle.status, 'ok', JSON.stringify(r.gateBundle));
  }],
  ['global engines plus a stray project gate.cjs (r7 globalplusstray)', { g: true, gInst: true, pGate: true, rows: [row(G, 'incompatible')], reasons: [ENG] }, STATES.GLOBAL_SKIPPED, null, (r, c) => {
    assert.equal(c.stray.dir, D.project);
  }],
  ['project install next to a planted global gate.cjs', { p: true, pInst: true, gGate: true, rows: [row(P)], hook: true }, STATES.PROJECT_LOADED, P, (r, c) => {
    assert.equal(c.stray.dir, D.global);
    assert.ok(r.gateBundle.fix.includes(`keep the installed project bundle at ${D.project}`), r.gateBundle.fix);
  }],
  // No render evidence: memanto disabled, or every render-hooks call failed. A hedged prediction at most.
  ['no render: hand-copied global plus project install (memanto disabled)', { g: true, p: true, pInst: true, rows: [row(P)], ran: false, enabled: false }, STATES.DISABLED, null, (r) => {
    assert.ok(r.gateBundle.message.includes("by the loader's precedence gsd-core would load memanto from"), r.gateBundle.message);
    assert.ok(r.gateBundle.message.includes('gsd-core scans the global copy first'), r.gateBundle.message);
    assert.ok(!r.gateBundle.message.includes('as colliding'), r.gateBundle.message);
  }],
  ['no render: global install, memanto disabled', { g: true, gInst: true, rows: [row(G)], ran: false, enabled: false }, STATES.DISABLED, null, (r) => {
    assert.equal(r.gateBundle.status, 'warn', JSON.stringify(r.gateBundle));
  }],
  ['no render: project install only, capability list unreadable', { p: true, pInst: true, rows: null, ran: false }, STATES.UNVERIFIED, null, (r) => {
    assert.ok(r.gateBundle.message.includes('no render-hooks call succeeded'), r.gateBundle.message);
  }],
  ['no render: unledgered project copy, capability list unreadable', { p: true, rows: null, ran: false }, STATES.UNVERIFIED, null],
  ['no render: global row incompatible, no project', { g: true, gInst: true, rows: [row(G, 'incompatible')], ran: false }, STATES.UNVERIFIED, null],
  ['no render: global incompatible, project not consented', { g: true, p: true, gInst: true, pInst: true, rows: [row(G, 'incompatible'), row(P, 'inactive', 'no user consent record')], ran: false }, STATES.UNVERIFIED, null, (r) => {
    assert.match(r.loaded.fix, /re-consent/);
  }],
];

test('every state of the closed enum is covered by the table', () => {
  const covered = new Set(CASES.map((c) => c[2]));
  assert.deepEqual([...covered].sort(), Object.values(STATES).sort());
});

for (const [name, o, state, loadedScope, extra] of CASES) {
  test(`classifyInstall: ${name} -> ${state}, and the four records agree`, () => {
    const r = raw(o);
    const cls = classifyInstall(evOf(r));
    assert.equal(cls.state, state, JSON.stringify(cls));
    const recs = installRecords(cls, OPTS);
    // doctor prints loaded only when memanto is enabled.
    assertConsistent([r.enabled ? recs.loaded : null, recs.consent, recs.duplicate, recs.gateBundle], factsOf(r, loadedScope), name);
    // The case's own loaded column agrees with the classifier.
    const scope = loadedScope === '?' ? null : loadedScope;
    assert.equal(cls.loaded ? cls.loaded.scope : null, scope, JSON.stringify(cls.loaded));
    // gate-bundle is ok exactly when the gate rendered from the copy that loaded,
    // the predicate runs that copy, and no stray gate code exists.
    const f = factsOf(r, loadedScope);
    const runsLoaded = Boolean(scope && r.gate && f.gateRunsDir && path.resolve(f.gateRunsDir) === path.resolve(f.dirs[scope]));
    assert.equal(recs.gateBundle.status === 'ok', !f.stray && runsLoaded, JSON.stringify(recs.gateBundle));
    if (extra) extra(recs, cls);
  });
}

// Round-8 WR-03 (mutation MD): duplicate-install must not say "neither" while
// loaded and gate-bundle say the global copy loaded.
test('the cross-record rule rejects duplicate-install saying neither while loaded names the global copy', () => {
  const r = raw({ g: true, p: true, gInst: true, pInst: true, gNoGate: true, rows: [row(G), row(P)], reasons: [COLL] });
  const recs = installRecords(classifyInstall(evOf(r)), OPTS);
  const bad = { ...recs.duplicate, message: recs.duplicate.message.replace(/gsd-core keeps the global one.*$/, 'gsd-core loaded neither of them (see loaded)') };
  assert.notEqual(bad.message, recs.duplicate.message);
  assert.throws(() => assertConsistent([recs.loaded, recs.consent, bad, recs.gateBundle], factsOf(r, G), 'MD'), /disagree on which copy loaded/);
});

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
