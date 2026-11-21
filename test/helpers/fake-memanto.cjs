'use strict';
// Fake `memanto` executable on a temp PATH (TEST-02). Every invocation appends
// its argv as one JSON line to $FAKE_MEMANTO_LOG and exits with
// $FAKE_MEMANTO_EXIT (default 0). Tests put it first on PATH to prove which
// memanto calls the capability makes (in Phase 1: none).

const fs = require('node:fs');
const path = require('node:path');
const { tmpDir } = require('./gsd-env.cjs');

const SCRIPT = [
  '#!/usr/bin/env node',
  "'use strict';",
  "const fs = require('node:fs');",
  'if (process.env.FAKE_MEMANTO_LOG) {',
  "  fs.appendFileSync(process.env.FAKE_MEMANTO_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');",
  '}',
  "process.exit(Number(process.env.FAKE_MEMANTO_EXIT || '0'));",
  '',
].join('\n');

function installFakeMemanto() {
  const root = tmpDir('memanto-fakecli-');
  const binDir = path.join(root, 'bin');
  fs.mkdirSync(binDir);
  const exe = path.join(binDir, 'memanto');
  fs.writeFileSync(exe, SCRIPT, { mode: 0o755 });
  fs.chmodSync(exe, 0o755);
  const logPath = path.join(root, 'memanto-calls.jsonl');
  fs.writeFileSync(logPath, '');
  const pathEnv = `${binDir}${path.delimiter}${process.env.PATH || ''}`;
  function calls() {
    return fs
      .readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l));
  }
  return { binDir, logPath, pathEnv, calls };
}

module.exports = { installFakeMemanto };
