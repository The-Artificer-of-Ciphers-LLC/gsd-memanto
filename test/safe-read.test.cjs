'use strict';
// Round-9 CR-01: every file doctor and the gate's lib code read from a project
// or capability directory goes through lib/safe-read.cjs. A FIFO, socket,
// device, directory, or a symlink to one is unreadable with a reason, and so is
// a file over the size cap. Nothing blocks. The doctor cases use a temp
// GSD_HOME and a closed local port; mkfifo cases are skipped on win32.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync, execFileSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');
const { readRegularFile, readJsonOrNull, plainReadBlocks, MANIFEST_MAX_BYTES, LEDGER_MAX_BYTES } = require('../lib/safe-read.cjs');
const gateBundle = require('../lib/gate-bundle.cjs');

const POSIX = process.platform !== 'win32';
const DEAD = 'http://127.0.0.1:9';
// The doctor run must finish well inside this; it is a test bound, not a product timeout.
const FAST_MS = 5000;

after(() => env.cleanup());

function fifo(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  execFileSync('mkfifo', [file]);
  return file;
}

test('readRegularFile reads a small regular file and reports a missing one as absent', () => {
  const d = env.tmpDir('memanto-sr-');
  const f = path.join(d, 'a.json');
  fs.writeFileSync(f, '{"a":1}');
  assert.deepEqual(readRegularFile(f, 100), { ok: true, absent: false, text: '{"a":1}' });
  assert.deepEqual(readJsonOrNull(f, 100), { a: 1 });
  const missing = readRegularFile(path.join(d, 'nope.json'), 100);
  assert.equal(missing.ok, false);
  assert.equal(missing.absent, true);
  assert.equal(readJsonOrNull(path.join(d, 'nope.json'), 100), null);
});

test('readRegularFile refuses a file over the cap without reading it', () => {
  const d = env.tmpDir('memanto-sr-');
  const f = path.join(d, 'big.json');
  fs.writeFileSync(f, 'x'.repeat(101));
  const r = readRegularFile(f, 100);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'EFBIG');
  assert.ok(r.reason.includes(`${f} is unreadable`) && r.reason.includes('100-byte limit'), r.reason);
  assert.ok(MANIFEST_MAX_BYTES >= 64 * 1024 && LEDGER_MAX_BYTES >= MANIFEST_MAX_BYTES);
});

test('readRegularFile refuses a directory', () => {
  const d = env.tmpDir('memanto-sr-');
  const r = readRegularFile(d, 100);
  assert.equal(r.ok, false);
  assert.equal(r.absent, false);
  assert.match(r.reason, /a directory, not a regular file/);
});

test('readRegularFile follows a symlink to a regular file and refuses a dangling one', () => {
  const d = env.tmpDir('memanto-sr-');
  const f = path.join(d, 'real.json');
  fs.writeFileSync(f, '{}');
  fs.symlinkSync(f, path.join(d, 'link.json'));
  assert.equal(readRegularFile(path.join(d, 'link.json'), 100).ok, true);
  fs.symlinkSync(path.join(d, 'gone'), path.join(d, 'dangling.json'));
  const r = readRegularFile(path.join(d, 'dangling.json'), 100);
  assert.equal(r.ok, false);
  assert.equal(r.absent, false);
});

test('readRegularFile refuses a FIFO, a symlink to a FIFO and a symlink to a device without blocking', { skip: !POSIX && 'mkfifo is POSIX only' }, () => {
  const d = env.tmpDir('memanto-sr-');
  const f = fifo(path.join(d, 'fifo.json'));
  const t0 = Date.now();
  const r = readRegularFile(f, 100);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'ENOTREG');
  assert.match(r.reason, /it is a FIFO, not a regular file/);
  fs.symlinkSync(f, path.join(d, 'tofifo.json'));
  assert.match(readRegularFile(path.join(d, 'tofifo.json'), 100).reason, /a symlink to a FIFO/);
  fs.symlinkSync('/dev/zero', path.join(d, 'zero.json'));
  assert.match(readRegularFile(path.join(d, 'zero.json'), 100).reason, /a symlink to a device/);
  assert.ok(Date.now() - t0 < FAST_MS);
});

