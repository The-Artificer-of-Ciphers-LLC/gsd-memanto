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
  // Round-3 IN-02: gsd-core loads the hand-copied global copy (the loader keeps
  // global and skips the project copy as colliding), even though capability
  // list shows only the project row as active. The message must say so.
  assert.ok(r.message.includes(`gsd-core loads memanto from ${stray}`), r.message);
  assert.ok(!r.message.includes(`from ${bundle}`), `message names the project copy as loaded: ${r.message}`);
  assert.ok(r.message.includes('skips the project copy with the same id as colliding'), r.message);
  const loaded = d.check('loaded');
  assert.equal(loaded && loaded.status, 'ok', JSON.stringify(loaded));
  assert.ok(loaded.message.includes(`gsd-core loads the global copy at ${stray}`), loaded.message);
  // The duplicate-install hint agrees: it never removes the project install,
  // and names the unledgered global copy to delete by hand.
  const dup = d.check('duplicate-install');
  assert.equal(dup && dup.status, 'warn', JSON.stringify(dup));
  assert.ok(!/--scope project/.test(dup.fix), `duplicate-install removes the project install: ${dup.fix}`);
  assert.ok(dup.fix.includes(`delete ${stray} by hand`), dup.fix);
});

// Round-4 IN-01: the "skipped as colliding" claim needs the host's collision
// warning. With memanto disabled doctor renders no hooks, so it never sees how
// gsd-core handled the project copy and must not claim a collision.
test('doctor: gate-bundle claims the project copy collided only when gsd-core reported the collision', () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({
    config: { memanto: { enabled: false, agent_id: '', backend_url: servers.ok.url, api_url: servers.ok.url } },
    phaseDirs: ['01-test'],
  });
  const bundle = projectInstall(project, h);
  const stray = handCopyGlobal(h);
  const r = doctor(project, h, bundle).check('gate-bundle');
  assert.equal(r && r.status, 'error', JSON.stringify(r));
  assert.ok(r.message.includes(`gsd-core loads memanto from ${stray}`), r.message);
  assert.ok(!r.message.includes('as colliding'), `collision claimed without the host's warning: ${r.message}`);
  assert.ok(r.message.includes('gsd-core scans the global copy first'), r.message);
});

test('doctor: a global install that gsd-core skips (outside engines.gsd) next to a project install names the project copy as loaded', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  env.installBundle({ home: h });
  const bundle = projectInstall(project, h);
  const file = path.join(globalBundle(h), 'capability.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.engines = { gsd: '>=9.0.0' };
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2) + '\n');
  const r = doctor(project, h, bundle).check('gate-bundle');
  assert.equal(r && r.status, 'error', JSON.stringify(r));
  assert.ok(r.message.includes(`would run ${globalBundle(h)}/scripts/gate.cjs, but gsd-core loads the bundle at ${bundle}`), r.message);
});

test('loadedCopy follows the loader precedence: a global capability.json wins unless gsd-core reports the global copy skipped', () => {
  const { loadedCopy } = require('../memanto.cjs');
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: {} });
  handCopyGlobal(h);
  const scopeDirs = { global: globalBundle(h), project: path.join(project, '.gsd', 'capabilities', 'memanto') };
  const roots = { gsdHome: h, projectRoot: project };
  const projectActive = [{ id: 'memanto', scope: 'project', status: 'active' }];
  const global = { scope: 'global', dir: scopeDirs.global };
  // No render evidence: the precedence rule alone, whatever capability list says.
  assert.deepEqual(loadedCopy({ rows: projectActive, scopeDirs, roots, failures: null }), global);
  // The project copy collided with the global one.
  assert.deepEqual(loadedCopy({ rows: projectActive, scopeDirs, roots, failures: ['id collides with an already-registered capability'] }), global);
  // A ledgered global row that is not active: gsd-core skipped the global copy.
  const globalRow = { id: 'memanto', scope: 'global', status: 'incompatible' };
  assert.equal(loadedCopy({ rows: [globalRow], scopeDirs, roots, failures: [] }), null, 'no project copy is active');
  assert.deepEqual(loadedCopy({ rows: [globalRow, ...projectActive], scopeDirs, roots, failures: [] }), { scope: 'project', dir: scopeDirs.project });
  // An unledgered global copy skipped for a reason only the first-scanned copy can get.
  const engines = ['incompatible with GSD 1.20.1 (requires engines.gsd ">=9.0.0")'];
  assert.equal(loadedCopy({ rows: [], scopeDirs, roots, failures: engines }), null);
  // With no global capability.json, only the active project row counts.
  const h2 = env.tmpDir('memanto-home-');
  assert.deepEqual(
    loadedCopy({ rows: projectActive, scopeDirs, roots: { gsdHome: h2, projectRoot: project }, failures: null }),
    { scope: 'project', dir: scopeDirs.project },
  );
});

