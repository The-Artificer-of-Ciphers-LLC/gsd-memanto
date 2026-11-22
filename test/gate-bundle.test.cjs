'use strict';
// CR-01: the discuss:pre predicate runs only the gate.cjs of a real installed
// memanto bundle (capability.json with id memanto AND a committed ledger entry
// for its scope). gsd-core keeps the global copy when both scopes hold one, so
// the predicate prefers global only when the global copy is a real installed
// bundle. A stray or planted global scripts/gate.cjs is never run, and with no
// trustworthy bundle the predicate exits non-zero (fail closed). Doctor reports
// the state as a gate-bundle error. Every case uses a temp GSD_HOME.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');
const { startFakeApi } = require('./helpers/fake-api.cjs');

const PHASE_DIR = '.planning/phases/01-test';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(env.REPO_ROOT, 'capability.json'), 'utf8'));
const PREDICATE = MANIFEST.gates.find((g) => g.point === 'discuss:pre').check.predicate;
const servers = {};

before(async () => {
  servers.ok = await startFakeApi({ mode: 'ok' });
});

after(async () => {
  for (const s of Object.values(servers)) await s.close();
  env.cleanup();
});

function globalBundle(h) {
  return path.join(h, '.gsd', 'capabilities', 'memanto');
}

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

// A global directory that is not an installed bundle: only scripts/gate.cjs.
function plantGlobalGate(h, { withManifest = false } = {}) {
  const dir = globalBundle(h);
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'scripts', 'gate.cjs'), 'process.exit(0);\n');
  if (withManifest) fs.writeFileSync(path.join(dir, 'capability.json'), JSON.stringify(MANIFEST));
  return dir;
}

function renderedPredicate(project, h) {
  const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home: h }));
  assert.equal(hooks.length, 1, 'expected exactly one memanto gate at discuss:pre');
  return hooks[0].check.predicate;
}

function runGate(project, h, predicate) {
  const res = env.checkPredicate(predicate || renderedPredicate(project, h), {
    cwd: project,
    home: h,
    phaseDir: PHASE_DIR,
    phaseNumber: '01',
  });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  return res.json;
}

function doctor(project, h, bundle) {
  const res = spawnSync(process.execPath, [path.join(bundle, 'memanto.cjs'), 'doctor', '--raw'], {
    cwd: project,
    encoding: 'utf8',
    env: { ...process.env, GSD_HOME: h, GSD_WORKSTREAM: '', GSD_PROJECT: '' },
  });
  if (res.error) throw res.error;
  let rep;
  try {
    rep = JSON.parse(res.stdout);
  } catch {
    throw new Error(`doctor --raw stdout is not JSON (exit ${res.status}): ${res.stdout}\nstderr: ${res.stderr}`);
  }
  return { status: res.status, rep, check: (id) => rep.checks.find((c) => c.id === id) };
}

function emptyAgentProject() {
  return env.makeProject({
    config: { memanto: { enabled: true, agent_id: '', backend_url: servers.ok.url, api_url: servers.ok.url } },
    phaseDirs: ['01-test'],
  });
}

test('the predicate stays POSIX sh within the host 4096-character limit', () => {
  assert.equal(PREDICATE.kind, 'command-exit-zero');
  assert.ok(PREDICATE.command.length <= 4096, `command length ${PREDICATE.command.length}`);
  const res = spawnSync('sh', ['-n', '-c', PREDICATE.command], { encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
});

test('verifier scenario: project install, empty agent_id, planted global gate.cjs exiting 0 still blocks', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  projectInstall(project, h);
  plantGlobalGate(h);
  const verdict = runGate(project, h);
  assert.equal(verdict.block, true, `planted global gate.cjs was run: ${JSON.stringify(verdict)}`);
  assert.match(verdict.message, /BLOCKED \[agent-id\]/, verdict.message);
});

test('verifier scenario: doctor reports gate-bundle as an error naming the stray global gate', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  const bundle = projectInstall(project, h);
  const stray = plantGlobalGate(h);
  const d = doctor(project, h, bundle);
  assert.equal(d.status, 1, JSON.stringify(d.rep));
  const r = d.check('gate-bundle');
  assert.ok(r, JSON.stringify(d.rep));
  assert.equal(r.status, 'error', JSON.stringify(r));
  assert.ok(r.message.includes(stray), r.message);
  assert.ok(r.fix.length > 0, 'gate-bundle has no fix hint');
});

test('a planted global capability.json without a ledger entry is not selected either', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  const bundle = projectInstall(project, h);
  plantGlobalGate(h, { withManifest: true });
  assert.equal(runGate(project, h).block, true);
  assert.equal(doctor(project, h, bundle).check('gate-bundle').status, 'error');
});

test('a project-scope install with healthy config passes, so the project gate is the one that runs', () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({
    config: { memanto: { enabled: true, agent_id: 'bundle-agent', backend_url: servers.ok.url, api_url: servers.ok.url } },
    phaseDirs: ['01-test'],
  });
  const bundle = projectInstall(project, h);
  const verdict = runGate(project, h);
  assert.equal(verdict.block, false, verdict.message);
  const r = doctor(project, h, bundle).check('gate-bundle');
  assert.equal(r && r.status, 'ok', JSON.stringify(r));
});

