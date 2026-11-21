'use strict';
// CONF-01 / F6: only the literal boolean true in memanto.enabled activates the
// capability; every other value renders no memanto hook, so none can run.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const env = require('./helpers/gsd-env.cjs');

const ABSENT = Symbol('absent');

const CASES = [
  { label: 'boolean true', value: true, expected: 1 },
  { label: 'boolean false', value: false, expected: 0 },
  { label: 'key absent', value: ABSENT, expected: 0 },
  { label: 'string "false"', value: 'false', expected: 0 },
  { label: 'string "true"', value: 'true', expected: 0 },
  { label: 'number 1', value: 1, expected: 0 },
  { label: 'null', value: null, expected: 0 },
];

let home;
let consentBefore;

before(() => {
  consentBefore = env.realConsentStamp();
  home = env.tmpDir('memanto-home-');
  env.installBundle({ home });
});

after(() => env.cleanup());

function projectWithEnabled(value) {
  const memanto = { agent_id: 'activation-agent' };
  if (value !== ABSENT) memanto.enabled = value;
  return env.makeProject({ config: { memanto } });
}

for (const c of CASES) {
  test(`memanto.enabled ${c.label} renders ${c.expected} memanto hook(s) at discuss:pre`, () => {
    const project = projectWithEnabled(c.value);
    const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home }));
    assert.equal(hooks.length, c.expected, JSON.stringify(hooks));
  });
}

test('memanto.enabled false also renders no memanto hook at plan:pre', () => {
  const project = projectWithEnabled(false);
  const hooks = env.memantoHooks(env.renderHooks('plan:pre', { cwd: project, home }));
  assert.equal(hooks.length, 0, JSON.stringify(hooks));
});

test('the real ~/.gsd/consent.json is untouched by the activation suite', () => {
  assert.equal(env.realConsentStamp(), consentBefore);
});