// In a child process with a kill timeout: a regression would block forever in-process.
test('the gate lib code never blocks on a FIFO manifest, ledger or config.json', { skip: !POSIX && 'mkfifo is POSIX only' }, () => {
  const root = env.tmpDir('memanto-sr-');
  fifo(path.join(root, '.gsd', 'capabilities', 'memanto', 'capability.json'));
  fifo(path.join(root, '.gsd-capabilities.json'));
  fifo(path.join(root, '.planning', 'config.json'));
  const script = `
    const gb = require(${JSON.stringify(path.join(env.REPO_ROOT, 'lib', 'gate-bundle.cjs'))});
    const { resolveConfig } = require(${JSON.stringify(path.join(env.REPO_ROOT, 'lib', 'config.cjs'))});
    const root = process.argv[1];
    const cfg = resolveConfig({ cwd: root, env: {} });
    process.stdout.write(JSON.stringify({
      manifest: gb.readManifest(root), ledger: gb.ledgerState(root), installed: gb.isInstalledBundle(root),
      runs: gb.resolveGateBundle({ gsdHome: root, projectRoot: root }), cfg: { ok: cfg.ok, kind: cfg.kind, error: cfg.error },
    }));`;
  const t0 = Date.now();
  const res = spawnSync(process.execPath, ['-e', script, root], { encoding: 'utf8', timeout: FAST_MS, killSignal: 'SIGKILL' });
  assert.equal(res.error, undefined, `the lib code blocked: ${res.error && res.error.code} after ${Date.now() - t0} ms`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.manifest, null);
  // Round-10 WR-01: a FIFO ledger is unreadable, never "no ledger entry".
  assert.equal(out.ledger, 'unreadable');
  assert.equal(out.installed, false);
  assert.equal(out.runs, null);
  assert.equal(out.cfg.ok, false);
  assert.equal(out.cfg.kind, 'read');
  assert.match(out.cfg.error, /it is a FIFO, not a regular file/);
});

test('the gate lib code refuses an oversized manifest', () => {
  const root = env.tmpDir('memanto-sr-');
  const dir = path.join(root, '.gsd', 'capabilities', 'memanto');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'capability.json'), `{"id":"memanto","pad":"${'x'.repeat(MANIFEST_MAX_BYTES)}"}`);
  assert.equal(gateBundle.readManifest(root), null);
});

function doctorRun(project, h, extra = {}) {
  const g = path.join(h, '.gsd', 'capabilities', 'memanto');
  const t0 = Date.now();
  const d = spawnSync(process.execPath, [path.join(g, 'memanto.cjs'), 'doctor', '--raw'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, GSD_HOME: h, GSD_WORKSTREAM: '', GSD_PROJECT: '', ...extra },
    timeout: 30000,
    killSignal: 'SIGKILL',
  });
  return { ms: Date.now() - t0, d };
}

// The reviewer's r9f.cjs: a repo-planted FIFO at the project capability.json
// next to a legitimate global install.
test('r9f: a FIFO at the project capability.json does not hang doctor and is reported as unreadable', { skip: !POSIX && 'mkfifo is POSIX only' }, () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: { memanto: { enabled: true, agent_id: 'x', backend_url: DEAD, api_url: DEAD } }, phaseDirs: ['01-test'] });
  env.installBundle({ home: h });
  const file = fifo(path.join(project, '.gsd', 'capabilities', 'memanto', 'capability.json'));
  const { ms, d } = doctorRun(project, h);
  assert.equal(d.error, undefined, `doctor did not finish: ${d.error && d.error.code} after ${ms} ms`);
  assert.ok(ms < FAST_MS, `doctor took ${ms} ms`);
  assert.equal(d.status, 1, d.stdout + d.stderr);
  const rep = JSON.parse(d.stdout);
  const r = rep.checks.find((c) => c.id === 'unreadable-files');
  assert.ok(r, JSON.stringify(rep.checks.map((c) => c.id)));
  assert.equal(r.status, 'error', JSON.stringify(r));
  assert.ok(r.message.includes(`${file} is unreadable: it is a FIFO, not a regular file`), r.message);
  assert.ok(r.fix.includes(file), r.fix);
});

// Round-10 IN-01: gsd-core reads .planning/config.json with a plain blocking
// read (verified against the host: a FIFO and /dev/zero block it, a
// directory, a socket and /dev/null fail or end at once). plainReadBlocks
// says which of these would block that read.
test('plainReadBlocks: only a FIFO, or a device that never ends, blocks a plain read', { skip: !POSIX && 'mkfifo is POSIX only' }, async (t) => {
  const d = env.tmpDir('memanto-sr-');
  const f = fifo(path.join(d, 'fifo.json'));
  fs.symlinkSync(f, path.join(d, 'tofifo.json'));
  fs.symlinkSync('/dev/zero', path.join(d, 'zero.json'));
  fs.symlinkSync('/dev/null', path.join(d, 'null.json'));
  fs.mkdirSync(path.join(d, 'dir.json'));
  fs.writeFileSync(path.join(d, 'file.json'), '{}');
  const sock = path.join(d, 's.sock');
  const srv = require('node:net').createServer();
  await new Promise((r) => srv.listen(sock, r));
  t.after(() => srv.close());
  const t0 = Date.now();
  assert.equal(plainReadBlocks(f, 100), 'fifo');
  assert.equal(plainReadBlocks(path.join(d, 'tofifo.json'), 100), 'fifo');
  assert.equal(plainReadBlocks(path.join(d, 'zero.json'), 100), 'device');
  for (const name of ['null.json', 'dir.json', 'file.json', 's.sock', 'missing.json']) assert.equal(plainReadBlocks(path.join(d, name), 100), null, name);
  assert.ok(Date.now() - t0 < FAST_MS);
});

