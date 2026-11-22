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

// --- Task 2: the four fail-open states (D-21, OD-3), duplicates, discuss bypass ---

function projectInstall(project, h) {
  const res = spawnSync(
    process.execPath,
    [path.join(env.REPO_ROOT, 'tools', 'stage-bundle.cjs'), '--scope', 'project', '--project', project, '--home', h, '--json'],
    { cwd: env.REPO_ROOT, encoding: 'utf8', env: { ...process.env, GSD_WORKSTREAM: '', GSD_PROJECT: '' } },
  );
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  assert.equal(JSON.parse(res.stdout).install.status, 'installed', res.stdout);
  return path.join(project, '.gsd', 'capabilities', 'memanto');
}

function editInstalledManifest(h, edit) {
  const file = path.join(globalBundle(h), 'capability.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(manifest);
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
}

function hostVersion() {
  const res = env.gsd(['runtime-identity', '--raw'], { home: env.tmpDir('memanto-home-') });
  return JSON.parse(res.stdout).version;
}

test('enabled with no bundle installed in the temp home: loaded is an error and doctor exits 1', () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: healthyConfig() });
  const res = direct(project, { h, bundle: env.REPO_ROOT });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const r = rec(report(res), 'loaded');
  assert.ok(r, res.stdout);
  assert.equal(r.status, 'error', JSON.stringify(r));
  assert.ok(r.fix.includes('capability install'), r.fix);
  assert.ok(!r.fix.includes('config-set'), r.fix);
});

test('project-scope install then capability trust revoke: consent is an error naming the missing consent record', () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: healthyConfig() });
  const bundle = projectInstall(project, h);
  const revoked = env.gsd(['capability', 'trust', 'revoke', 'memanto'], { cwd: project, home: h });
  assert.equal(revoked.status, 0, revoked.stderr);
  const res = direct(project, { h, bundle });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const rep = report(res);
  const consent = rec(rep, 'consent');
  assert.ok(consent, res.stdout);
  assert.equal(consent.status, 'error', JSON.stringify(consent));
  assert.match(consent.message, /consent record/);
  assert.equal(rec(rep, 'loaded').status, 'error');
});

test('a hand-copied global bundle with no ledger entry: consent error naming the ledger, gsd_run answers Unknown command', () => {
  const h = env.tmpDir('memanto-home-');
  fs.cpSync(env.stageBundle(), globalBundle(h), { recursive: true });
  const project = env.makeProject({ config: healthyConfig() });
  const routed = viaGsd(project, { h });
  assert.match(routed.stdout + routed.stderr, /Unknown command/);
  const res = direct(project, { h });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const consent = rec(report(res), 'consent');
  assert.equal(consent.status, 'error', JSON.stringify(consent));
  assert.match(consent.message, /ledger/);
});

test('an installed manifest edited to engines.gsd ">=9.0.0": engines error naming the host version and the range', () => {
  const h = env.tmpDir('memanto-home-');
  env.installBundle({ home: h });
  editInstalledManifest(h, (m) => {
    m.engines.gsd = '>=9.0.0';
  });
  const project = env.makeProject({ config: healthyConfig() });
  const res = direct(project, { h });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const engines = rec(report(res), 'engines');
  assert.equal(engines.status, 'error', JSON.stringify(engines));
  assert.ok(engines.message.includes(hostVersion()), engines.message);
  assert.ok(engines.message.includes('>=9.0.0'), engines.message);
});

test('an installed manifest with a gate when on an undeclared key: render:discuss:pre error with the host reason', () => {
  const h = env.tmpDir('memanto-home-');
  env.installBundle({ home: h });
  editInstalledManifest(h, (m) => {
    m.gates[0].when = 'memanto.nope';
  });
  const project = env.makeProject({ config: healthyConfig() });
  const res = direct(project, { h });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const render = rec(report(res), 'render:discuss:pre');
  assert.ok(render, res.stdout);
  assert.equal(render.status, 'error', JSON.stringify(render));
  assert.ok(render.message.includes('memanto.nope'), render.message);
  assert.ok(render.message.length <= 450, `message length ${render.message.length}`);
});

test('bundles installed in both global and project scope: duplicate-install is a warning', () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: healthyConfig() });
  env.installBundle({ home: h });
  projectInstall(project, h);
  const res = viaGsd(project, { h });
  const dup = rec(report(res), 'duplicate-install');
  assert.ok(dup, res.stdout);
  assert.equal(dup.status, 'warn', JSON.stringify(dup));
});

test('workflow.discuss_mode "assumptions": discuss-bypass warns naming discuss_mode', () => {
  const project = env.makeProject({ config: healthyConfig({ workflow: { discuss_mode: 'assumptions' } }) });
  const res = viaGsd(project);
  const r = rec(report(res), 'discuss-bypass');
  assert.ok(r, res.stdout);
  assert.equal(r.status, 'warn', JSON.stringify(r));
  assert.match(r.message, /discuss_mode/);
});

