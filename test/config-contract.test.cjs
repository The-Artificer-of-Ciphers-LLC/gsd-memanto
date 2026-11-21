'use strict';
// D-05 contract (CONF-01, CONF-02, CONF-03, T-01-11): the gate's resolver
// (lib/config.cjs) must report the same memanto.* values as the installed
// host's `config-get`, and the memanto gate must render at discuss:pre exactly
// when the resolver says memanto.enabled is the boolean true. Each row runs the
// real host in a temp GSD_HOME with the same cwd and env the resolver sees, so
// this fails the moment gsd-core changes how it resolves these keys.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./helpers/gsd-env.cjs');
const { resolveConfig } = require('../lib/config.cjs');

const MEMANTO_KEYS = ['memanto.enabled', 'memanto.agent_id', 'memanto.backend_url', 'memanto.api_url'];

let home;

before(() => {
  home = env.tmpDir('memanto-home-');
  env.installBundle({ home });
});

after(() => env.cleanup());

// files: { '<dir under .planning, "" for root>': object | raw string }
function project(files) {
  const dir = env.makeProject({});
  for (const [rel, content] of Object.entries(files || {})) {
    const file = path.join(dir, '.planning', rel, 'config.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2) + '\n');
  }
  return dir;
}

// config-get without --raw prints JSON, so the string "true" and the boolean
// true stay distinct (--raw prints both as `true`).
function configGet(key, { cwd, rowEnv, gsdHome }) {
  const res = env.gsd(['config-get', key], { cwd, home: gsdHome || home, env: rowEnv });
  if (res.status !== 0) return { ok: false, status: res.status, stderr: res.stderr };
  const text = res.stdout.trim();
  return { ok: true, value: text === '' ? '' : JSON.parse(text) };
}

function resolver(cwd, rowEnv) {
  return resolveConfig({ cwd, env: { GSD_WORKSTREAM: '', GSD_PROJECT: '', ...(rowEnv || {}) } });
}

function discussGateCount(cwd, rowEnv, gsdHome) {
  return env.memantoHooks(env.renderHooks('discuss:pre', { cwd, home: gsdHome || home, env: rowEnv })).length;
}

function assertParity(cwd, rowEnv, expected, gsdHome) {
  const res = resolver(cwd, rowEnv);
  assert.equal(res.ok, true, `resolver failed: ${JSON.stringify(res)}`);
  for (const key of MEMANTO_KEYS) {
    const host = configGet(key, { cwd, rowEnv, gsdHome });
    assert.equal(host.ok, true, `config-get ${key} failed: ${JSON.stringify(host)}`);
    assert.deepStrictEqual(res.get(key), host.value, `resolver vs config-get for ${key}`);
    if (expected && Object.hasOwn(expected, key)) assert.deepStrictEqual(host.value, expected[key], `host value for ${key}`);
  }
  const mp = configGet('mempalace.enabled', { cwd, rowEnv, gsdHome });
  assert.equal(mp.ok, true, `config-get mempalace.enabled failed: ${JSON.stringify(mp)}`);
  assert.equal(res.get('mempalace.enabled') === true, mp.value === true, 'mempalace.enabled === true parity');
  assert.equal(
    discussGateCount(cwd, rowEnv, gsdHome),
    res.get('memanto.enabled') === true ? 1 : 0,
    'render-hooks discuss:pre memanto gate iff resolver memanto.enabled === true',
  );
  return res;
}

const FULL = { enabled: true, agent_id: 'a', backend_url: 'http://backend.test', api_url: 'http://api.test' };

const ROWS = [
  {
    name: 'no config file',
    files: {},
    expected: { 'memanto.enabled': false, 'memanto.agent_id': '', 'memanto.backend_url': '', 'memanto.api_url': '' },
  },
  { name: 'root config only', files: { '': { memanto: FULL } }, expected: { 'memanto.agent_id': 'a', 'memanto.enabled': true } },
  {
    name: 'workstream config only via GSD_WORKSTREAM',
    files: { 'workstreams/w': { memanto: { enabled: true, agent_id: 'w' } } },
    env: { GSD_WORKSTREAM: 'w' },
    expected: { 'memanto.agent_id': 'w', 'memanto.enabled': true },
  },
  {
    name: 'both configs: workstream wins, root fills the rest',
    files: {
      '': { memanto: { enabled: true, agent_id: 'r', backend_url: 'http://root.test' } },
      'workstreams/w': { memanto: { agent_id: 'w' } },
    },
    env: { GSD_WORKSTREAM: 'w' },
    expected: { 'memanto.agent_id': 'w', 'memanto.backend_url': 'http://root.test', 'memanto.enabled': true },
  },
  {
    name: 'both configs: workstream enabled false overrides root true',
    files: { '': { memanto: FULL }, 'workstreams/w': { memanto: { enabled: false } } },
    env: { GSD_WORKSTREAM: 'w' },
    expected: { 'memanto.enabled': false, 'memanto.agent_id': 'a' },
  },
  {
    name: 'memanto.enabled as the string "false"',
    files: { '': { memanto: { ...FULL, enabled: 'false' } } },
    expected: { 'memanto.enabled': 'false' },
  },
  { name: 'mempalace.enabled true', files: { '': { memanto: FULL, mempalace: { enabled: true } } } },
  { name: 'mempalace.enabled "true"', files: { '': { memanto: FULL, mempalace: { enabled: 'true' } } } },
  { name: 'mempalace.enabled null', files: { '': { memanto: FULL, mempalace: { enabled: null } } } },
  {
    name: 'GSD_PROJECT alone does not inherit the root config',
    files: { '': { memanto: FULL }, p: { memanto: { agent_id: 'p' } } },
    env: { GSD_PROJECT: 'p' },
    expected: { 'memanto.agent_id': 'p', 'memanto.enabled': false, 'memanto.api_url': '' },
  },
  {
    name: 'GSD_PROJECT with GSD_WORKSTREAM reads .planning/p/workstreams/w, then .planning (not .planning/p)',
    files: {
      '': { memanto: { enabled: true, backend_url: 'http://root.test' } },
      p: { memanto: { api_url: 'http://project.test', agent_id: 'p' } },
      'p/workstreams/w': { memanto: { agent_id: 'pw' } },
    },
    env: { GSD_PROJECT: 'p', GSD_WORKSTREAM: 'w' },
    expected: { 'memanto.agent_id': 'pw', 'memanto.api_url': '', 'memanto.backend_url': 'http://root.test', 'memanto.enabled': true },
  },
];

for (const row of ROWS) {
  test(`contract: ${row.name}`, () => {
    assertParity(project(row.files), row.env, row.expected);
  });
}

test('contract: $GSD_HOME/.gsd/defaults.json memanto values change neither config-get nor the resolver', () => {
  const files = { '': { memanto: { agent_id: 'x' } } };
  const plainProject = project(files);
  const before = {};
  for (const key of MEMANTO_KEYS) before[key] = configGet(key, { cwd: plainProject }).value;

  const defaultsHome = env.tmpDir('memanto-home-defaults-');
  env.installBundle({ home: defaultsHome });
  fs.mkdirSync(path.join(defaultsHome, '.gsd'), { recursive: true });
  fs.writeFileSync(
    path.join(defaultsHome, '.gsd', 'defaults.json'),
    JSON.stringify({ memanto: { agent_id: 'fromdefaults', enabled: true, api_url: 'http://defaults.test' } }),
  );
  const cwd = project(files);
  const res = assertParity(cwd, { GSD_HOME: defaultsHome }, before, defaultsHome);
  assert.equal(res.get('memanto.agent_id'), 'x');
  assert.equal(res.get('memanto.enabled'), false);
});

test('contract divergence: malformed root config.json blocks the gate; the host fails config-get and renders no gate', () => {
  const cwd = project({ '': '{ "memanto": ' });
  const res = resolver(cwd);
  assert.equal(res.ok, false);
  assert.equal(res.path, path.join(cwd, '.planning', 'config.json'));
  const host = configGet('memanto.enabled', { cwd });
  assert.equal(host.ok, false, 'config-get is expected to fail on malformed JSON');
  assert.match(host.stderr, /Failed to read config\.json/);
  assert.equal(discussGateCount(cwd), 0, 'host activation treats malformed JSON as key-absent');
});

test('contract divergence: malformed workstream config with root enabled renders the gate and the resolver blocks', () => {
  const cwd = project({ '': { memanto: FULL }, 'workstreams/w': '{ nope' });
  const rowEnv = { GSD_WORKSTREAM: 'w' };
  assert.equal(discussGateCount(cwd, rowEnv), 1, 'host activates from the root key when the workstream file is unreadable');
  const res = resolver(cwd, rowEnv);
  assert.equal(res.ok, false, 'the gate must block with [config-unreadable]');
  assert.equal(res.path, path.join(cwd, '.planning', 'workstreams', 'w', 'config.json'));
  assert.equal(configGet('memanto.enabled', { cwd, rowEnv }).ok, false);
});