function configProject(h, make) {
  const project = env.makeProject({ phaseDirs: ['01-test'] });
  env.installBundle({ home: h });
  const file = path.join(project, '.planning', 'config.json');
  fs.rmSync(file, { force: true });
  make(file);
  return { project, file };
}

// Round-10 IN-01 (reviewer's r10h.cjs cfgdir): a directory does not block
// gsd-core, so doctor queries it and reports the actual condition.
for (const [mode, make] of [
  ['a directory', (f) => fs.mkdirSync(f)],
  ['a symlink to /dev/null', (f) => fs.symlinkSync('/dev/null', f)],
]) {
  test(`a .planning/config.json that is ${mode} is reported as it is, and doctor still queries gsd-core`, { skip: !POSIX && 'POSIX device files' }, () => {
    const h = env.tmpDir('memanto-home-');
    const { project, file } = configProject(h, make);
    const { ms, d } = doctorRun(project, h);
    assert.equal(d.error, undefined, `doctor did not finish: ${d.error && d.error.code} after ${ms} ms`);
    const rep = JSON.parse(d.stdout);
    const cu = rep.checks.find((c) => c.id === 'config-unreadable');
    assert.ok(cu && cu.message.includes(file) && cu.message.includes(mode === 'a directory' ? 'it is a directory, not a regular file' : 'a symlink to a device'), JSON.stringify(cu));
    for (const c of rep.checks) assert.ok(!/blocks reading|did not query gsd-core/.test(c.message), `${c.id}: ${c.message}`);
    assert.ok(rep.checks.some((c) => c.id === 'render:discuss:pre'), JSON.stringify(rep.checks.map((c) => c.id)));
  });
}

test('a .planning/config.json that is a symlink to /dev/zero is not read by gsd-core either; doctor says why', { skip: !POSIX && 'POSIX device files' }, () => {
  const h = env.tmpDir('memanto-home-');
  const { project, file } = configProject(h, (f) => fs.symlinkSync('/dev/zero', f));
  const { ms, d } = doctorRun(project, h);
  assert.equal(d.error, undefined, `doctor did not finish: ${d.error && d.error.code} after ${ms} ms`);
  assert.ok(ms < FAST_MS, `doctor took ${ms} ms`);
  const rep = JSON.parse(d.stdout);
  const cl = rep.checks.find((c) => c.id === 'capability-list');
  assert.ok(cl && cl.message.includes(`doctor did not query gsd-core (capability list, render-hooks): ${file} is unreadable`), JSON.stringify(cl));
  assert.ok(cl.message.includes('never ends'), cl.message);
  assert.ok(!rep.checks.some((c) => c.id.startsWith('render:')), JSON.stringify(rep.checks.map((c) => c.id)));
});

test('a FIFO at .planning/config.json does not hang doctor; config-unreadable names it', { skip: !POSIX && 'mkfifo is POSIX only' }, () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ phaseDirs: ['01-test'] });
  env.installBundle({ home: h });
  const file = path.join(project, '.planning', 'config.json');
  fs.rmSync(file, { force: true });
  fifo(file);
  const { ms, d } = doctorRun(project, h);
  assert.equal(d.error, undefined, `doctor did not finish: ${d.error && d.error.code} after ${ms} ms`);
  assert.ok(ms < FAST_MS, `doctor took ${ms} ms`);
  const rep = JSON.parse(d.stdout);
  const r = rep.checks.find((c) => c.id === 'config-unreadable');
  assert.ok(r, JSON.stringify(rep.checks.map((c) => c.id)));
  assert.equal(r.status, 'error', JSON.stringify(r));
  assert.match(r.message, /FIFO/);
  // Round-10 IN-01: only here does gsd-core really block, and doctor says so.
  const cl = rep.checks.find((c) => c.id === 'capability-list');
  assert.ok(cl && cl.message.includes('doctor did not query gsd-core') && cl.message.includes('a FIFO, which blocks until a writer opens it'), JSON.stringify(cl));
});
