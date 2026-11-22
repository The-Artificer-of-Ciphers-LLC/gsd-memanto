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
const { assertConsistent } = require('./helpers/install-invariants.cjs');
const { resolveGateBundle } = require('../lib/gate-bundle.cjs');

const PHASE_DIR = '.planning/phases/01-test';
const MANIFEST = JSON.parse(fs.readFileSync(path.join(env.REPO_ROOT, 'capability.json'), 'utf8'));
const PREDICATE = MANIFEST.gates.find((g) => g.point === 'discuss:pre').check.predicate;
const servers = {};

// The rendered hook is the shipped discuss:pre gate (round-9 WR-01).
function isShippedGate(x) {
  return Boolean(
    x && x.kind === 'gate' && x.blocking === true && x.onError === 'halt' && x.check && x.check.predicate &&
      x.check.predicate.kind === PREDICATE.kind && x.check.predicate.command === PREDICATE.command,
  );
}

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
  assert.ok(r.message.includes(`by the loader's precedence gsd-core would load memanto from ${stray}`), r.message);
  assert.ok(!r.message.includes('gsd-core loads memanto from'), `load claimed without render evidence: ${r.message}`);
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

// Round-5 WR-01 repro: a hand-copied global capability squats the config key
// memanto.enabled, so gsd-core skips BOTH memanto copies (global install and
// consented project install) for the same post-collision reason and renders no
// memanto hook. No doctor record may claim a loaded copy.
test('round-5 repro: when gsd-core skips both copies, loaded is an error and no record claims a loaded copy', () => {
  const h = env.tmpDir('memanto-home-');
  const project = emptyAgentProject();
  env.installBundle({ home: h });
  const bundle = projectInstall(project, h);
  const sq = path.join(h, '.gsd', 'capabilities', 'aaa-squat');
  fs.mkdirSync(sq, { recursive: true });
  fs.writeFileSync(
    path.join(sq, 'capability.json'),
    JSON.stringify({
      id: 'aaa-squat', role: 'feature', title: 'squat', description: 'squat', version: '0.0.1', tier: 'full', requires: [],
      runtimeCompat: { supported: ['*'], unsupported: [] }, skills: [], agents: [],
      config: { 'memanto.enabled': { type: 'boolean', default: false, description: 'x' } }, steps: [], contributions: [], gates: [],
    }),
  );
  assert.equal(env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home: h })).length, 0, 'the repro no longer skips both copies');
  const d = doctor(project, h, bundle);
  assert.equal(d.status, 1, JSON.stringify(d.rep));
  const loaded = d.check('loaded');
  assert.equal(loaded.status, 'error', JSON.stringify(loaded));
  assert.ok(loaded.message.includes('gsd-core loaded neither memanto copy'), loaded.message);
  assert.ok(loaded.message.includes('owns config key "memanto.enabled"'), loaded.message);
  assert.ok(loaded.message.includes('both copies'), `the per-copy count was lost: ${loaded.message}`);
  for (const id of ['loaded', 'duplicate-install', 'gate-bundle']) {
    const r = d.check(id);
    for (const claim of ['loads the project copy', 'loads the global copy', 'loads the project one', 'keeps the global one', 'loads the bundle at', 'loads memanto from', 'runs the installed bundle gsd-core loads']) {
      assert.ok(!r.message.includes(claim), `${id} claims a loaded copy (${claim}): ${r.message}`);
    }
    assert.ok(!/reinstall|capability install/.test(r.fix) || r.fix.includes('load error'), `${id} fix ignores the load error: ${r.fix}`);
  }
  const gb = d.check('gate-bundle');
  assert.equal(gb.status, 'error', JSON.stringify(gb));
  assert.ok(gb.message.includes('gsd-core loaded neither memanto copy'), gb.message);
  assert.ok(d.check('duplicate-install').message.includes('gsd-core loaded neither of them'), d.check('duplicate-install').message);
  // Round-6 WR-01: every reason is an ownership clash, so the clash fix applies.
  assert.ok(loaded.fix.includes('does not clear it'), loaded.fix);
  assertDoctorConsistent(d, h, project, { stray: null, loadedScope: null });
});

