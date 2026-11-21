'use strict';
// D-10 spike regression tests (01-SPIKE.md Q1-Q3). Characterization of the
// installed gsd-core host: every positive spike answer that can run without an
// LLM is pinned here, so a gsd-core update that changes the behavior fails CI.
// All probes use temp GSD_HOMEs; the owner's real ~/.gsd is only stat()ed.
//
// Wave-2 coupling: plan 01-02 adds URL and health checks in parallel, so this
// file asserts gate BLOCK verdicts only (an empty agent_id blocks under every
// phase-1 check set) and never asserts a passing gate.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./helpers/gsd-env.cjs');

const PHASE_DIR = '.planning/phases/01-test';
const BLOCKED_PREFIX = 'command exited 1: memanto: BLOCKED';
const ENABLED_EMPTY_AGENT = { memanto: { enabled: true, agent_id: '' } };

let consentBefore;

before(() => {
  consentBefore = env.realConsentStamp();
});

after(() => env.cleanup());

function enabledProject() {
  return env.makeProject({ config: ENABLED_EMPTY_AGENT, phaseDirs: ['01-test'] });
}

function onlyMemantoGate(point, opts) {
  const rendered = env.renderHooks(point, opts);
  const gates = env.memantoHooks(rendered).filter((h) => h.kind === 'gate');
  assert.equal(gates.length, 1, `expected one memanto gate at ${point}, got ${JSON.stringify(rendered)}`);
  return gates[0];
}

function checkGate(gate, opts) {
  return env.checkPredicate(gate.check.predicate, { ...opts, phaseDir: PHASE_DIR, phaseNumber: '01' });
}

// Copy of the staged bundle with one extra gate identical to the shipped
// discuss:pre gate except for its point.
function stagedVariantWithGateAt(point) {
  const src = env.stageBundle();
  const dest = path.join(env.tmpDir('memanto-variant-stage-'), 'memanto');
  fs.cpSync(src, dest, { recursive: true });
  const manifestPath = path.join(dest, 'capability.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const base = manifest.gates.find((g) => g.point === 'discuss:pre');
  assert.ok(base, 'shipped manifest has no discuss:pre gate to copy');
  manifest.gates.push({ ...JSON.parse(JSON.stringify(base)), point });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return dest;
}

// Minimal temp third-party capability with id memanto, built from scratch
// (not the shipped bundle). Extra manifest fields are merged in by the caller.
function probeCapability(extra, files) {
  const dir = path.join(env.tmpDir('memanto-probe-cap-'), 'memanto');
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id: 'memanto',
    role: 'feature',
    version: '0.0.1',
    title: 'Memanto spike probe',
    description: 'Throwaway probe capability for the phase-1 spike regression tests.',
    tier: 'full',
    requires: [],
    runtimeCompat: { supported: ['*'], unsupported: [] },
    skills: [],
    agents: [],
    config: {
      'memanto.enabled': { type: 'boolean', default: false, description: 'Probe activation switch.' },
    },
    activationKey: 'memanto.enabled',
    steps: [],
    contributions: [],
    gates: [],
    ...extra,
  };
  fs.writeFileSync(path.join(dir, 'capability.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const [rel, body] of Object.entries(files || {})) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

// ---------------------------------------------------------------- Q1 host layer

test('Q1 host: discuss:pre renders the memanto gate with blocking true', () => {
  const home = env.tmpDir('memanto-home-');
  const project = enabledProject();
  env.installBundle({ home });
  const gate = onlyMemantoGate('discuss:pre', { cwd: project, home });
  assert.equal(gate.blocking, true);
  assert.equal(gate.onError, 'halt');
  assert.equal(gate.check.predicate.kind, 'command-exit-zero');
});

test('Q1 host: check predicate blocks with exit 0 and the BLOCKED message for an empty agent_id', () => {
  const home = env.tmpDir('memanto-home-');
  const project = enabledProject();
  env.installBundle({ home });
  const gate = onlyMemantoGate('discuss:pre', { cwd: project, home });
  const res = checkGate(gate, { cwd: project, home });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  assert.equal(res.json.block, true);
  assert.ok(res.json.message.startsWith(BLOCKED_PREFIX), `unexpected message: ${res.json.message}`);
});

test('Q1 host: a bundle whose gate script is missing still blocks (fail closed)', () => {
  const home = env.tmpDir('memanto-home-');
  const project = enabledProject();
  env.installBundle({ home });
  const gate = onlyMemantoGate('discuss:pre', { cwd: project, home });
  const script = path.join(home, '.gsd', 'capabilities', 'memanto', 'scripts', 'gate.cjs');
  assert.ok(fs.existsSync(script), `installed gate script missing before the probe: ${script}`);
  fs.rmSync(script);
  const res = checkGate(gate, { cwd: project, home });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  assert.equal(res.json.block, true, `missing gate script must block, got ${JSON.stringify(res.json)}`);
});

test('Q1 host: a ship:pre variant of the gate renders and blocks', () => {
  const home = env.tmpDir('memanto-home-');
  const project = enabledProject();
  env.installBundle({ home, stagedDir: stagedVariantWithGateAt('ship:pre') });
  const gate = onlyMemantoGate('ship:pre', { cwd: project, home });
  assert.equal(gate.blocking, true);
  const res = checkGate(gate, { cwd: project, home });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  assert.equal(res.json.block, true);
  assert.ok(res.json.message.startsWith(BLOCKED_PREFIX), `unexpected message: ${res.json.message}`);
});

// ------------------------------------------------------------------------- Q2

test('Q2: a ref.command step renders and gsd_run dispatches the third-party memanto family', () => {
  const home = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: { memanto: { enabled: true } }, phaseDirs: ['01-test'] });
  const capDir = probeCapability(
    {
      commands: [{ family: 'memanto', module: 'memanto.cjs', router: 'route', subcommands: ['probe'] }],
      steps: [
        { point: 'discuss:pre', ref: { command: 'memanto probe' }, produces: [], consumes: [], onError: 'skip' },
      ],
    },
    {
      'memanto.cjs':
        "'use strict';\n" +
        'function route(ctx) {\n' +
        "  process.stdout.write(JSON.stringify({ probe: 'ok', args: ctx.args, raw: ctx.raw }) + '\\n');\n" +
        '}\n' +
        'module.exports = { route };\n',
    },
  );
  env.installBundle({ home, stagedDir: capDir });

  const steps = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home })).filter((h) => h.kind === 'step');
  assert.equal(steps.length, 1, `expected one memanto step at discuss:pre, got ${JSON.stringify(steps)}`);
  assert.equal(steps[0].ref.command, 'memanto probe');
  assert.match(steps[0].ref.command, /^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/);

  const res = env.gsd(['memanto', 'probe', '--phase', '1', '--raw'], { cwd: project, home });
  assert.equal(res.status, 0, `gsd_run memanto probe exited ${res.status}: ${res.stdout}${res.stderr}`);
  const out = JSON.parse(res.stdout);
  assert.equal(out.probe, 'ok');
  assert.deepStrictEqual(out.args, ['memanto', 'probe', '--phase', '1']);
  assert.equal(out.raw, true);
});

