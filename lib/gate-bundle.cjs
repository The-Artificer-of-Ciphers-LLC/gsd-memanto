'use strict';
// CR-01: which bundle the discuss:pre predicate runs. The predicate in
// capability.json carries an inline copy of this rule, because it must decide
// before it runs any code from a bundle directory. Doctor uses this module to
// report the same decision (check gate-bundle). test/gate-bundle.test.cjs runs
// both over the same fixture matrix and fails when they disagree (IN-04).
//
// A scope root (the GSD_HOME for global scope, the project root for project
// scope) holds an installed bundle only when BOTH are true:
//   - <root>/.gsd/capabilities/memanto/capability.json is a regular file whose id is "memanto"
//   - <root>/.gsd-capabilities.json is a regular file (the scope's capability ledger) with a
//     committed entries.memanto: an object with id "memanto", no _pending intent, string
//     version, source and integrity, and files and sharedEdits arrays (the shape gsd-core's
//     isValidLedgerEntry requires)
//
// Selection follows gsd-core, which loads a global bundle even when no ledger
// lists it, and keeps the global copy when both scopes hold one:
//   - a global capability.json exists: the gate came from global, so run global
//     when it is installed and block otherwise. Never fall back to the project
//     copy (round-2 CR-01: a repo-planted project ledger and bundle would run).
//   - no global capability.json: gsd-core can only have loaded the project
//     bundle, which it activates only with a user consent record. Run it when
//     it is installed, block otherwise.

const fs = require('node:fs');
const path = require('node:path');
const { readRegularFile, MANIFEST_MAX_BYTES, LEDGER_MAX_BYTES } = require('./safe-read.cjs');

const BUNDLE_REL = path.join('.gsd', 'capabilities', 'memanto');
const LEDGER = '.gsd-capabilities.json';

// Round-9 CR-01: regular files under a size cap only (lib/safe-read.cjs). A
// FIFO, device or oversized file throws instead of blocking or reading unbounded.
function readJsonFile(file, maxBytes) {
  const r = readRegularFile(file, maxBytes);
  if (!r.ok) throw new Error(r.reason);
  return JSON.parse(r.text);
}

const manifestFile = (root) => path.join(root, BUNDLE_REL, 'capability.json');
const ledgerFile = (root) => path.join(root, LEDGER);

function isCommittedEntry(e) {
  return (
    !!e &&
    typeof e === 'object' &&
    !Object.hasOwn(e, '_pending') &&
    e.id === 'memanto' &&
    typeof e.version === 'string' &&
    typeof e.source === 'string' &&
    typeof e.integrity === 'string' &&
    Array.isArray(e.files) &&
    Array.isArray(e.sharedEdits)
  );
}

function isInstalledBundle(root) {
  if (!root) return false;
  try {
    const e = readJsonFile(ledgerFile(root), LEDGER_MAX_BYTES).entries.memanto;
    if (!isCommittedEntry(e)) return false;
    return readJsonFile(manifestFile(root), MANIFEST_MAX_BYTES).id === 'memanto';
  } catch {
    return false;
  }
}

// True when <root>/.gsd/capabilities/memanto/capability.json exists in any form
// (fs.existsSync, as the predicate uses): gsd-core then treats that scope as
// holding a memanto bundle.
function hasManifest(root) {
  return !!root && fs.existsSync(path.join(root, BUNDLE_REL, 'capability.json'));
}

// The bundle directory the predicate runs scripts/gate.cjs from, or null when
// it blocks with [gate-bundle].
function resolveGateBundle({ gsdHome, projectRoot }) {
  if (hasManifest(gsdHome)) return isInstalledBundle(gsdHome) ? path.join(gsdHome, BUNDLE_REL) : null;
  return isInstalledBundle(projectRoot) ? path.join(projectRoot, BUNDLE_REL) : null;
}