// Round-4 WR-01: gsd-core can skip a LEDGERED global copy that capability list
// still shows as active (an invalid fragment, a failed validation, a clash).
// loop render-hooks prints the reason with no scope. A reason the loader gives
// only after its id-collision check names the global copy (a project copy is
// skipped as colliding first while the global copy holds the id), so the
// global copy is not loaded. A reason either copy can get is undetermined.
test('loadedCopy: a skip reason that names the global copy means it is not loaded, even with an active global row', () => {
  const { loadedCopy } = require('../memanto.cjs');
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: {} });
  handCopyGlobal(h);
  const { dir: projectDir } = plantProjectBundle(project);
  const scopeDirs = { global: globalBundle(h), project: projectDir };
  const roots = { gsdHome: h, projectRoot: project };
  const rows = [
    { id: 'memanto', scope: 'global', status: 'active' },
    { id: 'memanto', scope: 'project', status: 'active' },
  ];
  for (const reason of [
    'invalid hook fragment: memanto/contributions[0].fragment.path could not be read: missing-fragment.md',
    'hook fragment could not be materialized: EACCES',
    'cross-capability validation failed: x',
    'cross-capability validation error: x',
    'owns skill "x" already owned by another capability',
    'owns command family "memanto" already owned by another capability',
    'incompatible with GSD 1.20.1 (requires engines.gsd ">=9.0.0")',
    'configHome confinement rejected: x',
  ]) {
    assert.deepEqual(loadedCopy({ rows, scopeDirs, roots, failures: [reason] }), { scope: 'project', dir: projectDir }, reason);
  }
  for (const reason of [
    'failed validation: title must be a non-empty string',
    'unreadable or invalid capability.json: x',
    'id uses a reserved first-party prefix (gsd-/gsd-core-/anthropic-)',
    'a reason this gsd-core version does not give',
  ]) {
    assert.deepEqual(loadedCopy({ rows, scopeDirs, roots, failures: [reason] }), { scope: 'unknown', dir: null, reasons: [reason] }, reason);
  }
  // A collision proves the global copy holds the id.
  assert.equal(loadedCopy({ rows, scopeDirs, roots, failures: ['id collides with an already-registered capability'] }).scope, 'global');
});

// The reviewer's repro (modes fragment and validation): a global capability
// install plus a consented project install, then the global manifest is broken
// so gsd-core skips the global copy and loads the project one. The predicate
// still runs the installed global scripts/gate.cjs, so gate-bundle is an error.
function ledgeredGlobalSkipped(mode) {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  env.installBundle({ home: h });
  const bundle = projectInstall(project, h);
  const file = path.join(globalBundle(h), 'capability.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (mode === 'fragment') {
    manifest.contributions = [{ point: 'discuss:pre', into: 'orchestrator', produces: [], consumes: [], fragment: { path: 'missing-fragment.md' } }];
  } else {
    manifest.title = '';
  }
  fs.writeFileSync(file, JSON.stringify(manifest, null, 2));
  const marker = path.join(project, 'GLOBAL-GATE-RAN');
  const gate = path.join(globalBundle(h), 'scripts', 'gate.cjs');
  const src = fs.readFileSync(gate, 'utf8');
  const nl = src.startsWith('#!') ? src.indexOf('\n') + 1 : 0;
  fs.writeFileSync(gate, `${src.slice(0, nl)}require('fs').writeFileSync(${JSON.stringify(marker)}, 'x');\n${src.slice(nl)}`);
  return { h, project, bundle, marker };
}

for (const mode of ['fragment', 'validation']) {
  test(`reviewer repro (${mode}): a ledgered global copy gsd-core skips makes gate-bundle an error naming both copies`, () => {
    const { h, project, bundle, marker } = ledgeredGlobalSkipped(mode);
    // The host loads the project copy, and its rendered gate runs the global gate.cjs.
    runGate(project, h);
    assert.equal(fs.existsSync(marker), true, 'the repro no longer runs the global gate.cjs');
    const d = doctor(project, h, bundle);
    assert.equal(d.status, 1, JSON.stringify(d.rep));
    const gb = d.check('gate-bundle');
    assert.equal(gb && gb.status, 'error', JSON.stringify(gb));
    const loaded = d.check('loaded');
    const dup = d.check('duplicate-install');
    assert.ok(!dup.message.includes('gsd-core keeps the global one'), `duplicate-install claims the global copy: ${dup.message}`);
    if (mode === 'fragment') {
      // An invalid fragment is a reason only the global copy can get here.
      assert.ok(gb.message.includes(`would run ${globalBundle(h)}/scripts/gate.cjs, but gsd-core loads the bundle at ${bundle}`), gb.message);
      assert.ok(gb.message.includes('gsd-core skipped the global copy: invalid hook fragment'), gb.message);
      assert.equal(loaded.status, 'ok', JSON.stringify(loaded));
      assert.ok(loaded.message.includes(`gsd-core loads the project copy at ${bundle}`), loaded.message);
    } else {
      // A failed validation can belong to either copy: undetermined, never assumed.
      for (const r of [gb, loaded]) {
        assert.equal(r.status, 'error', JSON.stringify(r));
        assert.ok(r.message.includes('doctor cannot tell whether it skipped the global copy'), r.message);
        assert.ok(r.message.includes(globalBundle(h)) && r.message.includes(bundle), r.message);
        assert.ok(r.message.includes('failed validation'), r.message);
      }
    }
  });
}

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