// ------------------------------------------------------------------------- Q3

test('Q3 source level: readInstalledCapabilitySkill reads a skill shipped in a global install', () => {
  const home = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: { memanto: { enabled: true } } });
  const capDir = probeCapability(
    { skills: ['memanto-probe'] },
    {
      'skills/memanto-probe/SKILL.md':
        '---\nname: memanto-probe\ndescription: Spike probe skill.\n---\n\nProbe skill body.\n',
    },
  );
  env.installBundle({ home, stagedDir: capDir });

  const { readInstalledCapabilitySkill } = require(path.join(env.coreDir(), 'bin', 'lib', 'install-profiles.cjs'));
  const saved = Object.prototype.hasOwnProperty.call(process.env, 'GSD_HOME') ? process.env.GSD_HOME : undefined;
  try {
    process.env.GSD_HOME = home;
    const registry = env.loadRegistry({ home, cwd: project });
    const found = readInstalledCapabilitySkill('memanto-probe', registry);
    assert.ok(found, 'readInstalledCapabilitySkill returned null for the global probe skill');
    assert.equal(found.capId, 'memanto');
    assert.ok(found.content.includes('name: memanto-probe'), `unexpected skill content: ${found.content}`);
  } finally {
    if (saved === undefined) delete process.env.GSD_HOME;
    else process.env.GSD_HOME = saved;
  }
});

// ---------------------------------------------------------------- prose guards

test('prose guard: installed discuss-phase.md still dispatches discuss:pre hooks', () => {
  const text = fs.readFileSync(path.join(env.coreDir(), 'workflows', 'discuss-phase.md'), 'utf8');
  assert.ok(text.includes('dispatch_discuss_pre_hooks'), 'discuss-phase.md lost the dispatch_discuss_pre_hooks step');
  assert.ok(text.includes('render-hooks discuss:pre'), 'discuss-phase.md no longer calls render-hooks discuss:pre');
});

test('prose guard: installed ship.md still halts on a blocking capability gate', () => {
  const text = fs.readFileSync(path.join(env.coreDir(), 'workflows', 'ship.md'), 'utf8');
  assert.ok(text.includes('Ship blocked by capability gate'), 'ship.md lost the "Ship blocked by capability gate" halt');
});

test('the real ~/.gsd/consent.json is untouched by the spike regression suite', () => {
  assert.equal(env.realConsentStamp(), consentBefore);
});