// Round-10 WR-01: the ledger file read as JSON: { state: 'absent' }, { state:
// 'unreadable', r } (it exists but cannot be read, or is not valid JSON), or
// { state: 'ok', ledger }. ENOTDIR (the root is not a directory) is absent.
function readLedger(root) {
  const r = readRegularFile(ledgerFile(root), LEDGER_MAX_BYTES);
  if (r.absent || (!r.ok && r.code === 'ENOTDIR')) return { state: 'absent' };
  if (!r.ok) return { state: 'unreadable', r };
  try {
    return { state: 'ok', ledger: JSON.parse(r.text) };
  } catch (e) {
    return { state: 'unreadable', r: { code: 'EINVALJSON', reason: `${ledgerFile(root)} is not valid JSON (${e.message})`, what: 'not valid JSON' } };
  }
}

// Round-8 WR-01: the ledger state on its own, separate from the manifest.
// 'committed': a committed entries.memanto; 'pending': an entry with an
// _pending intent (an interrupted install or upgrade); 'unreadable': the
// ledger exists but cannot be read (a FIFO, no permission, over the cap, not
// valid JSON), so whether it lists memanto is unknown (round-10 WR-01: never
// "no entry"); 'none': no ledger, or one with no memanto entry.
function ledgerState(root) {
  if (!root) return 'none';
  const l = readLedger(root);
  if (l.state === 'absent') return 'none';
  if (l.state === 'unreadable') return 'unreadable';
  const entries = l.ledger && typeof l.ledger === 'object' ? l.ledger.entries : null;
  const e = entries && typeof entries === 'object' ? entries.memanto : undefined;
  // Round-9 IN-02: pending only for a truthy _pending, as the loader decides
  // (ledgerOverlayIds); a present but falsy one is neither (isCommittedEntry
  // rejects any _pending key, as isCommittedLedgerEntry does).
  if (e && typeof e === 'object' && e._pending) return 'pending';
  return isCommittedEntry(e) ? 'committed' : 'none';
}

// The parsed capability.json when it is a regular file with id "memanto", else null.
function readManifest(root) {
  if (!root) return null;
  try {
    const m = readJsonFile(manifestFile(root), MANIFEST_MAX_BYTES);
    return m && m.id === 'memanto' ? m : null;
  } catch {
    return null;
  }
}

// Round-10 WR-02: why a file cannot be read, which decides its remedy.
// 'permission': EACCES/EPERM (restore the permission, keep the file);
// 'nonregular': a FIFO, socket, device, directory or symlink, never a real
// capability.json or ledger (remove it); 'oversized': over the cap (inspect
// and restore it); 'other': any other error.
function causeOf(r) {
  if (r.code === 'EINVALJSON') return 'invalid';
  if (r.symlink || r.code === 'ENOTREG') return 'nonregular';
  if (r.code === 'EFBIG') return 'oversized';
  if (r.code === 'EACCES' || r.code === 'EPERM') return 'permission';
  return 'other';
}

// Round-9 CR-01: the scope's capability.json and ledger when they exist but
// cannot be read as a regular file under the cap, as
// [{ file, kind, reason, cause, what }]. Round-10 WR-01: a ledger that is not
// valid JSON is listed too (ledgerState 'unreadable'). A missing file, or a
// capability.json with invalid JSON (a broken install, see loaded), is not.
function unreadableFiles(root) {
  if (!root) return [];
  const out = [];
  const r = readRegularFile(manifestFile(root), MANIFEST_MAX_BYTES);
  // ENOTDIR: a parent path is a file, so there is no file here to read.
  if (!r.ok && !r.absent && r.code !== 'ENOTDIR') out.push({ file: manifestFile(root), kind: 'manifest', reason: r.reason, cause: causeOf(r), what: r.what || '' });
  const l = readLedger(root);
  if (l.state === 'unreadable') out.push({ file: ledgerFile(root), kind: 'ledger', reason: l.r.reason, cause: causeOf(l.r), what: l.r.what || '' });
  return out;
}

module.exports = { isInstalledBundle, hasManifest, resolveGateBundle, ledgerState, readManifest, unreadableFiles, BUNDLE_REL, LEDGER };
