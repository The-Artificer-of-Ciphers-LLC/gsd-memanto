#!/usr/bin/env node
'use strict';
// npm test runner (dev only, not shipped). Runs every test/**/*.test.cjs through
// the TAP reporter, passes the report through unchanged, and fails when the run
// fails or when one test or fewer ran (D-13: a suite that silently discovers
// nothing must not pass).

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

const res = spawnSync(process.execPath, ['--test', '--test-reporter=tap', 'test/**/*.test.cjs'], {
  cwd: REPO_ROOT,
  stdio: ['ignore', 'pipe', 'inherit'],
  encoding: 'utf8',
  maxBuffer: 256 * 1024 * 1024,
});

if (res.error) {
  process.stderr.write(`run-tests: failed to start node --test: ${res.error.message}\n`);
  process.exit(1);
}

const stdout = res.stdout || '';
process.stdout.write(stdout);

let count = null;
for (const line of stdout.split('\n')) {
  const m = /^# tests (\d+)\s*$/.exec(line);
  if (m) count = Number(m[1]);
}

if (res.status !== 0) {
  process.stderr.write(`run-tests: node --test exited ${res.status === null ? res.signal : res.status}\n`);
  process.exit(1);
}
if (count === null || count <= 1) {
  process.stdout.write(`expected more than one test, got ${count === null ? 0 : count}\n`);
  process.exit(1);
}
