'use strict';
// Walking-skeleton tracer: staged release file set -> real global install ->
// enabled project -> loop render-hooks discuss:pre -> check predicate.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const env = require('./helpers/gsd-env.cjs');

const BREAK_GLASS = '(memanto.enabled=false disables Memanto for this project)';
const PHASE_DIR = '.planning/phases/01-test';

let consentBefore;
let home;
let project;

before(() => {
  consentBefore = env.realConsentStamp();
  home = env.tmpDir('memanto-home-');
  project = env.makeProject({
    config: { memanto: { enabled: true, agent_id: '' } },
    phaseDirs: ['01-test'],
  });
});

after(() => env.cleanup());

function renderedGate() {
  const rendered = env.renderHooks('discuss:pre', { cwd: project, home });
  const hooks = env.memantoHooks(rendered);
  assert.equal(hooks.length, 1, `expected exactly one memanto hook at discuss:pre, got ${JSON.stringify(rendered)}`);
  return hooks[0];
}

test('staged bundle installs globally into a temp GSD_HOME', () => {
  const res = env.installBundle({ home });
  assert.equal(res.status, 'installed');
  assert.equal(res.id, 'memanto');
});

test('discuss:pre renders one blocking memanto gate', () => {
  const gate = renderedGate();
  assert.equal(gate.kind, 'gate');
  assert.equal(gate.blocking, true);
});

test('gate blocks with the agent-id line and break-glass when memanto.agent_id is empty', () => {
  const gate = renderedGate();
  const res = env.checkPredicate(gate.check.predicate, { cwd: project, home, phaseDir: PHASE_DIR, phaseNumber: '01' });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  assert.equal(res.json.block, true);
  assert.ok(
    res.json.message.startsWith('command exited 1: memanto: BLOCKED [agent-id]'),
    `unexpected message: ${res.json.message}`,
  );
  assert.ok(res.json.message.includes(BREAK_GLASS), `break-glass missing: ${res.json.message}`);
});

test('gate passes once memanto.agent_id is set', () => {
  env.writeConfig(project, { memanto: { enabled: true, agent_id: 'skeleton-agent' } });
  const gate = renderedGate();
  const res = env.checkPredicate(gate.check.predicate, { cwd: project, home, phaseDir: PHASE_DIR, phaseNumber: '01' });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  assert.equal(res.json.block, false, `expected pass, got ${JSON.stringify(res.json)}`);
});

test('the real ~/.gsd/consent.json is untouched', () => {
  assert.equal(env.realConsentStamp(), consentBefore);
});