test('default discuss mode: discuss-bypass warns naming --power and --assumptions, and a warn-only report exits 0', () => {
  const project = env.makeProject({ config: healthyConfig() });
  const res = viaGsd(project);
  assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
  const rep = report(res);
  const r = rec(rep, 'discuss-bypass');
  assert.ok(r, res.stdout);
  assert.equal(r.status, 'warn', JSON.stringify(r));
  assert.ok(r.message.includes('--power') && r.message.includes('--assumptions'), r.message);
  for (const id of ['gsd-core-located', 'enabled', 'loaded', 'consent', 'engines', 'render:discuss:pre', 'duplicate-install', 'gate-bundle']) {
    assert.equal(rec(rep, id) && rec(rep, id).status, 'ok', `${id}: ${JSON.stringify(rec(rep, id))}`);
  }
});

test('no reachable gsd-tools: gsd-core-located is an error and config and gate checks are still reported', () => {
  const empty = env.tmpDir('memanto-nocore-');
  const project = env.makeProject({ config: healthyConfig() });
  const res = direct(project, {
    extraEnv: { GSD_CORE_DIR: empty, CLAUDE_CONFIG_DIR: empty, OPENCODE_CONFIG_DIR: empty },
  });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const rep = report(res);
  assert.ok(rec(rep, 'gsd-core-located'), res.stdout);
  assert.equal(rec(rep, 'gsd-core-located').status, 'error');
  assert.equal(rec(rep, 'enabled').status, 'ok');
  assert.equal(rec(rep, 'agent-id').status, 'ok');
  assert.equal(rec(rep, 'api-health').status, 'ok');
});

test('memanto.enabled not true: enabled warns and the loaded, render and gate checks are skipped', () => {
  const project = env.makeProject({ config: { memanto: { enabled: false } } });
  const res = viaGsd(project, { raw: true });
  const rep = report(res);
  assert.ok(rec(rep, 'enabled'), res.stdout);
  assert.equal(rec(rep, 'enabled').status, 'warn');
  for (const id of ['loaded', 'render:discuss:pre', 'agent-id']) assert.equal(rec(rep, id), undefined, id);
});

// --- IN-03: doctor neutralises the Unicode line and paragraph separators too ---

test('a GSD_CORE_DIR holding U+2028 and U+2029 is echoed without line separators', () => {
  const core = path.join(env.tmpDir('memanto-nocore-'), 'a\u2028b\u2029c');
  const project = env.makeProject({ config: healthyConfig() });
  const res = direct(project, { extraEnv: { GSD_CORE_DIR: core } });
  const r = rec(report(res), 'gsd-core-located');
  assert.equal(r.status, 'error', JSON.stringify(r));
  assert.ok(r.message.includes('a?b?c'), JSON.stringify(r.message));
  assert.ok(!/[\u2028\u2029]/.test(res.stdout), 'raw output carries a line separator');
  const text = direct(project, { raw: false, extraEnv: { GSD_CORE_DIR: core } });
  assert.ok(!/[\u2028\u2029]/.test(text.stdout), 'text output carries a line separator');
});

// --- WR-03: an invalid GSD_PROJECT is reported as an environment problem ---

test('an invalid GSD_PROJECT: enabled warns naming the variable and config-unreadable says to unset it', () => {
  const project = env.makeProject({ config: healthyConfig() });
  const res = direct(project, { extraEnv: { GSD_PROJECT: '../x' } });
  assert.equal(res.status, 1, `${res.stdout}${res.stderr}`);
  const rep = report(res);
  const enabled = rec(rep, 'enabled');
  assert.equal(enabled.status, 'warn', JSON.stringify(enabled));
  assert.match(enabled.message, /GSD_PROJECT/, enabled.message);
  assert.ok(!/config file/.test(enabled.fix), enabled.fix);
  const unreadable = rec(rep, 'config-unreadable');
  assert.ok(unreadable, res.stdout);
  assert.match(unreadable.message, /^GSD_PROJECT is invalid/, unreadable.message);
  assert.match(unreadable.fix, /^unset GSD_PROJECT/, unreadable.fix);
});

// --- Post-merge owner fix 1: the check-probe spawn is time-bounded ---

test('PROBE_TIMEOUT_MS bounds the check-probe spawn at 15000 ms', () => {
  const doctor = require('../memanto.cjs');
  assert.equal(doctor.PROBE_TIMEOUT_MS, 15000);
});

test('a check probe that never exits yields a check-probe error with a timeout reason instead of hanging doctor', () => {
  const doctor = require('../memanto.cjs');
  assert.equal(typeof doctor.gateChecks, 'function', 'memanto.cjs does not export gateChecks(cwd, { probe, timeoutMs })');
  const dir = env.tmpDir('memanto-hang-');
  const probe = path.join(dir, 'hang-probe.cjs');
  fs.writeFileSync(probe, 'setInterval(() => {}, 1000);\n');
  const started = Date.now();
  const checks = doctor.gateChecks(dir, { probe, timeoutMs: 300 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 10000, `gateChecks took ${elapsed} ms`);
  assert.equal(checks.length, 1, JSON.stringify(checks));
  const [r] = checks;
  assert.equal(r.id, 'check-probe');
  assert.equal(r.status, 'error');
  assert.match(r.message, /timed out after 300 ms/);
  assert.ok(r.fix.length > 0, 'check-probe timeout has no fix hint');
});