// Round-6 WR-01 repros (reviewer's single.cjs): ONE memanto copy, skipped. The
// wording names that copy (never "neither"), and the fix follows the reason: an
// ownership clash is not cleared by a reinstall, an engines.gsd failure is, and
// loaded never contradicts the engines record.
function plantSquat(h) {
  const sq = path.join(h, '.gsd', 'capabilities', 'aaa-squat');
  fs.mkdirSync(sq, { recursive: true });
  fs.writeFileSync(
    path.join(sq, 'capability.json'),
    JSON.stringify({
      id: 'aaa-squat', role: 'feature', title: 'squat', description: 'squat', version: '0.0.1', tier: 'full', requires: [],
      runtimeCompat: { supported: ['*'], unsupported: [] }, skills: [], agents: [],
      config: { 'memanto.enabled': { type: 'boolean', default: false, description: 'x' } }, steps: [], contributions: [], gates: [],
    }),
  );
}

for (const mode of ['gengines', 'gsquat', 'psquat']) {
  test(`round-6 repro ${mode}: one skipped copy is named as that copy, with a fix that matches the reason`, () => {
    const h = env.tmpDir('memanto-home-');
    const project = emptyAgentProject();
    let bundle;
    if (mode.startsWith('g')) {
      env.installBundle({ home: h });
      bundle = globalBundle(h);
    } else {
      bundle = projectInstall(project, h);
    }
    if (mode.endsWith('squat')) {
      plantSquat(h);
    } else {
      const mf = path.join(bundle, 'capability.json');
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      m.engines = { gsd: '>=9.0.0' };
      fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    }
    assert.equal(env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home: h })).length, 0, `${mode} no longer skips the copy`);
    const d = doctor(project, h, bundle);
    assert.equal(d.status, 1, JSON.stringify(d.rep));
    const scope = mode.startsWith('g') ? 'global' : 'project';
    for (const id of ['loaded', 'gate-bundle']) {
      const r = d.check(id);
      assert.equal(r.status, 'error', JSON.stringify(r));
      assert.ok(!r.message.includes('neither'), `${id} says neither with one copy: ${r.message}`);
      assert.ok(r.message.includes(`gsd-core did not load the ${scope} memanto copy at ${bundle}`), `${id}: ${r.message}`);
      if (mode.endsWith('squat')) {
        assert.ok(r.message.includes('owns config key "memanto.enabled"'), r.message);
        assert.ok(r.fix.includes('does not clear it'), `${id} clash fix: ${r.fix}`);
      } else {
        assert.ok(r.message.includes('incompatible with GSD'), r.message);
        assert.ok(!r.fix.includes('does not clear'), `${id} contradicts the engines record: ${r.fix}`);
        assert.ok(r.fix.includes('capability install npm:@taoc/gsd-memanto@'), `${id} fix gives no reinstall: ${r.fix}`);
        assert.ok(r.fix.includes('engines'), `${id} fix does not point at the engines check: ${r.fix}`);
      }
    }
    assertDoctorConsistent(d, h, project, { stray: null, loadedScope: null });
    if (mode === 'gengines') {
      const eng = d.check('engines');
      assert.ok(/install a memanto release/.test(eng.fix), JSON.stringify(eng));
    }
  });
}

// Round-7/8: the doctor-level consistency rules (test/helpers/install-invariants.cjs)
// over a real doctor run. Round-8 WR-03: the facts come from the disk, from a
// render-hooks call of the test's own, and from the case definition
// (loadedScope: the copy the repro makes gsd-core load), never from doctor.
function ledgerLists(root) {
  try {
    return Boolean(JSON.parse(fs.readFileSync(path.join(root, '.gsd-capabilities.json'), 'utf8')).entries.memanto);
  } catch {
    return false;
  }
}

function realOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function assertDoctorConsistent(d, h, project, { stray, loadedScope } = {}) {
  const dirs = { global: globalBundle(h), project: path.join(project, '.gsd', 'capabilities', 'memanto') };
  const same = realOr(dirs.global) === realOr(dirs.project);
  const man = { global: fs.existsSync(path.join(dirs.global, 'capability.json')), project: fs.existsSync(path.join(dirs.project, 'capability.json')) };
  const led = { global: ledgerLists(h), project: ledgerLists(project) };
  const marker = fs.existsSync(path.join(project, '.planning')) || fs.existsSync(path.join(project, '.git'));
  const copyScopes = same ? (man.global ? [marker ? 'project' : 'global'] : []) : ['global', 'project'].filter((sc) => man[sc]);
  const ledgeredDirs = same ? (led.global || led.project ? [dirs.global] : []) : ['global', 'project'].filter((sc) => led[sc]).map((sc) => dirs[sc]);
  let enabled = false;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(project, '.planning', 'config.json'), 'utf8'));
    enabled = Boolean(cfg.memanto && cfg.memanto.enabled === true);
  } catch {
    /* no config: disabled */
  }
  // Round-9 WR-01: the gate counts only when it is the shipped one: blocking,
  // onError halt and the exact predicate of this repository's capability.json.
  const gateRendered = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home: h })).some(isShippedGate);
  assertConsistent(
    ['loaded', 'consent', 'duplicate-install', 'gate-bundle'].map((id) => d.check(id)),
    {
      stray,
      twoCopies: copyScopes.length === 2,
      ledgeredDirs,
      dirs: same ? { global: dirs.project, project: dirs.project } : dirs,
      enabled,
      gateRendered,
      loadedScope,
      gateRunsDir: resolveGateBundle({ gsdHome: h, projectRoot: project }),
      onlyScope: copyScopes.length === 1 ? copyScopes[0] : undefined,
    },
    JSON.stringify(d.rep.checks.map((c) => c.id)),
  );
  // Round-8 CR-01: with memanto enabled, doctor always renders discuss:pre and
  // agrees with the host about whether the memanto gate renders there.
  if (enabled) {
    const r = d.check('render:discuss:pre');
    assert.ok(r, `doctor did not render discuss:pre: ${JSON.stringify(d.rep.checks.map((c) => c.id))}`);
    assert.equal(r.status === 'ok', gateRendered, JSON.stringify(r));
  }
}

// Round-7 repros (reviewer's r7.cjs modes and collide.cjs). Each builds the
// state in a temp GSD_HOME, runs doctor and checks the four records agree.
const CFG7 = () => ({ memanto: { enabled: true, agent_id: '', backend_url: servers.ok.url, api_url: servers.ok.url } });
const R7 = {
  strayproj(h, project) {
    const dir = path.join(project, '.gsd', 'capabilities', 'memanto');
    fs.cpSync(env.stageBundle(), dir, { recursive: true });
    return { bundle: dir, stray: dir, loadedScope: null };
  },
  strayglobal(h) {
    const dir = handCopyGlobal(h);
    return { bundle: dir, stray: dir, loadedScope: 'global' };
  },
  nothing() {
    return { bundle: env.stageBundle(), stray: null, loadedScope: null };
  },
  globalplusstray(h, project) {
    env.installBundle({ home: h });
    const mf = path.join(globalBundle(h), 'capability.json');
    const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
    m.engines = { gsd: '>=9.0.0' };
    fs.writeFileSync(mf, JSON.stringify(m, null, 2));
    const pd = path.join(project, '.gsd', 'capabilities', 'memanto');
    fs.mkdirSync(path.join(pd, 'scripts'), { recursive: true });
    fs.writeFileSync(path.join(pd, 'scripts', 'gate.cjs'), 'process.exit(0)\n');
    return { bundle: globalBundle(h), stray: pd, loadedScope: null };
  },
  collide(h, project) {
    const bundle = projectInstall(project, h);
    const g = globalBundle(h);
    fs.mkdirSync(g, { recursive: true });
    const m = JSON.parse(fs.readFileSync(path.join(bundle, 'capability.json'), 'utf8'));
    m.gates = [];
    m.steps = [];
    m.contributions = [];
    delete m.commands;
    fs.writeFileSync(path.join(g, 'capability.json'), JSON.stringify(m, null, 2));
    return { bundle, stray: null, loadedScope: 'global' };
  },
};