// --- Round-2 IN-04: the inline predicate and lib/gate-bundle.cjs agree ---
// The selection rule exists twice (the predicate must decide before it runs
// any bundle code). This matrix runs the real predicate command with sh and
// resolveGateBundle over the same fixtures, and fails when they disagree or
// leave the expected scope. Fixtures are hand-written, no host involved; each
// fixture gate.cjs prints which directory it was loaded from.

const COMMITTED = { id: 'memanto', version: MANIFEST.version, source: 'fixture', integrity: '', files: [], sharedEdits: [] };

function fixtureScope(root, { manifest = true, manifestId = 'memanto', gate = true, entry } = {}) {
  const dir = path.join(root, '.gsd', 'capabilities', 'memanto');
  fs.mkdirSync(path.join(dir, 'scripts'), { recursive: true });
  if (manifest) fs.writeFileSync(path.join(dir, 'capability.json'), JSON.stringify({ ...MANIFEST, id: manifestId }));
  if (gate) fs.writeFileSync(path.join(dir, 'scripts', 'gate.cjs'), 'process.stdout.write("RAN:" + require("path").dirname(__dirname)); process.exit(0);\n');
  if (entry !== undefined) {
    fs.writeFileSync(path.join(root, '.gsd-capabilities.json'), JSON.stringify({ version: 1, updatedAt: 'x', entries: { memanto: entry } }));
  }
}

const MATRIX = [
  ['global valid', { global: { entry: COMMITTED } }, 'global'],
  ['global valid, project ledgered too', { global: { entry: COMMITTED }, project: { entry: COMMITTED } }, 'global'],
  ['global unledgered (hand-copied)', { global: {} }, null],
  ['planted project ledger with an unledgered global present', { global: {}, project: { entry: COMMITTED } }, null],
  ['global absent, project ledgered', { project: { entry: COMMITTED } }, 'project'],
  ['global holds only a stray gate.cjs, project ledgered', { global: { manifest: false }, project: { entry: COMMITTED } }, 'project'],
  ['global absent, project unledgered', { project: {} }, null],
  ['neither scope', {}, null],
  ['global entry pending', { global: { entry: { ...COMMITTED, _pending: { op: 'install' } } }, project: { entry: COMMITTED } }, null],
  ['global entry missing version', { global: { entry: { ...COMMITTED, version: undefined } }, project: { entry: COMMITTED } }, null],
  ['global manifest with another id', { global: { manifestId: 'other', entry: COMMITTED }, project: { entry: COMMITTED } }, null],
  ['project entry missing files', { project: { entry: { ...COMMITTED, files: undefined } } }, null],
];

for (const [label, layout, expected] of MATRIX) {
  test(`predicate and resolveGateBundle agree: ${label}`, () => {
    const { resolveGateBundle } = require('../lib/gate-bundle.cjs');
    const h = env.tmpDir('memanto-home-');
    const project = env.tmpDir('memanto-proj-');
    if (layout.global) fixtureScope(h, layout.global);
    if (layout.project) fixtureScope(project, layout.project);
    const want = expected === null ? null : path.join(expected === 'global' ? h : project, '.gsd', 'capabilities', 'memanto');

    const moduleChoice = resolveGateBundle({ gsdHome: h, projectRoot: project });
    const res = spawnSync('sh', ['-c', PREDICATE.command], {
      cwd: project,
      encoding: 'utf8',
      env: { ...process.env, GSD_HOME: h },
      timeout: 15000,
    });
    let predicateChoice;
    if (res.status === 0 && res.stdout.startsWith('RAN:')) predicateChoice = res.stdout.slice(4);
    else if (res.status === 1 && res.stderr.includes('memanto: BLOCKED [gate-bundle]')) predicateChoice = null;
    else assert.fail(`unexpected predicate result (exit ${res.status}): ${res.stdout}${res.stderr}`);

    assert.equal(moduleChoice, want, `resolveGateBundle: ${label}`);
    assert.equal(predicateChoice === null ? null : fs.realpathSync(predicateChoice), want === null ? null : fs.realpathSync(want), `predicate: ${label}`);
  });
}
