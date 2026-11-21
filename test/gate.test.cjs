'use strict';
// Gate check set driven through gsd-core's real host: staged bundle -> global
// install into a temp GSD_HOME -> loop render-hooks discuss:pre -> check predicate.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const env = require('./helpers/gsd-env.cjs');

const BREAK_GLASS = '(memanto.enabled=false disables Memanto for this project)';
const PHASE_DIR = '.planning/phases/01-test';
const PREFIX = 'command exited 1: ';

let home;
let project;
let predicate;

before(() => {
  home = env.tmpDir('memanto-home-');
  project = env.makeProject({ config: { memanto: { enabled: true, agent_id: '' } }, phaseDirs: ['01-test'] });
  env.installBundle({ home });
  const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home }));
  assert.equal(hooks.length, 1, 'expected exactly one memanto gate at discuss:pre');
  predicate = hooks[0].check.predicate;
});

after(() => env.cleanup());

// Base config for a case: memanto enabled, everything else from `memanto`/`extra`.
function runGate({ memanto = {}, extra = {} } = {}) {
  env.writeConfig(project, { memanto: { enabled: true, ...memanto }, ...extra });
  const res = env.checkPredicate(predicate, { cwd: project, home, phaseDir: PHASE_DIR, phaseNumber: '01' });
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

test('mempalace true plus empty agent_id prints [mempalace] then [agent-id], break-glass last', () => {
  const r = runGate({ memanto: { agent_id: '' }, extra: { mempalace: { enabled: true } } });
  assert.equal(r.block, true);
  assert.deepEqual(r.ids.slice(0, 2), ['mempalace', 'agent-id'], r.message);
  assert.equal(r.lines.at(-1), BREAK_GLASS);
});
