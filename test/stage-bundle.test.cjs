'use strict';
// IN-08: tools/stage-bundle.cjs leaves no temp directory behind that nobody
// owns. After an install the staging copy is deleted (the scope directory holds
// the installed bundle). Directories the caller must keep (the --stage-only
// output, a fresh temp GSD_HOME) are named in a `cleanup` list. Every install
// goes to a temp GSD_HOME.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');

const SCRIPT = path.join(env.REPO_ROOT, 'tools', 'stage-bundle.cjs');
const owned = [];

after(() => {
  for (const dir of owned) fs.rmSync(dir, { recursive: true, force: true });
  env.cleanup();
});

function stage(args) {
  const res = spawnSync(process.execPath, [SCRIPT, ...args, '--json'], {
    cwd: env.REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, GSD_WORKSTREAM: '', GSD_PROJECT: '' },
  });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  for (const dir of out.cleanup || []) owned.push(dir);
  return out;
}

test('an install into --home deletes its staging directory and leaves nothing to clean up', () => {
  const home = env.tmpDir('memanto-home-');
  const out = stage(['--home', home]);
  assert.equal(out.install.status, 'installed', JSON.stringify(out));
  assert.equal(fs.existsSync(path.dirname(out.stagedDir)), false, `staging root left behind: ${out.stagedDir}`);
  assert.deepEqual(out.cleanup, []);
  assert.ok(fs.existsSync(path.join(home, '.gsd', 'capabilities', 'memanto', 'capability.json')), 'bundle not installed');
});

test('an install into a fresh temp home deletes the staging directory and names the home for cleanup', () => {
  const out = stage([]);
  assert.equal(out.install.status, 'installed', JSON.stringify(out));
  assert.equal(fs.existsSync(path.dirname(out.stagedDir)), false, `staging root left behind: ${out.stagedDir}`);
  assert.deepEqual(out.cleanup, [out.home]);
  assert.ok(fs.existsSync(out.home), 'the temp home is the install target and must be kept');
});

test('--stage-only keeps the staged directory and names its root for cleanup', () => {
  const out = stage(['--stage-only']);
  assert.ok(fs.existsSync(path.join(out.stagedDir, 'capability.json')), JSON.stringify(out));
  assert.deepEqual(out.cleanup, [path.dirname(out.stagedDir)]);
});
