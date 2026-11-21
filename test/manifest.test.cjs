'use strict';
// INST-02: the installed manifest loads through gsd-core's real loader with zero
// overlay warnings or diagnostics for memanto, and `capability list` reports it
// active. The host's own empty `.staging` directory warning is outside the
// capability's control (RESEARCH F3) and is tolerated, nothing else is.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./helpers/gsd-env.cjs');

const manifest = JSON.parse(fs.readFileSync(path.join(env.REPO_ROOT, 'capability.json'), 'utf8'));

let home;
let project;
let registry;

before(() => {
  home = env.tmpDir('memanto-home-');
  project = env.makeProject({ config: { memanto: { enabled: true } } });
  env.installBundle({ home });
  registry = env.loadRegistry({ home, cwd: project });
});

after(() => env.cleanup());

function overlay() {
  return registry._overlay || { warnings: [], diagnostics: [] };
}

test('the real loader registers memanto from the installed bundle', () => {
  assert.ok(registry.capabilities && registry.capabilities.memanto, 'registry.capabilities.memanto is missing');
  assert.equal(registry.capabilities.memanto.id, 'memanto');
});

test('the loader emits no overlay warning for memanto', () => {
  const own = (overlay().warnings || []).filter((w) => w.id === 'memanto');
  assert.deepStrictEqual(own, []);
});

test('the loader emits no diagnostics', () => {
  assert.deepStrictEqual(overlay().diagnostics || [], []);
});

test('the only tolerated non-memanto warning is the host .staging directory (F3)', () => {
  const others = (overlay().warnings || []).filter((w) => w.id !== 'memanto');
  assert.ok(others.length <= 1, `unexpected overlay warnings: ${JSON.stringify(others)}`);
  for (const w of others) assert.equal(w.id, '.staging', `unexpected overlay warning: ${JSON.stringify(w)}`);
});

test('capability list --raw shows memanto with status active', () => {
  const res = env.gsd(['capability', 'list', '--raw'], { cwd: project, home });
  assert.equal(res.status, 0, res.stderr);
  const rows = JSON.parse(res.stdout);
  assert.ok(Array.isArray(rows), 'capability list --raw did not return an array');
  const row = rows.find((r) => r && r.id === 'memanto');
  assert.ok(row, 'capability list has no memanto row');
  assert.equal(row.status, 'active', `memanto row: ${JSON.stringify(row)}`);
});

test('manifest shape: feature role, full tier, engines floor, any runtime', () => {
  assert.equal(manifest.id, 'memanto');
  assert.equal(manifest.role, 'feature');
  assert.equal(manifest.tier, 'full');
  assert.deepStrictEqual(manifest.engines, { gsd: '>=1.20.1 <2.0.0' });
  assert.deepStrictEqual(manifest.runtimeCompat.supported, ['*']);
});

test('manifest ships no skills, agents, hooks or mcpServers', () => {
  assert.deepStrictEqual(manifest.skills, []);
  assert.deepStrictEqual(manifest.agents, []);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'hooks'), false, 'manifest declares hooks');
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'mcpServers'), false, 'manifest declares mcpServers');
});

test('manifest config defaults are off and empty, and memanto.enabled is the activation key', () => {
  const expected = {
    'memanto.enabled': { type: 'boolean', default: false },
    'memanto.agent_id': { type: 'string', default: '' },
    'memanto.backend_url': { type: 'string', default: '' },
    'memanto.api_url': { type: 'string', default: '' },
  };
  for (const [key, want] of Object.entries(expected)) {
    const decl = manifest.config[key];
    assert.ok(decl, `config key ${key} is not declared`);
    assert.equal(decl.type, want.type, `${key} type`);
    assert.strictEqual(decl.default, want.default, `${key} default`);
  }
  assert.equal(manifest.activationKey, 'memanto.enabled');
});
