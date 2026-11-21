'use strict';
// Gate check set driven through gsd-core's real host: staged bundle -> global
// install into a temp GSD_HOME -> loop render-hooks discuss:pre -> check predicate.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const env = require('./helpers/gsd-env.cjs');
const { startFakeApi } = require('./helpers/fake-api.cjs');
const { installFakeMemanto } = require('./helpers/fake-memanto.cjs');
const checks = require('../lib/checks.cjs');

const BREAK_GLASS = '(memanto.enabled=false disables Memanto for this project)';
const PHASE_DIR = '.planning/phases/01-test';
const PREFIX = 'command exited 1: ';
const servers = {};

let home;
let project;
let predicate;
let fakeCli;

before(async () => {
  for (const mode of ['ok', 'ok-extra', 'http-500', 'hang', 'closed']) {
    servers[mode] = await startFakeApi({ mode });
  }
  fakeCli = installFakeMemanto();
  home = env.tmpDir('memanto-home-');
  project = env.makeProject({ config: { memanto: { enabled: true, agent_id: '' } }, phaseDirs: ['01-test'] });
  env.installBundle({ home });
  const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home }));
  assert.equal(hooks.length, 1, 'expected exactly one memanto gate at discuss:pre');
  predicate = hooks[0].check.predicate;
});

after(async () => {
  for (const s of Object.values(servers)) await s.close();
  env.cleanup();
});

// Base config for a case: memanto enabled, everything else from `memanto`/`extra`.
// Every gate run has the fake memanto first on PATH (TEST-02).
function runGate({ memanto = {}, extra = {} } = {}) {
  env.writeConfig(project, { memanto: { enabled: true, ...memanto }, ...extra });
  const res = env.checkPredicate(predicate, {
    cwd: project,
    home,
    phaseDir: PHASE_DIR,
    phaseNumber: '01',
    env: { PATH: fakeCli.pathEnv, FAKE_MEMANTO_LOG: fakeCli.logPath },
  });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  const message = res.json.message || '';
  const body = message.startsWith(PREFIX) ? message.slice(PREFIX.length) : message;
  const lines = body.trimEnd().split('\n').filter((l) => l !== '');
  const blocked = lines.filter((l) => l.startsWith('memanto: BLOCKED ['));
  const ids = blocked.map((l) => l.slice('memanto: BLOCKED ['.length, l.indexOf(']')));
  return { block: res.json.block, message, lines, blocked, ids };
}

function lineFor(result, id) {
  return result.blocked.find((l) => l.startsWith(`memanto: BLOCKED [${id}]`));
}

// --- GATE-03 / D-06: MemPalace mutual exclusion (strict === true) ---

test('mempalace.enabled boolean true blocks with a [mempalace] line naming Memanto and MemPalace', () => {
  const r = runGate({ memanto: { agent_id: '' }, extra: { mempalace: { enabled: true } } });
  assert.equal(r.block, true);
  const line = lineFor(r, 'mempalace');
  assert.ok(line, `no [mempalace] line: ${r.message}`);
  assert.ok(line.includes('Memanto') && line.includes('MemPalace'), line);
  assert.ok(line.includes('-> gsd_run config-set mempalace.enabled false'), line);
});

for (const [label, mempalace] of [
  ['the string "true"', { enabled: 'true' }],
  ['the string "TRUE"', { enabled: 'TRUE' }],
  ['the number 1', { enabled: 1 }],
  ['the string "yes"', { enabled: 'yes' }],
  ['null', { enabled: null }],
  ['false', { enabled: false }],
  ['an empty mempalace object', {}],
]) {
  test(`mempalace.enabled as ${label} produces no [mempalace] line`, () => {
    const r = runGate({ memanto: { agent_id: '' }, extra: { mempalace } });
    assert.equal(r.block, true, 'the empty agent_id still blocks, proving the gate ran');
    assert.equal(lineFor(r, 'mempalace'), undefined, r.message);
    assert.ok(lineFor(r, 'agent-id'), r.message);
  });
}

test('an absent mempalace key produces no [mempalace] line', () => {
  const r = runGate({ memanto: { agent_id: '' } });
  assert.equal(lineFor(r, 'mempalace'), undefined, r.message);
});

// --- CONF-02: agent_id edge cases ---

for (const [label, memanto, expected] of [
  ['the empty string', { agent_id: '' }, 'memanto.agent_id is empty'],
  ['three spaces', { agent_id: '   ' }, 'memanto.agent_id is empty'],
  ['Unicode whitespace only (U+00A0 U+2003)', { agent_id: '  ' }, 'memanto.agent_id is empty'],
  ['an absent key', {}, 'memanto.agent_id is empty'],
  ['null', { agent_id: null }, 'memanto.agent_id must be a string'],
  ['the number 42', { agent_id: 42 }, 'memanto.agent_id must be a string'],
]) {
  test(`memanto.agent_id as ${label} blocks with an [agent-id] line`, () => {
    const r = runGate({ memanto });
    assert.equal(r.block, true);
    const line = lineFor(r, 'agent-id');
    assert.ok(line, `no [agent-id] line: ${r.message}`);
    assert.ok(line.startsWith(`memanto: BLOCKED [agent-id] ${expected} -> `), line);
  });
}

