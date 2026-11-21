'use strict';
// INST-03: every hook the installed manifest declares sits at a (point, kind) pair
// the host under test really dispatches. The oracle is gsd-core's own dispatch
// scanner (getWiredKinds over the installed workflows) and validateHooksWired,
// computed per host version, never from a hand-maintained table (RESEARCH F1, F4).
// Negative fixtures prove the oracle rejects undispatched pairs.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const env = require('./helpers/gsd-env.cjs');

const validator = require(path.join(env.coreDir(), 'bin', 'lib', 'capability-validator.cjs'));
const hostContract = require(path.join(path.dirname(env.coreDir()), 'scripts', 'gen-loop-host-contract.cjs'));

const HOOK_GROUPS = ['gates', 'steps', 'contributions'];

let home;
let project;
let cap;
let wired;

before(() => {
  home = env.tmpDir('memanto-home-');
  project = env.makeProject({ config: { memanto: { enabled: true } } });
  env.installBundle({ home });
  const registry = env.loadRegistry({ home, cwd: project });
  cap = registry.capabilities.memanto;
  assert.ok(cap, 'installed memanto did not load');
  // Map<point, Set<kind>> scanned from the host's own loop workflows.
  wired = hostContract.getWiredKinds(path.dirname(env.coreDir()));
});

after(() => env.cleanup());

function copyCap() {
  return structuredClone(cap);
}

function gateAt(point) {
  return {
    point,
    check: { predicate: { kind: 'command-exit-zero', command: 'true' } },
    blocking: true,
    onError: 'halt',
  };
}

function hooksAt(manifest, point) {
  const out = [];
  for (const group of HOOK_GROUPS) {
    for (const h of manifest[group] || []) if (h && h.point === point) out.push({ group, hook: h });
  }
  return out;
}

test('the host dispatch scanner returns a non-empty wired-kinds map', () => {
  assert.ok(wired instanceof Map, 'getWiredKinds did not return a Map');
  assert.ok(wired.size > 0, 'getWiredKinds returned no wired points');
});

test('validateHooksWired accepts the shipped manifest on the host under test', () => {
  assert.deepStrictEqual(validator.validateHooksWired(cap, wired), []);
});

test('validateHooksWired accepts a copy with gates, steps and contributions emptied', () => {
  const empty = copyCap();
  for (const group of HOOK_GROUPS) empty[group] = [];
  assert.deepStrictEqual(validator.validateHooksWired(empty, wired), []);
});

test('the manifest declares no gate, step or contribution at execute:pre (V2-03)', () => {
  assert.deepStrictEqual(hooksAt(cap, 'execute:pre'), []);
});

test('the manifest declares no gate at verify:post, ship:post or execute:wave:pre', () => {
  for (const point of ['verify:post', 'ship:post', 'execute:wave:pre']) {
    const gates = hooksAt(cap, point).filter((h) => h.group === 'gates');
    assert.deepStrictEqual(gates, [], `gate declared at ${point}`);
  }
});

test('negative fixture: a gate at execute:wave:pre is rejected as undispatched', () => {
  const bad = copyCap();
  bad.gates = [...bad.gates, gateAt('execute:wave:pre')];
  const errors = validator.validateHooksWired(bad, wired);
  assert.ok(errors.length > 0, 'a gate at execute:wave:pre passed validateHooksWired');
  assert.ok(errors.some((e) => e.includes('execute:wave:pre')), errors.join('\n'));
});

test('negative fixture: a gate at verify:post is rejected as undispatched', () => {
  const bad = copyCap();
  bad.gates = [...bad.gates, gateAt('verify:post')];
  const errors = validator.validateHooksWired(bad, wired);
  assert.ok(errors.length > 0, 'a gate at verify:post passed validateHooksWired');
  assert.ok(errors.some((e) => e.includes('verify:post')), errors.join('\n'));
});

test('negative fixture: a gate at execute:pre is rejected exactly when the host does not dispatch gates there', () => {
  const bad = copyCap();
  bad.gates = [...bad.gates, gateAt('execute:pre')];
  const errors = validator.validateHooksWired(bad, wired);
  const hostDispatches = wired.has('execute:pre') && wired.get('execute:pre').has('gate');
  if (hostDispatches) {
    assert.deepStrictEqual(errors, []);
  } else {
    assert.ok(errors.length > 0, 'a gate at an undispatched execute:pre passed validateHooksWired');
    assert.ok(errors.some((e) => e.includes('execute:pre')), errors.join('\n'));
  }
});

test('two consecutive render-hooks discuss:pre calls return identical activeHooks', () => {
  const first = env.renderHooks('discuss:pre', { cwd: project, home });
  const second = env.renderHooks('discuss:pre', { cwd: project, home });
  assert.ok(env.memantoHooks(first).length > 0, 'render-hooks discuss:pre returned no memanto hook');
  assert.deepStrictEqual(second.activeHooks, first.activeHooks);
});
