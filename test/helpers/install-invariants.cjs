'use strict';
// Round-7/8: consistency rules for the four doctor install records (loaded,
// consent, duplicate-install, gate-bundle). Used by the classifier table test
// (test/install-state.test.cjs) and by the doctor repros
// (test/gate-bundle.test.cjs), so a state the table does not list is still
// checked when a repro reaches it.
//
// Round-8 WR-03: the facts never come from the classifier. The table derives
// them from the raw evidence and the case definition; the doctor tests derive
// them from the disk and from a render-hooks call of their own. A rule whose
// fact is undefined is skipped.

const assert = require('node:assert/strict');
const path = require('node:path');

const SCOPES = ['global', 'project'];

// The copy each record message says gsd-core loaded: 'global', 'project',
// 'none' ("loaded neither"), or a directory. Hedged predictions ("would load")
// and negations ("did not load", "does not activate") are not claims.
const SCOPE_CLAIMS = [
  /gsd-core (?:loads|loaded|keeps) the (global|project) (?:memanto )?(?:copy|one)\b/g,
  /\bloads the (global|project) one\b/g,
];
const DIR_CLAIMS = [/gsd-core loads memanto from (\S+?)[,;)]?(?:\s|$)/g, /gsd-core loads the bundle at (\S+?)[,;)]?(?:\s|$)/g, /runs the installed bundle gsd-core loads \((\S+?)\)/g];

function claimsOf(message, dirs) {
  const out = new Set();
  if (/\bloaded neither\b/.test(message)) out.add('none');
  for (const re of SCOPE_CLAIMS) for (const m of message.matchAll(re)) out.add(m[1]);
  for (const re of DIR_CLAIMS) {
    for (const m of message.matchAll(re)) {
      const dir = path.resolve(m[1]);
      const hits = dirs ? SCOPES.filter((s) => dirs[s] && path.resolve(dirs[s]) === dir) : [];
      // One directory for both scopes names no scope by itself.
      if (hits.length === 1) out.add(hits[0]);
      else if (hits.length === 0) out.add(dir);
    }
  }
  return out;
}

