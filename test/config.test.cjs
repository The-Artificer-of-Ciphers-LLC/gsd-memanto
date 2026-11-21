'use strict';
// CONF-01 / CONF-02 / CONF-03 (D-05): the gate's in-process resolver reads the
// same planning directories, in the same order, as gsd-core. Unit level: no
// host spawn, temp directories only.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { resolveConfig, planningDirs } = require('../lib/config.cjs');

const tmpDirs = [];
after(() => {
  while (tmpDirs.length > 0) fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
});

function project() {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-cfg-')));
  tmpDirs.push(dir);
  fs.mkdirSync(path.join(dir, '.planning'), { recursive: true });
  return dir;
}

function write(dir, rel, content) {
  const file = path.join(dir, '.planning', rel, 'config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  return file;
}

// A blank environment: no workstream, no project, a temp GSD_HOME.
function blankEnv(extra) {
  return { GSD_WORKSTREAM: '', GSD_PROJECT: '', GSD_HOME: project(), ...(extra || {}) };
}

function resolved(cwd, env) {
  const res = resolveConfig({ cwd, env: blankEnv(env) });
  assert.equal(res.ok, true, JSON.stringify(res));
  return res;
}

test('no config file resolves every memanto key to the manifest default', () => {
  const res = resolved(project());
  assert.equal(res.get('memanto.enabled'), false);
  assert.equal(res.get('memanto.agent_id'), '');
  assert.equal(res.get('memanto.backend_url'), '');
  assert.equal(res.get('memanto.api_url'), '');
  assert.equal(res.get('mempalace.enabled'), undefined);
});

test('root config only: its own value wins over the default', () => {
  const cwd = project();
  write(cwd, '', { memanto: { agent_id: 'a' } });
  assert.equal(resolved(cwd).get('memanto.agent_id'), 'a');
});

test('GSD_WORKSTREAM with only the workstream config resolves from the workstream', () => {
  const cwd = project();
  write(cwd, 'workstreams/w', { memanto: { agent_id: 'w' } });
  assert.equal(resolved(cwd, { GSD_WORKSTREAM: 'w' }).get('memanto.agent_id'), 'w');
});

test('GSD_WORKSTREAM with both configs: workstream wins, root fills keys the workstream lacks', () => {
  const cwd = project();
  write(cwd, '', { memanto: { agent_id: 'r', backend_url: 'http://root.example' } });
  write(cwd, 'workstreams/w', { memanto: { agent_id: 'w' } });
  const res = resolved(cwd, { GSD_WORKSTREAM: 'w' });
  assert.equal(res.get('memanto.agent_id'), 'w');
  assert.equal(res.get('memanto.backend_url'), 'http://root.example');
  assert.deepEqual(res.files, [
    path.join(cwd, '.planning', 'workstreams', 'w', 'config.json'),
    path.join(cwd, '.planning', 'config.json'),
  ]);
});

test('without GSD_WORKSTREAM a workstream config is not read', () => {
  const cwd = project();
  write(cwd, 'workstreams/w', { memanto: { agent_id: 'w' } });
  assert.equal(resolved(cwd).get('memanto.agent_id'), '');
});

test('GSD_WORKSTREAM is trimmed like the host; whitespace only means no workstream', () => {
  const cwd = project();
  write(cwd, 'workstreams/w', { memanto: { agent_id: 'w' } });
  assert.equal(resolved(cwd, { GSD_WORKSTREAM: '  w ' }).get('memanto.agent_id'), 'w');
  assert.equal(resolved(cwd, { GSD_WORKSTREAM: '   ' }).get('memanto.agent_id'), '');
});

test('GSD_PROJECT=p reads .planning/p/config.json first, then the root config', () => {
  const cwd = project();
  write(cwd, '', { memanto: { agent_id: 'r', api_url: 'http://root.example' } });
  write(cwd, 'p', { memanto: { agent_id: 'p' } });
  const res = resolved(cwd, { GSD_PROJECT: 'p' });
  assert.equal(res.get('memanto.agent_id'), 'p');
  assert.equal(res.get('memanto.api_url'), 'http://root.example');
});

test('GSD_PROJECT and GSD_WORKSTREAM together read .planning/p/workstreams/w', () => {
  const cwd = project();
  write(cwd, 'p/workstreams/w', { memanto: { agent_id: 'pw' } });
  write(cwd, 'p', { memanto: { agent_id: 'p-only' } });
  assert.equal(resolved(cwd, { GSD_PROJECT: 'p', GSD_WORKSTREAM: 'w' }).get('memanto.agent_id'), 'pw');
});

test('planningDirs returns the root and the scoped directory', () => {
  const cwd = '/x/repo';
  assert.deepEqual(planningDirs(cwd, {}), { root: '/x/repo/.planning', scoped: '/x/repo/.planning' });
  assert.deepEqual(planningDirs(cwd, { GSD_WORKSTREAM: 'w' }), {
    root: '/x/repo/.planning',
    scoped: '/x/repo/.planning/workstreams/w',
  });
  assert.deepEqual(planningDirs(cwd, { GSD_PROJECT: 'p' }), {
    root: '/x/repo/.planning',
    scoped: '/x/repo/.planning/p',
  });
  assert.deepEqual(planningDirs(cwd, { GSD_PROJECT: 'p', GSD_WORKSTREAM: 'w' }), {
    root: '/x/repo/.planning',
    scoped: '/x/repo/.planning/p/workstreams/w',
  });
});

test('memanto.enabled as the string "false" resolves as that string (not activating)', () => {
  const cwd = project();
  write(cwd, '', { memanto: { enabled: 'false' } });
  const value = resolved(cwd).get('memanto.enabled');
  assert.equal(value, 'false');
  assert.notEqual(value === true, true);
});

test('malformed root JSON returns ok false with that path', () => {
  const cwd = project();
  const file = write(cwd, '', '{ "memanto": ');
  const res = resolveConfig({ cwd, env: blankEnv() });
  assert.equal(res.ok, false);
  assert.equal(res.path, file);
  assert.equal(res.kind, 'parse');
});

test('malformed workstream JSON returns ok false with the workstream path', () => {
  const cwd = project();
  write(cwd, '', { memanto: { agent_id: 'r' } });
  const file = write(cwd, 'workstreams/w', '{ nope');
  const res = resolveConfig({ cwd, env: blankEnv({ GSD_WORKSTREAM: 'w' }) });
  assert.equal(res.ok, false);
  assert.equal(res.path, file);
});

test('a top-level "__proto__" key does not leak into the lookup', () => {
  const cwd = project();
  write(cwd, '', '{"__proto__":{"memanto":{"agent_id":"x","enabled":true}}}');
  const res = resolved(cwd);
  assert.equal(res.get('memanto.agent_id'), '');
  assert.equal(res.get('memanto.enabled'), false);
  assert.equal(res.get('__proto__.memanto.agent_id'), undefined);
});

test('key paths containing constructor or prototype resolve as absent', () => {
  const cwd = project();
  write(cwd, '', { memanto: { constructor: { x: 1 }, prototype: { y: 2 } } });
  const res = resolved(cwd);
  assert.equal(res.get('memanto.constructor.x'), undefined);
  assert.equal(res.get('memanto.prototype.y'), undefined);
  assert.equal(res.get('constructor.name'), undefined);
  assert.equal(res.get('memanto.agent_id.constructor'), undefined);
});

for (const [variable, value] of [
  ['GSD_WORKSTREAM', '../x'],
  ['GSD_WORKSTREAM', 'a/b'],
  ['GSD_WORKSTREAM', 'a\\b'],
  ['GSD_WORKSTREAM', '..'],
  ['GSD_PROJECT', '../x'],
  ['GSD_PROJECT', 'a/b'],
  ['GSD_PROJECT', 'a\\b'],
]) {
  test(`${variable} ${JSON.stringify(value)} makes the resolver return ok false`, () => {
    const cwd = project();
    write(cwd, '', { memanto: { agent_id: 'r' } });
    const res = resolveConfig({ cwd, env: blankEnv({ [variable]: value }) });
    assert.equal(res.ok, false, JSON.stringify(res));
    assert.match(res.error, new RegExp(`invalid ${variable}`));
    assert.equal(res.path, variable);
  });
}

test('planningDirs throws a typed error for an invalid name', () => {
  assert.throws(() => planningDirs('/x', { GSD_WORKSTREAM: '../x' }), (e) => {
    assert.equal(e.code, 'MEMANTO_INVALID_PLANNING_NAME');
    assert.equal(e.variable, 'GSD_WORKSTREAM');
    assert.match(e.message, /invalid GSD_WORKSTREAM/);
    return true;
  });
});

test('$GSD_HOME/.gsd/defaults.json memanto values are ignored', () => {
  const cwd = project();
  const home = project();
  fs.mkdirSync(path.join(home, '.gsd'), { recursive: true });
  fs.writeFileSync(
    path.join(home, '.gsd', 'defaults.json'),
    JSON.stringify({ memanto: { agent_id: 'd', enabled: true } }),
  );
  const res = resolved(cwd, { GSD_HOME: home });
  assert.equal(res.get('memanto.agent_id'), '');
  assert.equal(res.get('memanto.enabled'), false);
  assert.deepEqual(res.files, []);
});