test('with no installed bundle in either scope the predicate blocks with [gate-bundle]', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  plantGlobalGate(h);
  const verdict = runGate(project, h, PREDICATE);
  assert.equal(verdict.block, true, JSON.stringify(verdict));
  assert.match(verdict.message, /memanto: BLOCKED \[gate-bundle\]/, verdict.message);
  assert.match(verdict.message, /memanto\.enabled=false disables Memanto/, verdict.message);
  // WR-01: the paths that were checked, expanded, and the reinstall form doctor prints.
  assert.ok(!verdict.message.includes('${GSD_HOME'), verdict.message);
  assert.ok(verdict.message.includes(globalBundle(h)), `temp home path missing: ${verdict.message}`);
  assert.ok(verdict.message.includes(path.join(project, '.gsd', 'capabilities', 'memanto')), `project path missing: ${verdict.message}`);
  assert.ok(verdict.message.includes(`gsd-tools capability install npm:@taoc/gsd-memanto@${MANIFEST.version} --yes`), verdict.message);
  assert.ok(verdict.message.includes('--scope project'), verdict.message);
});

test('the [gate-bundle] reinstall hint pins the version of the manifest that carries it', () => {
  const pins = PREDICATE.command.match(/npm:@taoc\/gsd-memanto(@[^ ]*)?/g) || [];
  assert.ok(pins.length > 0, 'no version-pinned reinstall hint in the predicate');
  for (const pin of pins) assert.equal(pin, `npm:@taoc/gsd-memanto@${MANIFEST.version}`);
});

// Round-2 CR-01: gsd-core loads a global bundle that has no ledger entry (a
// bundle on disk provides declarative surfaces), so the rendered gate came from
// global. The predicate must never fall through to a repo-planted project
// bundle and ledger in that case.
function handCopyGlobal(h) {
  const dir = globalBundle(h);
  fs.cpSync(env.stageBundle(), dir, { recursive: true });
  return dir;
}

function plantProjectBundle(project) {
  const dir = path.join(project, '.gsd', 'capabilities', 'memanto');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'capability.json'), JSON.stringify(MANIFEST));
  const marker = path.join(project, 'PLANTED-RAN');
  fs.writeFileSync(path.join(dir, 'scripts', 'gate.cjs'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'x'); process.exit(0);\n`);
  // A structurally complete committed entry, so only the scope rule can reject it.
  const entry = { id: 'memanto', version: MANIFEST.version, source: 'planted', integrity: '', files: [], sharedEdits: [] };
  fs.writeFileSync(path.join(project, '.gsd-capabilities.json'), JSON.stringify({ version: 1, updatedAt: 'x', entries: { memanto: entry } }));
  return { dir, marker };
}

test('reviewer repro: unledgered global bundle plus a planted project bundle and ledger blocks and never runs the planted gate', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  handCopyGlobal(h);
  const { marker } = plantProjectBundle(project);
  const verdict = runGate(project, h);
  assert.equal(verdict.block, true, `planted project gate was run: ${JSON.stringify(verdict)}`);
  assert.match(verdict.message, /memanto: BLOCKED \[gate-bundle\]/, verdict.message);
  assert.ok(verdict.message.includes(globalBundle(h)), `unledgered global path missing: ${verdict.message}`);
  assert.equal(fs.existsSync(marker), false, 'the repo-planted project scripts/gate.cjs ran');
});

test('resolveGateBundle never selects the project copy while a global capability.json exists', () => {
  const { resolveGateBundle } = require('../lib/gate-bundle.cjs');
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: {} });
  handCopyGlobal(h);
  plantProjectBundle(project);
  assert.equal(resolveGateBundle({ gsdHome: h, projectRoot: project }), null);
});

// Round-2 WR-03: the hint must never remove the scope gsd-core loaded or a
// legitimate install; it names the stray copy.
test('doctor: a hand-copied global bundle next to a project install names the global copy to delete, never the project install', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  const bundle = projectInstall(project, h);
  const stray = handCopyGlobal(h);
  const d = doctor(project, h, bundle);
  const r = d.check('gate-bundle');
  assert.equal(r && r.status, 'error', JSON.stringify(d.rep));
  assert.ok(r.fix.includes(`delete ${stray}`), r.fix);
  assert.ok(!/capability remove memanto --scope project/.test(r.fix), `fix removes the project install: ${r.fix}`);
  assert.ok(!r.fix.includes(`delete ${bundle}`), r.fix);
  assert.ok(r.fix.includes(bundle), `fix should say the project install is kept: ${r.fix}`);
});

test('a global install is still preferred over a project install, as gsd-core does', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  env.installBundle({ home: h });
  const bundle = projectInstall(project, h);
  // Make the two copies distinguishable: the project gate would pass.
  fs.writeFileSync(path.join(bundle, 'scripts', 'gate.cjs'), 'process.exit(0);\n');
  const verdict = runGate(project, h, PREDICATE);
  assert.equal(verdict.block, true, 'the project gate ran instead of the global one');
  // Round-2 IN-03: the block must come from the global gate's own checks, not
  // from a [gate-bundle] block that rejected both scopes.
  assert.match(verdict.message, /memanto: BLOCKED \[agent-id\]/, verdict.message);
  assert.doesNotMatch(verdict.message, /\[gate-bundle\]/, verdict.message);
});