// records: the record objects present (missing ones skipped).
// facts (all optional):
//   stray: dir|null              gate.cjs in a directory no ledger lists
//   twoCopies: bool              two physically distinct copies hold a capability.json
//   ledgeredDirs: [dir]          directories some ledger lists (committed or _pending)
//   installedDirs: [dir]         alias of ledgeredDirs (round 7)
//   dirs: {global, project}      the scope bundle directories
//   enabled: bool                memanto.enabled as doctor reads it
//   gateRendered: bool           the memanto gate rendered at discuss:pre
//   loadedScope: 'global'|'project'|null|'?'   which copy loaded, from the case
//                                definition; null: none; '?': doctor cannot know
//   loaded: bool                 round-7 form of loadedScope (false: none loaded)
//   gateRunsDir: dir|null        the bundle the discuss:pre predicate runs
//   onlyScope: 'global'|'project'  the scope of the one copy on disk
//   unledgeredDirs: [dir]        copies on disk that no ledger lists
//   rowsKnown: bool              capability list was readable
function assertConsistent(records, facts = {}, label = '') {
  const list = records.filter(Boolean);
  const at = (r) => `${label} ${r.id}: ${JSON.stringify(r)}`;
  const byId = (id) => list.find((r) => r.id === id);
  for (const r of list) {
    assert.ok(['ok', 'warn', 'error'].includes(r.status), at(r));
    if (r.status !== 'ok') assert.ok(r.fix && r.fix.length > 0, `${at(r)} has no fix`);
    for (const bad of ['undefined', 'null', '[object Object]']) {
      assert.ok(!r.message.includes(bad) && !r.fix.includes(bad), `${at(r)} prints ${bad}`);
    }
  }
  // No record offers a plain reinstall while another says a reinstall or
  // removal does not clear the error.
  if (list.some((r) => /does not clear it/.test(r.fix))) {
    for (const r of list) {
      if (/reinstall|capability install/.test(r.fix) && !/does not clear it/.test(r.fix)) {
        assert.ok(/ownership clash/.test(r.fix), `${at(r)} offers a reinstall that another record says does not help`);
      }
    }
  }
  // "neither" / "both" only with two distinct copies on disk.
  if (facts.twoCopies === false) {
    for (const r of list) {
      assert.ok(!/\bneither\b/.test(r.message), `${at(r)} says neither with one copy`);
      assert.ok(!/installed in both/.test(r.message), `${at(r)} says both with one copy`);
    }
  }
  // A fix never deletes a directory a ledger lists (it is reinstalled in place).
  const keepDirs = [...(facts.ledgeredDirs || []), ...(facts.installedDirs || [])];
  for (const r of list) {
    for (const m of r.fix.matchAll(/\bdelete (\S+)/g)) {
      for (const keep of keepDirs) {
        assert.notEqual(path.resolve(m[1]), path.resolve(keep), `${at(r)} deletes the ledgered bundle ${keep}`);
      }
    }
  }
  // Stray or planted gate code is always reported by gate-bundle, by directory,
  // and nothing else is ever called stray.
  const gb = byId('gate-bundle');
  const loaded = byId('loaded');
  if (facts.stray && gb) {
    assert.equal(gb.status, 'error', at(gb));
    assert.ok(gb.message.includes(facts.stray), `${at(gb)} does not name the stray ${facts.stray}`);
    assert.ok(gb.fix.includes(`delete ${facts.stray}`), `${at(gb)} does not say to delete ${facts.stray}`);
  }
  if (facts.stray === null) {
    for (const r of list) assert.ok(!/stray or planted/.test(r.message + r.fix), `${at(r)} calls a copy stray, but no unledgered gate code exists`);
  }
  // Round-8 CR-01: positive evidence only. Without the memanto gate rendering
  // at discuss:pre, loaded and gate-bundle are never ok, and with memanto
  // enabled they are errors (fail closed).
  if (facts.gateRendered === false) {
    for (const r of [loaded, gb].filter(Boolean)) {
      assert.notEqual(r.status, 'ok', `${at(r)} is ok, but no memanto gate renders at discuss:pre`);
      if (facts.enabled !== false) assert.equal(r.status, 'error', `${at(r)} is not an error, but no memanto gate renders at discuss:pre`);
    }
  }
  // loaded and gate-bundle agree: an error in loaded is an error in gate-bundle,
  // and gate-bundle is ok only when loaded is.
  if (loaded && gb && loaded.status === 'error') assert.equal(gb.status, 'error', `${label} loaded is an error but gate-bundle is ${gb.status}: ${gb.message}`);
  if (loaded && gb && gb.status === 'ok') assert.equal(loaded.status, 'ok', `${label} gate-bundle is ok but loaded is ${loaded.status}: ${loaded.message}`);

  // Round-8 WR-03: every record names the same loaded copy, or none does.
  const claims = new Map();
  for (const r of list) for (const c of claimsOf(r.message, facts.dirs)) claims.set(c, [...(claims.get(c) || []), r.id]);
  const named = [...claims.keys()];
  assert.ok(named.length <= 1, `${label} the records disagree on which copy loaded: ${JSON.stringify(Object.fromEntries(claims))}`);
  const expected = facts.loadedScope !== undefined ? facts.loadedScope : facts.loaded === false ? null : undefined;
  if (expected === null || expected === '?') {
    for (const c of named.filter((x) => x !== 'none' || expected === '?')) {
      assert.fail(`${label} ${claims.get(c).join(', ')} claim gsd-core loaded ${c}, but ${expected === null ? 'no copy loaded' : 'doctor cannot tell which copy loaded'}`);
    }
  } else if (expected) {
    for (const c of named) {
      const ok = c === expected || (facts.dirs && path.resolve(c) === path.resolve(facts.dirs[expected]));
      assert.ok(ok, `${label} ${claims.get(c).join(', ')} claim gsd-core loaded ${c}, but the ${expected} copy loaded`);
    }
  }
  // gate-bundle is ok only when the predicate runs the copy that loaded.
  if (gb && expected && expected !== '?' && facts.dirs && facts.gateRunsDir !== undefined) {
    const runsLoaded = Boolean(facts.gateRunsDir) && path.resolve(facts.gateRunsDir) === path.resolve(facts.dirs[expected]);
    if (!runsLoaded) assert.equal(gb.status, 'error', `${at(gb)} is not an error, but the gate runs ${facts.gateRunsDir} and gsd-core loaded the ${expected} copy`);
  }
  if (gb && gb.status === 'ok' && expected && expected !== '?' && facts.dirs && facts.gateRunsDir !== undefined) {
    assert.equal(path.resolve(facts.gateRunsDir || ''), path.resolve(facts.dirs[expected]), `${at(gb)} is ok, but the gate does not run the loaded copy`);
  }
  // Consent and loaded give compatible fixes: re-consent in one means re-consent in the other.
  const consent = byId('consent');
  if (consent && loaded && loaded.status !== 'ok' && /re-consent/.test(consent.fix)) {
    assert.ok(/re-consent/.test(loaded.fix), `${at(loaded)} does not re-consent, but consent says only re-consent activates the copy: ${consent.fix}`);
  }
  // A copy on disk that no ledger lists is never consent ok (when capability list was read).
  if (consent && facts.rowsKnown && (facts.unledgeredDirs || []).length) {
    assert.notEqual(consent.status, 'ok', `${at(consent)} is ok, but no ledger lists ${facts.unledgeredDirs.join(', ')}`);
  }
  // With one copy on disk, no record talks about a copy in the other scope.
  if (facts.onlyScope) {
    const other = facts.onlyScope === 'global' ? 'project' : 'global';
    const re = new RegExp(`\\b${other} (?:memanto )?(?:copy|install|bundle|one)\\b`);
    for (const r of list) assert.ok(!re.test(r.message) && !re.test(r.fix), `${at(r)} names a ${other} copy, but the only copy is in ${facts.onlyScope} scope`);
  }
}

module.exports = { assertConsistent, claimsOf };
