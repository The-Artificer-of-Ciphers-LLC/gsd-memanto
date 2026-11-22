'use strict';
// Round-9 WR-02: doctor renders discuss:pre and the points of its own shipped
// manifest. An installed manifest adds points only when it is the copy gsd-core
// loads, and only known loop point names, at most one render per loop point.
// No record id or message carries a control character. Temp GSD_HOME and a
// closed local port only.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');
const memanto = require('../memanto.cjs');

const DEAD = 'http://127.0.0.1:9';
const CONTRACT = path.join(env.coreDir(), 'bin', 'lib', 'loop-host-contract.cjs');
const ESC_POINT = '\u001b]0;PWNED\u0007\u001b[31mRED';

after(() => env.cleanup());

test('LOOP_POINTS is the loop point list of the installed gsd-core host contract', () => {
  // Read as text: the test never require()s gsd-core code.
  const src = fs.readFileSync(CONTRACT, 'utf8');
  const points = [];
  for (const m of src.matchAll(/"points"\s*:\s*\[([^\]]*)\]/g)) for (const p of m[1].matchAll(/"([^"]+)"/g)) points.push(p[1]);
  assert.ok(points.length > 0, `${CONTRACT}: no "points" arrays; the host contract changed shape`);
  assert.deepEqual([...memanto.LOOP_POINTS], points);
});

test('pointsToRender: discuss:pre first, the own manifest points, and only known points of the loaded manifest, capped', () => {
  const own = { gates: [{ point: 'discuss:pre' }], steps: [{ point: 'plan:pre' }, { point: 'bogus' }], contributions: [] };
  const many = [{ point: ESC_POINT }, ...Array.from({ length: 40 }, (_, i) => ({ point: `p${i}` })), ...memanto.LOOP_POINTS.map((point) => ({ point }))];
  const loaded = { gates: [], steps: [], contributions: many };
  assert.deepEqual(memanto.pointsToRender(own, null), ['discuss:pre', 'plan:pre']);
  const all = memanto.pointsToRender(own, loaded);
  assert.equal(all[0], 'discuss:pre');
  assert.ok(all.length <= memanto.LOOP_POINTS.length, JSON.stringify(all));
  for (const p of all) assert.ok(memanto.LOOP_POINTS.includes(p), p);
  assert.deepEqual([...all].sort(), [...memanto.LOOP_POINTS].sort());
  assert.deepEqual(memanto.pointsToRender(null, { contributions: 'x' }), ['discuss:pre']);
});

// The reviewer's r9p2.cjs: a planted, unledgered project capability.json with
// a control-character point and many bogus points, next to a legitimate global install.
test('r9p2: a planted project manifest adds no render points and no raw control bytes reach the terminal', () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: { memanto: { enabled: true, agent_id: 'x', backend_url: DEAD, api_url: DEAD } }, phaseDirs: ['01-test'] });
  env.installBundle({ home: h });
  const pd = path.join(project, '.gsd', 'capabilities', 'memanto');
  fs.mkdirSync(pd, { recursive: true });
  const contributions = [{ point: ESC_POINT, into: 'orchestrator' }, { point: 'plan:post', into: 'planner' }];
  for (let i = 0; i < 40; i++) contributions.push({ point: `p${i}`, into: 'x' });
  fs.writeFileSync(path.join(pd, 'capability.json'), JSON.stringify({ id: 'memanto', gates: [], steps: [], contributions }));
  const bundle = path.join(h, '.gsd', 'capabilities', 'memanto');
  const run = (raw) =>
    spawnSync(process.execPath, [path.join(bundle, 'memanto.cjs'), 'doctor', ...(raw ? ['--raw'] : [])], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, GSD_HOME: h, GSD_WORKSTREAM: '', GSD_PROJECT: '' },
      timeout: 60000,
      killSignal: 'SIGKILL',
    });
  const text = run(false);
  assert.equal(text.error, undefined, String(text.error));
  // eslint-disable-next-line no-control-regex
  assert.equal((text.stdout.match(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g) || []).length, 0, JSON.stringify(text.stdout.slice(0, 400)));
  const rep = JSON.parse(run(true).stdout);
  const renders = rep.checks.filter((c) => c.id.startsWith('render:'));
  // The unconsented project copy is not the one gsd-core loads, so only the
  // doctor's own points (discuss:pre) are rendered.
  assert.deepEqual(renders.map((c) => c.id), ['render:discuss:pre'], JSON.stringify(renders));
  for (const c of rep.checks) {
    // eslint-disable-next-line no-control-regex
    for (const k of ['id', 'message', 'fix']) assert.ok(!/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(c[k]), `${c.id}.${k}: ${JSON.stringify(c[k])}`);
  }
});