for (const mode of Object.keys(R7)) {
  test(`round-7 repro ${mode}: the four install records agree and stray gate code is named`, () => {
    const h = env.tmpDir('memanto-home-');
    const project = env.makeProject({ config: CFG7(), phaseDirs: ['01-test'] });
    const { bundle, stray, loadedScope } = R7[mode](h, project);
    const d = doctor(project, h, bundle);
    assert.equal(d.status, 1, JSON.stringify(d.rep));
    assertDoctorConsistent(d, h, project, { stray, loadedScope });
    const loaded = d.check('loaded');
    const gb = d.check('gate-bundle');
    if (mode === 'strayproj') {
      assert.ok(gb.message.includes('stray or planted gate code'), gb.message);
      assert.ok(gb.fix.startsWith(`delete ${stray} by hand`), gb.fix);
      assert.ok(!gb.message.includes('did not load'), `implies gsd-core tried to load it: ${gb.message}`);
    }
    if (mode === 'strayglobal') {
      assert.ok(loaded.message.includes(`gsd-core loads the global memanto copy at ${stray}`), loaded.message);
    }
    if (mode === 'collide') {
      for (const r of [loaded, gb]) {
        assert.ok(!/neither/.test(r.message), r.message);
        assert.ok(!r.fix.includes('does not clear'), r.fix);
        assert.ok(r.message.includes(`gsd-core loaded the global memanto copy at ${globalBundle(h)}, but it renders no memanto gate at discuss:pre`), r.message);
        assert.ok(r.fix.startsWith(`delete ${globalBundle(h)} by hand`), r.fix);
        assert.ok(r.fix.includes(`keep the installed project bundle at ${bundle}`), r.fix);
      }
    }
  });
}

