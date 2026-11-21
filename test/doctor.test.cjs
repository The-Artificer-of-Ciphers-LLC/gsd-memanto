'use strict';
// GATE-06 / D-17..D-21: `memanto doctor` through gsd_run and directly. Every
// case drives gsd-core's real host with a temp GSD_HOME; health endpoints are
// child-process fakes and a fake memanto sits first on PATH.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');
const { startFakeApi } = require('./helpers/fake-api.cjs');
const { installFakeMemanto } = require('./helpers/fake-memanto.cjs');

const servers = {};
let fakeCli;
let home;

before(async () => {
  servers.ok = await startFakeApi({ mode: 'ok' });
  fakeCli = installFakeMemanto();
  home = env.tmpDir('memanto-home-');
  env.installBundle({ home });
});

after(async () => {
  for (const s of Object.values(servers)) await s.close();
  env.cleanup();
});

function healthyConfig(extra = {}) {
  return {
    memanto: { enabled: true, agent_id: 'doctor-agent', backend_url: servers.ok.url, api_url: servers.ok.url },
    ...extra,
  };
}

function runEnv(extra) {
  return { PATH: fakeCli.pathEnv, FAKE_MEMANTO_LOG: fakeCli.logPath, ...(extra || {}) };
}

function globalBundle(h) {
  return path.join(h, '.gsd', 'capabilities', 'memanto');
}

// `gsd_run memanto doctor [--raw]` through the real host.
function viaGsd(project, { raw = true, h = home, extraEnv } = {}) {
  const args = ['memanto', 'doctor'];
  if (raw) args.push('--raw');
  return env.gsd(args, { cwd: project, home: h, env: runEnv(extraEnv) });
}

// `node <bundle>/memanto.cjs doctor [--raw]`, the form for not-loaded states.
function direct(project, { raw = true, h = home, bundle, extraEnv } = {}) {
  const file = path.join(bundle || globalBundle(h), 'memanto.cjs');
  const args = [file, 'doctor'];
  if (raw) args.push('--raw');
  const res = spawnSync(process.execPath, args, {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, GSD_HOME: h, GSD_WORKSTREAM: '', GSD_PROJECT: '', ...runEnv(extraEnv) },
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function report(res) {
  try {
    return JSON.parse(res.stdout);
  } catch {
    throw new Error(`doctor --raw stdout is not JSON (exit ${res.status}): ${res.stdout}\nstderr: ${res.stderr}`);
  }
}

function rec(rep, id) {
  return rep.checks.find((c) => c.id === id);
}

// --- Task 1: both forms, text and --raw contract, exit codes ---

test('gsd_run memanto doctor --raw on a healthy installed project exits 0 with ok gate checks', () => {
  const project = env.makeProject({ config: healthyConfig() });
  const res = viaGsd(project);
  assert.equal(res.status, 0, `exit ${res.status}: ${res.stdout}${res.stderr}`);
  const rep = report(res);
  assert.ok(Array.isArray(rep.checks), 'checks is not an array');
  for (const c of rep.checks) {
    assert.deepEqual(Object.keys(c).sort(), ['fix', 'id', 'message', 'status'], JSON.stringify(c));
    assert.ok(['ok', 'warn', 'error'].includes(c.status), JSON.stringify(c));
  }
  for (const id of ['agent-id', 'backend-health', 'api-health']) {
    assert.equal(rec(rep, id) && rec(rep, id).status, 'ok', `${id}: ${JSON.stringify(rec(rep, id))}`);
  }
  assert.deepEqual(rep.checks.filter((c) => c.status === 'error'), []);
});

test('doctor exits 1 with the gate agent-id error when memanto.agent_id is empty', () => {
  const project = env.makeProject({ config: healthyConfig({ memanto: { enabled: true, agent_id: '', backend_url: servers.ok.url, api_url: servers.ok.url } }) });
  const res = viaGsd(project);
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const r = rec(report(res), 'agent-id');
  assert.equal(r.status, 'error');
  assert.equal(r.message, 'memanto.agent_id is empty');
  assert.equal(r.fix, 'gsd_run config-set memanto.agent_id <agent-id>');
});

test('the direct form reports the same check ids as the gsd_run form', () => {
  const project = env.makeProject({ config: healthyConfig() });
  const a = report(viaGsd(project)).checks.map((c) => c.id);
  const b = report(direct(project)).checks.map((c) => c.id);
  assert.deepEqual(b, a);
});

test('text output: one status line per check, fix lines under non-ok checks, summary and direct form', () => {
  const project = env.makeProject({ config: healthyConfig({ memanto: { enabled: true, agent_id: '', backend_url: servers.ok.url, api_url: servers.ok.url } }) });
  const res = viaGsd(project, { raw: false });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const lines = res.stdout.split('\n').filter((l) => l !== '');
  const rep = report(viaGsd(project));
  for (const c of rep.checks) {
    const i = lines.findIndex((l) => /^(ok|warn|error)\s/.test(l) && l.split(/\s+/)[1] === c.id);
    assert.ok(i !== -1, `no status line for ${c.id}:\n${res.stdout}`);
    assert.ok(lines[i].startsWith(c.status), lines[i]);
    if (c.status !== 'ok') assert.match(lines[i + 1], /^\s+fix: /, `no fix line under ${c.id}`);
  }
  assert.ok(lines.some((l) => /^memanto doctor: \d+ error\(s\), \d+ warning\(s\)$/.test(l)), res.stdout);
  assert.ok(lines.some((l) => l.includes('memanto.cjs" doctor')), res.stdout);
});

test('an unknown subcommand exits 1 with a usage message naming doctor', () => {
  const project = env.makeProject({ config: healthyConfig() });
  const res = env.gsd(['memanto', 'nope'], { cwd: project, home, env: runEnv() });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  assert.match(res.stdout + res.stderr, /doctor/);
});
