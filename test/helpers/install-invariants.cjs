'use strict';
// Round-7: consistency rules for the four doctor install records (loaded,
// consent, duplicate-install, gate-bundle). Used by the classifier table test
// (test/install-state.test.cjs) and by the doctor repros
// (test/gate-bundle.test.cjs), so a state the table does not list is still
// checked when a repro reaches it.

const assert = require('node:assert/strict');
const path = require('node:path');

const CLAIMS = ['gsd-core loads the', 'gsd-core loads memanto from', 'gsd-core keeps the global one', 'loads the project one', 'gsd-core loaded the global memanto copy', 'runs the installed bundle gsd-core loads'];

// records: the record objects present (missing ones skipped).
// facts: { stray: dir|null, twoCopies: bool, installedDirs: [dir], loaded: bool|null }
function assertConsistent(records, facts, label = '') {
  const list = records.filter(Boolean);
  const at = (r) => `${label} ${r.id}: ${JSON.stringify(r)}`;
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
  if (!facts.twoCopies) {
    for (const r of list) {
      assert.ok(!/\bneither\b/.test(r.message), `${at(r)} says neither with one copy`);
      assert.ok(!/installed in both/.test(r.message), `${at(r)} says both with one copy`);
    }
  }
  // A fix never deletes an installed bundle.
  for (const r of list) {
    for (const m of r.fix.matchAll(/\bdelete (\S+)/g)) {
      const dir = m[1];
      for (const keep of facts.installedDirs || []) {
        assert.notEqual(path.resolve(dir), path.resolve(keep), `${at(r)} deletes the installed bundle ${keep}`);
      }
    }
  }
  // Stray or planted gate code is always reported by gate-bundle, by directory.
  const gb = list.find((r) => r.id === 'gate-bundle');
  if (facts.stray && gb) {
    assert.equal(gb.status, 'error', at(gb));
    assert.ok(gb.message.includes(facts.stray), `${at(gb)} does not name the stray ${facts.stray}`);
    assert.ok(gb.fix.includes(`delete ${facts.stray}`), `${at(gb)} does not say to delete ${facts.stray}`);
  }
  // Nothing claims a load when no copy loaded.
  if (facts.loaded === false) {
    for (const r of list) for (const c of CLAIMS) assert.ok(!r.message.includes(c), `${at(r)} claims a loaded copy (${c})`);
  }
  // loaded and gate-bundle agree: an error in loaded is an error in gate-bundle.
  const loaded = list.find((r) => r.id === 'loaded');
  if (loaded && gb && loaded.status === 'error') assert.equal(gb.status, 'error', `${label} loaded is an error but gate-bundle is ${gb.status}: ${gb.message}`);
}

module.exports = { assertConsistent };
