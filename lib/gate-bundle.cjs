'use strict';
// CR-01: which bundle the discuss:pre predicate runs. The predicate in
// capability.json carries an inline copy of this rule, because it must decide
// before it runs any code from a bundle directory. Doctor uses this module to
// report the same decision (check gate-bundle). Keep the two in step;
// test/gate-bundle.test.cjs drives both through the real host.
//
// A scope root (the GSD_HOME for global scope, the project root for project
// scope) holds an installed bundle only when BOTH are true:
//   - <root>/.gsd/capabilities/memanto/capability.json is a regular file whose id is "memanto"
//   - <root>/.gsd-capabilities.json is a regular file (the scope's capability ledger) with a
//     committed entries.memanto (an object with id "memanto" and no _pending intent)
// gsd-core keeps the global copy when both scopes hold one, so the global root
// is tried first. No installed bundle in either scope means the gate blocks.

const fs = require('node:fs');
const path = require('node:path');

const BUNDLE_REL = path.join('.gsd', 'capabilities', 'memanto');
const LEDGER = '.gsd-capabilities.json';

// Regular files only: a FIFO or device would block the read.
function readJsonFile(file) {
  if (!fs.statSync(file).isFile()) throw new Error(`${file} is not a regular file`);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function isInstalledBundle(root) {
  if (!root) return false;
  try {
    const entry = readJsonFile(path.join(root, LEDGER)).entries.memanto;
    if (!entry || typeof entry !== 'object' || '_pending' in entry || entry.id !== 'memanto') return false;
    return readJsonFile(path.join(root, BUNDLE_REL, 'capability.json')).id === 'memanto';
  } catch {
    return false;
  }
}

// The bundle directory the predicate runs scripts/gate.cjs from, or null when
// it blocks because neither scope holds an installed bundle.
function resolveGateBundle({ gsdHome, projectRoot }) {
  for (const root of [gsdHome, projectRoot]) {
    if (isInstalledBundle(root)) return path.join(root, BUNDLE_REL);
  }
  return null;
}

module.exports = { isInstalledBundle, resolveGateBundle, BUNDLE_REL, LEDGER };
