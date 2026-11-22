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

// --- Round-2 IN-02: no temp directory is left behind on a failure path ---

function memantoEntries(dir) {
  return fs.readdirSync(dir).filter((n) => n.startsWith('memanto-'));
}

test('a failed install into a fresh temp home removes that home and the staging copy', () => {
  const tmp = env.tmpDir('memanto-tmpdir-');
  const noCore = env.tmpDir('memanto-nocore-');
  const res = spawnSync(process.execPath, [SCRIPT, '--json'], {
    cwd: env.REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, TMPDIR: tmp, GSD_CORE_DIR: noCore, GSD_WORKSTREAM: '', GSD_PROJECT: '' },
  });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /stage-bundle: /);
  assert.deepEqual(memantoEntries(tmp), [], `left behind in ${tmp}`);
});

for (const [label, make] of [
  ['a symlink', (repo) => fs.symlinkSync('a.txt', path.join(repo, 'b'))],
  ['a non-regular file', (repo) => fs.mkdirSync(path.join(repo, 'b'))],
]) {
  test(`staging refuses ${label} and removes its staging root`, () => {
    const { stage, StageError } = require('../tools/stage-bundle.cjs');
    const repo = env.tmpDir('memanto-fakerepo-');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    make(repo);
    const tmpRoot = env.tmpDir('memanto-tmpdir-');
    assert.throws(
      () => stage({ repoRoot: repo, files: ['a.txt', 'b'], tmpRoot }),
      (e) => e instanceof StageError && /refusing to stage/.test(e.message),
    );
    assert.deepEqual(fs.readdirSync(tmpRoot), [], 'staging root left behind');
  });
}
