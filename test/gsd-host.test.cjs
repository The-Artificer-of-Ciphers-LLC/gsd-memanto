'use strict';
// lib/gsd-host.cjs locateGsdTools search order (owner decision, 2026-11-20).
// With GSD_CORE_DIR unset, the user config homes are searched before the
// project-local candidates, so a cloned repo cannot plant a gsd-tools.cjs that
// doctor runs first. GSD_CORE_DIR, when set, still wins outright. Each case
// runs locateGsdTools in a child process with a temp HOME, because
// os.homedir() reads HOME.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');

const HOST_LIB = path.join(env.REPO_ROOT, 'lib', 'gsd-host.cjs');

after(() => env.cleanup());

// A gsd-tools.cjs stub that proves the gsd-core identity and names its origin.
function plantStub(root, origin) {
  const dir = path.join(root, 'gsd-core', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'gsd-tools.cjs');
  fs.writeFileSync(
    file,
    `process.stdout.write(JSON.stringify({ packageName: '@opengsd/gsd-core', version: ${JSON.stringify(origin)} }) + '\\n');\n`,
  );
  return file;
}

function locate({ home, project, extraEnv = {} }) {
  const childEnv = { PATH: process.env.PATH, HOME: home, ...extraEnv };
  const script = `const h = require(${JSON.stringify(HOST_LIB)});
process.stdout.write(JSON.stringify(h.locateGsdTools({ env: process.env, projectRoot: ${JSON.stringify(project)} })));`;
  const res = spawnSync(process.execPath, ['-e', script], { cwd: project, env: childEnv, encoding: 'utf8' });
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  return JSON.parse(res.stdout);
}

function dirs() {
  return { home: env.tmpDir('memanto-host-home-'), project: env.tmpDir('memanto-host-proj-') };
}

test('with GSD_CORE_DIR unset, ~/.claude/gsd-core is used before a project-planted gsd-core', () => {
  const { home, project } = dirs();
  const homeStub = plantStub(path.join(home, '.claude'), 'home-claude');
  plantStub(project, 'project-root');
  plantStub(path.join(project, '.claude'), 'project-claude');
  const located = locate({ home, project });
  assert.equal(located.ok, true, JSON.stringify(located));
  assert.equal(located.version, 'home-claude', JSON.stringify(located));
  assert.equal(fs.realpathSync(located.tools), fs.realpathSync(homeStub));
});

test('with GSD_CORE_DIR unset, the opencode config home is also used before a project-planted gsd-core', () => {
  const { home, project } = dirs();
  plantStub(path.join(home, '.config', 'opencode'), 'home-opencode');
  plantStub(path.join(project, '.claude'), 'project-claude');
  const located = locate({ home, project });
  assert.equal(located.version, 'home-opencode', JSON.stringify(located));
});

test('GSD_CORE_DIR, when set, wins over the config homes and the project', () => {
  const { home, project } = dirs();
  const core = env.tmpDir('memanto-host-core-');
  plantStub(core, 'core-dir');
  plantStub(path.join(home, '.claude'), 'home-claude');
  plantStub(project, 'project-root');
  const located = locate({ home, project, extraEnv: { GSD_CORE_DIR: path.join(core, 'gsd-core') } });
  assert.equal(located.version, 'core-dir', JSON.stringify(located));
});

// --- WR-01: every host spawn is time-bounded by the shared PROBE_TIMEOUT_MS ---

function hangingTools() {
  const dir = path.join(env.tmpDir('memanto-host-hang-'), 'gsd-core', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'gsd-tools.cjs');
  fs.writeFileSync(file, 'setInterval(() => {}, 1000);\n');
  return file;
}

test('lib/gsd-host.cjs bounds host spawns with the same PROBE_TIMEOUT_MS that memanto.cjs exports', () => {
  const host = require(HOST_LIB);
  assert.equal(host.PROBE_TIMEOUT_MS, 15000);
  assert.equal(require('../memanto.cjs').PROBE_TIMEOUT_MS, host.PROBE_TIMEOUT_MS);
});

for (const [label, call] of [
  ['runtime-identity', (h, tools) => h.hostIdentity(tools, { timeoutMs: 300 })],
  ['capability list', (h, tools) => h.capabilityList(tools, { cwd: path.dirname(tools), timeoutMs: 300 })],
  ['loop render-hooks', (h, tools) => h.renderHooksAt(tools, 'discuss:pre', { cwd: path.dirname(tools), timeoutMs: 300 })],
]) {
  test(`a gsd-tools that never exits makes ${label} fail with a timeout instead of hanging doctor`, () => {
    const host = require(HOST_LIB);
    const tools = hangingTools();
    const started = Date.now();
    const res = call(host, tools);
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 10000, `${label} took ${elapsed} ms`);
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.match(res.reason, /timed out after 300 ms/, JSON.stringify(res));
  });
}

// --- WR-02: doctor never executes a project-planted gsd-tools.cjs ---

// A stub that records that it was executed, so "not run" is observable.
function plantRecordingStub(root, marker) {
  const file = plantStub(root, 'planted');
  fs.writeFileSync(
    file,
    `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran');\n` +
      `process.stdout.write(JSON.stringify({ packageName: '@opengsd/gsd-core', version: 'planted' }) + '\\n');\n`,
  );
  return file;
}

test('a project-planted gsd-tools.cjs is never executed or located, even with no gsd-core anywhere else', () => {
  const { home, project } = dirs();
  const markers = [path.join(home, 'ran-root'), path.join(home, 'ran-claude')];
  plantRecordingStub(project, markers[0]);
  plantRecordingStub(path.join(project, '.claude'), markers[1]);
  const located = locate({ home, project });
  assert.equal(located.ok, false, JSON.stringify(located));
  for (const m of markers) assert.equal(fs.existsSync(m), false, `planted stub ran: ${m}`);
  for (const t of located.tried) assert.ok(!t.path.startsWith(project), `project candidate tried: ${t.path}`);
});

test('GSD_CORE_DIR wins outright: when it fails identity no other candidate is tried', () => {
  const { home, project } = dirs();
  const core = env.tmpDir('memanto-host-core-');
  plantStub(path.join(home, '.claude'), 'home-claude');
  const located = locate({ home, project, extraEnv: { GSD_CORE_DIR: path.join(core, 'gsd-core') } });
  assert.equal(located.ok, false, JSON.stringify(located));
  assert.deepEqual(
    located.tried.map((t) => t.path),
    [path.join(core, 'gsd-core', 'bin', 'gsd-tools.cjs')],
    JSON.stringify(located),
  );
});

for (const [label, rel, extraEnv] of [
  ['~/.codex', ['.codex'], {}],
  ['CODEX_HOME', ['custom-codex'], { CODEX_HOME: 'custom-codex' }],
  ['~/.gemini/antigravity', ['.gemini', 'antigravity'], {}],
  ['~/.cursor', ['.cursor'], {}],
  ['~/.copilot', ['.copilot'], {}],
]) {
  test(`with GSD_CORE_DIR unset, a gsd-core under the ${label} runtime home is located`, () => {
    const { home, project } = dirs();
    const resolvedEnv = {};
    for (const [k, v] of Object.entries(extraEnv)) resolvedEnv[k] = path.join(home, v);
    plantStub(path.join(home, ...rel), `runtime-${label}`);
    const located = locate({ home, project, extraEnv: resolvedEnv });
    assert.equal(located.ok, true, JSON.stringify(located));
    assert.equal(located.version, `runtime-${label}`, JSON.stringify(located));
  });
}