// Round-7 IN-01 repro (homeproj): the project root IS GSD_HOME, so the one
// install is one directory. Doctor must count directories, not manifests.
test('round-7 repro homeproj: with the project root at GSD_HOME, one copy is never "neither"', () => {
  const h = env.tmpDir('memanto-home-');
  fs.mkdirSync(path.join(h, '.planning', 'phases', '01-test'), { recursive: true });
  fs.writeFileSync(path.join(h, '.planning', 'config.json'), JSON.stringify(CFG7()));
  env.installBundle({ home: h });
  const mf = path.join(globalBundle(h), 'capability.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  m.engines = { gsd: '>=9.0.0' };
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
  const d = doctor(h, h, globalBundle(h));
  assert.equal(d.status, 1, JSON.stringify(d.rep));
  assertDoctorConsistent(d, h, h, { stray: null, loadedScope: null });
  for (const id of ['loaded', 'gate-bundle']) {
    assert.ok(d.check(id).message.includes(`gsd-core did not load the project memanto copy at ${globalBundle(h)}`), d.check(id).message);
  }
  assert.equal(d.check('duplicate-install').status, 'ok');
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
    assertDoctorConsistent(d, h, project, { stray: null, loadedScope: mode === 'fragment' ? 'project' : '?' });
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

// Round-8 repros (reviewer's r8.cjs, r8b.cjs and r8c.cjs). Each builds the
// state in a temp GSD_HOME, runs doctor (from a clean staged bundle unless the
// mode says otherwise) and checks the records against the host's own render.
function editGlobalManifest(h, edit) {
  const mf = path.join(globalBundle(h), 'capability.json');
  const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
  edit(m);
  fs.writeFileSync(mf, JSON.stringify(m, null, 2));
}

function homeProject(h) {
  fs.mkdirSync(path.join(h, '.planning', 'phases', '01-test'), { recursive: true });
  fs.writeFileSync(path.join(h, '.planning', 'config.json'), JSON.stringify(CFG7()));
}

const R8 = {
  // CR-01: the installed global manifest declares no gate.
  gnogate(h, project) {
    env.installBundle({ home: h });
    editGlobalManifest(h, (m) => (m.gates = []));
    return { project, home: h, loadedScope: 'global' };
  },
  twonogate(h, project) {
    env.installBundle({ home: h });
    projectInstall(project, h);
    editGlobalManifest(h, (m) => (m.gates = []));
    return { project, home: h, loadedScope: 'global' };
  },
  twoinvalid(h, project) {
    env.installBundle({ home: h });
    projectInstall(project, h);
    editGlobalManifest(h, (m) => {
      m.gates = [];
      m.title = '';
    });
    return { project, home: h, loadedScope: 'project' };
  },
  // WR-01: a ledgered install whose manifest is corrupt, or whose ledger entry is _pending.
  gcorrupt(h, project) {
    env.installBundle({ home: h });
    fs.writeFileSync(path.join(globalBundle(h), 'capability.json'), '{');
    return { project, home: h, loadedScope: null };
  },
  gpending(h, project) {
    env.installBundle({ home: h });
    const lf = path.join(h, '.gsd-capabilities.json');
    const l = JSON.parse(fs.readFileSync(lf, 'utf8'));
    l.entries.memanto._pending = { op: 'upgrade' };
    fs.writeFileSync(lf, JSON.stringify(l, null, 2));
    return { project, home: h, loadedScope: null };
  },
  // WR-02: the project root is GSD_HOME, by path or through a symlink.
  homeplain(h) {
    homeProject(h);
    env.installBundle({ home: h });
    return { project: h, home: h, loadedScope: null };
  },
  homesym(h) {
    homeProject(h);
    env.installBundle({ home: h });
    const link = path.join(env.tmpDir('memanto-link-'), 'home');
    fs.symlinkSync(h, link);
    return { project: h, home: link, loadedScope: null };
  },
};

for (const mode of Object.keys(R8)) {
  test(`round-8 repro ${mode}: doctor fails closed and the four install records agree with the host`, () => {
    const h = env.tmpDir('memanto-home-');
    const { project, home, loadedScope } = R8[mode](h, env.makeProject({ config: CFG7(), phaseDirs: ['01-test'] }));
    const d = doctor(project, home, env.stageBundle());
    assert.equal(d.status, 1, JSON.stringify(d.rep));
    assertDoctorConsistent(d, home, project, { stray: null, loadedScope });
    const loaded = d.check('loaded');
    const gb = d.check('gate-bundle');
    // twoinvalid: the project copy loaded and its gate renders, so loaded is ok;
    // its gate runs the global gate.cjs gsd-core rejected, so gate-bundle is an error.
    assert.equal(loaded && loaded.status, mode === 'twoinvalid' ? 'ok' : 'error', JSON.stringify(loaded));
    assert.equal(gb && gb.status, 'error', JSON.stringify(gb));
    if (mode === 'gnogate' || mode === 'twonogate' || mode === 'twoinvalid') {
      // The doctor's own manifest declares the gate, so discuss:pre is always rendered.
      const rd = d.check('render:discuss:pre');
      assert.equal(rd.status, mode === 'twoinvalid' ? 'ok' : 'error', JSON.stringify(rd));
      // Round-9 IN-03: no load error was reported, so the fix is the reinstall of the loaded copy.
      if (mode !== 'twoinvalid') {
        assert.ok(!/load error/.test(rd.fix), rd.fix);
        assert.ok(!/memanto\.enabled/.test(rd.fix), rd.fix);
        assert.ok(rd.fix.includes(`reinstall the global copy at ${globalBundle(h)} in place at this release`), rd.fix);
        for (const r of [loaded, gb]) assert.ok(!/memanto\.enabled/.test(r.fix), `${r.id}: ${r.fix}`);
      }
    }
    if (mode === 'gnogate') {
      assert.ok(loaded.message.includes('declares no discuss:pre gate'), loaded.message);
      assert.ok(loaded.fix.includes(`reinstall the global copy at ${globalBundle(h)} in place at this release`), loaded.fix);
    }
    if (mode === 'twonogate') {
      assert.ok(d.check('duplicate-install').message.includes('gsd-core keeps the global one, which renders no memanto gate'), d.check('duplicate-install').message);
    }
    if (mode === 'twoinvalid') {
      const bundle = path.join(project, '.gsd', 'capabilities', 'memanto');
      assert.ok(gb.message.includes(`would run ${globalBundle(h)}/scripts/gate.cjs, but gsd-core loads the bundle at ${bundle}`), gb.message);
    }
    if (mode === 'gcorrupt' || mode === 'gpending') {
      for (const r of [loaded, gb]) {
        assert.ok(!/stray or planted/.test(r.message), r.message);
        assert.ok(!/\bdelete\b/.test(r.fix), `a ledgered install is never deleted by hand: ${r.fix}`);
      }
      if (mode === 'gcorrupt') assert.ok(loaded.fix.startsWith('reinstall the global copy in place'), loaded.fix);
      else {
        assert.ok(loaded.message.includes('_pending'), loaded.message);
        assert.ok(loaded.fix.startsWith('finish or roll back the interrupted global install'), loaded.fix);
        // IN-01: no unhedged load claim without render evidence.
        assert.ok(!gb.message.includes('gsd-core loads memanto from'), gb.message);
      }
    }
    if (mode === 'homeplain' || mode === 'homesym') {
      assert.equal(d.check('duplicate-install').status, 'ok', JSON.stringify(d.check('duplicate-install')));
      for (const r of [loaded, gb, d.check('consent')]) {
        assert.ok(r.fix.includes('re-consent') && r.fix.includes('--scope project'), `${r.id}: ${r.fix}`);
        assert.ok(!/\bglobal (?:memanto )?copy\b/.test(r.message), `${r.id} calls the one copy global: ${r.message}`);
      }
    }
  });
}

// Round-9 WR-01 (reviewer's r9h.cjs gexit0 and gnonblock, with the fake API
// instead of the live /health): the installed global gate renders, but it is
// not the shipped gate. Doctor must not call it loaded or enforced.
const R9H = {
  gexit0: { edit: (m) => (m.gates[0].check.predicate.command = 'exit 0'), field: 'command' },
  gnonblock: {
    edit: (m) => {
      m.gates[0].blocking = false;
      m.gates[0].onError = 'skip';
    },
    field: 'blocking, onError',
  },
  // One trailing space: the command is compared exactly.
  gspace: { edit: (m) => (m.gates[0].check.predicate.command = `${PREDICATE.command} `), field: 'command' },
};

for (const [mode, { edit, field }] of Object.entries(R9H)) {
  test(`round-9 repro ${mode}: a rendered memanto gate that is not the shipped one is an error in loaded, render and gate-bundle`, () => {
    const h = env.tmpDir('memanto-home-');
    const project = env.makeProject({
      config: { memanto: { enabled: true, agent_id: 'r9-agent', backend_url: servers.ok.url, api_url: servers.ok.url } },
      phaseDirs: ['01-test'],
    });
    env.installBundle({ home: h });
    editGlobalManifest(h, edit);
    const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home: h }));
    assert.equal(hooks.length, 1, 'the edited gate no longer renders');
    assert.equal(isShippedGate(hooks[0]), false);
    const d = doctor(project, h, env.stageBundle());
    assert.equal(d.status, 1, JSON.stringify(d.rep));
    const rd = d.check('render:discuss:pre');
    assert.equal(rd.status, 'error', JSON.stringify(rd));
    assert.ok(rd.message.includes(`the installed memanto gate at discuss:pre does not match this release: ${field}`), rd.message);
    assert.ok(rd.fix.includes('capability install npm:@taoc/gsd-memanto@'), rd.fix);
    for (const id of ['loaded', 'gate-bundle']) {
      const r = d.check(id);
      assert.equal(r.status, 'error', JSON.stringify(r));
      assert.ok(r.message.includes(`does not match this release: ${field}`), `${id}: ${r.message}`);
      assert.ok(r.fix.includes('reinstall the global copy') && r.fix.includes('in place'), `${id}: ${r.fix}`);
    }
    assertDoctorConsistent(d, h, project, { stray: null, loadedScope: 'global' });
  });
}

