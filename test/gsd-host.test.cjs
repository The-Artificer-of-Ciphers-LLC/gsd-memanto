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

test('with no gsd-core in any config home, the project-local candidates are still searched', () => {
  const { home, project } = dirs();
  plantStub(path.join(project, '.claude'), 'project-claude');
  const located = locate({ home, project });
  assert.equal(located.version, 'project-claude', JSON.stringify(located));
});