test('memanto.agent_id with leading or trailing whitespace blocks and never echoes the value', () => {
  const r = runGate({ memanto: { agent_id: ' dev-agent ' } });
  assert.equal(r.block, true);
  const line = lineFor(r, 'agent-id');
  assert.ok(line, `no [agent-id] line: ${r.message}`);
  assert.ok(line.includes('memanto.agent_id has leading or trailing whitespace'), line);
  assert.ok(!r.message.includes('dev-agent'), `agent id value echoed: ${r.message}`);
});

// --- D-04: every check evaluated, fixed order, break-glass last ---

test('mempalace true plus empty agent_id prints exactly [mempalace] then [agent-id], break-glass last', () => {
  const r = runGate({
    memanto: { agent_id: '', backend_url: servers.ok.url, api_url: servers.ok.url },
    extra: { mempalace: { enabled: true } },
  });
  assert.equal(r.block, true);
  assert.deepEqual(r.ids, ['mempalace', 'agent-id'], r.message);
  assert.equal(r.lines.length, 3, r.message);
  assert.equal(r.lines.at(-1), BREAK_GLASS);
});

test('agent_id set, both endpoints healthy and mempalace not true: the gate passes', () => {
  const r = runGate({
    memanto: { agent_id: 'gate-agent', backend_url: servers.ok.url, api_url: servers.ok.url },
    extra: { mempalace: { enabled: false } },
  });
  assert.equal(r.block, false, r.message);
});

// --- D-04 budget: the host keeps the HEAD 2000 characters, so break-glass must survive ---

function longUrl(base) {
  return base.replace('http://', 'http://user:pass@') + '/' + 'x'.repeat(5000);
}

test('every check failing with 5000-character userinfo URLs fits the 2000-character clip, break-glass last', () => {
  const r = runGate({
    memanto: { agent_id: '', backend_url: longUrl(servers.closed.url), api_url: longUrl(servers.closed.url) },
    extra: { mempalace: { enabled: true } },
  });
  assert.equal(r.block, true);
  assert.deepEqual(r.ids, ['mempalace', 'agent-id', 'backend-health', 'api-health'], r.message);
  assert.ok(r.message.length <= 2000, `message length ${r.message.length}`);
  assert.equal(r.message.trimEnd().split('\n').at(-1), BREAK_GLASS);
  assert.ok(!r.message.includes('user:pass@'), 'userinfo leaked');
  for (const line of r.blocked) assert.ok(line.length <= 250, `line length ${line.length}: ${line}`);
});

test('renderGateFailures keeps every line at most 250 characters and the total at most 1900', () => {
  const huge = 'v'.repeat(5000);
  const records = checks.CHECK_ORDER.map((id) => ({ id, status: 'error', message: huge, fix: huge }));
  const text = checks.renderGateFailures(records);
  const lines = text.split('\n');
  assert.equal(lines.length, checks.CHECK_ORDER.length + 1);
  for (const line of lines) assert.ok(line.length <= 250, `line length ${line.length}`);
  assert.ok(text.length <= 1900, `total ${text.length}`);
  assert.equal(lines.at(-1), checks.BREAK_GLASS);
});

test('a hanging backend costs one 5 s probe: verdict in under 8 s, only [backend-health], one request each', () => {
  const hangBefore = servers.hang.requests.length;
  const okBefore = servers['ok-extra'].requests.length;
  const started = Date.now();
  const r = runGate({ memanto: { agent_id: 'gate-agent', backend_url: servers.hang.url, api_url: servers['ok-extra'].url } });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 8000, `took ${elapsed} ms`);
  assert.deepEqual(r.ids, ['backend-health'], r.message);
  assert.ok(r.blocked[0].includes('is not healthy (timeout)'), r.message);
  assert.deepEqual(servers.hang.requests.slice(hangBefore), [{ method: 'GET', url: '/health' }]);
  assert.deepEqual(servers['ok-extra'].requests.slice(okBefore), [{ method: 'GET', url: '/health' }]);
});

test('health response bodies never reach the gate message', () => {
  const r = runGate({ memanto: { agent_id: '', backend_url: servers['ok-extra'].url, api_url: servers['http-500'].url } });
  assert.equal(r.block, true);
  assert.deepEqual(r.ids, ['agent-id', 'api-health'], r.message);
  for (const secret of ['secret-model', 'secret-provider', '"status"']) {
    assert.ok(!r.message.includes(secret), `${secret} leaked: ${r.message}`);
  }
});

// --- TEST-02: no memanto process is spawned by the gate in Phase 1 ---

test('the fake memanto double records invocations (so zero calls below is meaningful)', () => {
  const probe = installFakeMemanto();
  const res = require('node:child_process').spawnSync('memanto', ['--version'], {
    env: { ...process.env, PATH: probe.pathEnv, FAKE_MEMANTO_LOG: probe.logPath, FAKE_MEMANTO_EXIT: '3' },
    encoding: 'utf8',
  });
  assert.equal(res.status, 3);
  assert.deepEqual(probe.calls(), [['--version']]);
});

test('no gate run in this file spawned the memanto CLI', () => {
  assert.equal(fakeCli.calls().length, 0, JSON.stringify(fakeCli.calls()));
});