test('round-9 WR-01: the shipped gate rendered from a clean global install is ok in loaded, render and gate-bundle', () => {
  const h = env.tmpDir('memanto-home-');
  const project = env.makeProject({
    config: { memanto: { enabled: true, agent_id: 'r9-agent', backend_url: servers.ok.url, api_url: servers.ok.url } },
    phaseDirs: ['01-test'],
  });
  env.installBundle({ home: h });
  const d = doctor(project, h, env.stageBundle());
  for (const id of ['loaded', 'render:discuss:pre', 'gate-bundle']) assert.equal(d.check(id).status, 'ok', JSON.stringify(d.check(id)));
  assertDoctorConsistent(d, h, project, { stray: null, loadedScope: 'global' });
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

// Round-9 IN-02: the loader (capability-loader.cjs ledgerOverlayIds) treats an
// entry as pending only when _pending is truthy; a present but falsy _pending
// is neither pending nor committed.
test('ledgerState: _pending counts only when truthy, as in the loader', () => {
  const { ledgerState, isInstalledBundle } = require('../lib/gate-bundle.cjs');
  const cases = [
    [{ op: 'install' }, 'pending'],
    [true, 'pending'],
    [null, 'none'],
    [false, 'none'],
    [0, 'none'],
    ['', 'none'],
  ];
  for (const [pending, want] of cases) {
    const root = env.tmpDir('memanto-led-');
    fixtureScope(root, { entry: { ...COMMITTED, _pending: pending } });
    assert.equal(ledgerState(root), want, JSON.stringify(pending));
    assert.equal(isInstalledBundle(root), false, JSON.stringify(pending));
  }
  const root = env.tmpDir('memanto-led-');
  fixtureScope(root, { entry: COMMITTED });
  assert.equal(ledgerState(root), 'committed');
});

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
