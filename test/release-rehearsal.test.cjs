'use strict';
// Round-10 IN-03: an end-to-end release rehearsal (the reviewer's
// scratchpad/r10/release.cjs as a test). The release job runs no tests after
// its bump, so this test runs that exact bump on a copy of what npm would ship
// and checks the bumped bundle the way a user meets it:
//   1. copy the package.json "files" whitelist (plus package.json) to a temp dir;
//   2. run the "Bump the version" run: block of publish.yml there, as written, with
//      bash, BUMP=patch, temp GITHUB_OUTPUT / GITHUB_STEP_SUMMARY files and a stub
//      git with no tags (no repository is created or touched);
//   3. copy the whitelist of the bumped tree into a bundle directory and install it
//      with the real gsd-core host into a temp GSD_HOME, in global and in project scope;
//   4. run doctor in both forms (gsd_run memanto doctor, node memanto.cjs doctor)
//      against the fake API, and the rendered gate through check predicate;
//   5. with an empty agent_id, the gate blocks with [agent-id] and doctor exits 1.
// The host is the one GSD_CORE_DIR names, so CI runs this on every gsd-core
// version of its matrix.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');
const { startFakeApi } = require('./helpers/fake-api.cjs');

const ROOT = env.REPO_ROOT;
const PHASE_DIR = '.planning/phases/01-test';
let api;

before(async () => {
  api = await startFakeApi({ mode: 'ok' });
});

after(async () => {
  await api.close();
  env.cleanup();
});

// The run: block of a publish.yml step, with the YAML block indentation removed.
function runBlock(stepName) {
  const lines = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8').split('\n');
  const at = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  assert.ok(at !== -1, `publish.yml has no "${stepName}" step`);
  const stepIndent = lines[at].length - lines[at].trimStart().length;
  let i = at + 1;
  while (i < lines.length && lines[i].trim() !== 'run: |') i += 1;
  assert.ok(i < lines.length, `"${stepName}" has no run: | block`);
  const body = [];
  for (let k = i + 1; k < lines.length; k += 1) {
    const l = lines[k];
    if (l.trim() !== '' && l.length - l.trimStart().length <= stepIndent) break;
    body.push(l);
  }
  const indent = Math.min(...body.filter((l) => l.trim() !== '').map((l) => l.length - l.trimStart().length));
  return body.map((l) => l.slice(indent)).join('\n').replace(/\n+$/, '\n');
}

function copyWhitelist(from, to) {
  const pkg = JSON.parse(fs.readFileSync(path.join(from, 'package.json'), 'utf8'));
  fs.mkdirSync(to, { recursive: true });
  for (const f of [...pkg.files, 'package.json']) fs.cpSync(path.join(from, f), path.join(to, f), { recursive: true });
  return pkg;
}

function nextPatch(v) {
  const [maj, min, pat] = v.split('-')[0].split('.').map(Number);
  return `${maj}.${min}.${pat + 1}`;
}

// Steps 1-3: the bumped bundle directory and its version.
function bumpedBundle() {
  const work = env.tmpDir('memanto-release-');
  const tree = path.join(work, 'tree');
  copyWhitelist(ROOT, tree);
  const stub = path.join(work, 'stub-bin');
  fs.mkdirSync(stub);
  const gitLog = path.join(work, 'git.log');
  // No repository and no tags: every git call fails, so "tag v<version> already exists" is not hit.
  fs.writeFileSync(path.join(stub, 'git'), `#!/bin/sh\necho "$*" >> '${gitLog}'\nexit 1\n`, { mode: 0o755 });
  const output = path.join(work, 'github-output');
  const summary = path.join(work, 'github-summary');
  const home = path.join(work, 'home');
  fs.mkdirSync(home);
  const res = spawnSync('bash', ['-c', runBlock('Bump the version')], {
    cwd: tree,
    encoding: 'utf8',
    env: { PATH: `${stub}${path.delimiter}${process.env.PATH}`, HOME: home, BUMP: 'patch', GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary },
    timeout: 120000,
  });
  assert.equal(res.status, 0, `the bump step failed: ${res.stdout}${res.stderr}`);
  const current = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const next = nextPatch(current);
  assert.match(fs.readFileSync(output, 'utf8'), new RegExp(`^version=${next.replace(/\./g, '\\.')}$`, 'm'));
  assert.match(fs.readFileSync(gitLog, 'utf8'), new RegExp(`rev-parse -q --verify refs/tags/v${next.replace(/\./g, '\\.')}`));
  const bundle = path.join(work, 'pkg', 'memanto');
  const pkg = copyWhitelist(tree, bundle);
  const cap = JSON.parse(fs.readFileSync(path.join(bundle, 'capability.json'), 'utf8'));
  assert.equal(pkg.version, next);
  assert.equal(cap.version, next);
  const pins = JSON.stringify(cap.gates).match(/npm:@taoc\/gsd-memanto@[0-9A-Za-z.+-]+/g) || [];
  assert.ok(pins.length > 0 && pins.every((p) => p === `npm:@taoc/gsd-memanto@${next}`), JSON.stringify(pins));
  return { bundle, next };
}

let memo = null;
const bumped = () => memo || (memo = bumpedBundle());

function config(project, agentId) {
  env.writeConfig(project, { memanto: { enabled: true, agent_id: agentId, backend_url: api.url, api_url: api.url } });
}

function doctorForms(project, home, installed) {
  const hostEnv = { ...process.env, GSD_HOME: home, GSD_WORKSTREAM: '', GSD_PROJECT: '' };
  const forms = {
    gsd_run: env.gsd(['memanto', 'doctor', '--raw'], { cwd: project, home }),
    direct: spawnSync(process.execPath, [path.join(installed, 'memanto.cjs'), 'doctor', '--raw'], { cwd: project, encoding: 'utf8', env: hostEnv, timeout: 120000 }),
  };
  const out = {};
  for (const [form, res] of Object.entries(forms)) {
    let rep;
    try {
      rep = JSON.parse(res.stdout);
    } catch {
      assert.fail(`${form} doctor printed no JSON (exit ${res.status}): ${res.stdout}${res.stderr}`);
    }
    out[form] = { status: res.status, rep, check: (id) => rep.checks.find((c) => c.id === id) };
  }
  return out;
}

function renderedGate(project, home) {
  const gates = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home })).filter((h) => h.kind === 'gate');
  assert.equal(gates.length, 1, 'expected exactly one memanto gate at discuss:pre');
  return gates[0];
}

// The bump step is a bash script with a sh stub for git: POSIX runners only (CI runs ubuntu and macOS).
const SKIP = process.platform === 'win32' && 'the publish.yml bump step runs on a POSIX runner';

for (const scope of ['global', 'project']) {
  test(`release rehearsal: the patch-bumped bundle installs in ${scope} scope, doctor exits 0 in both forms, and the gate passes and blocks`, { skip: SKIP }, () => {
    const { bundle, next } = bumped();
    const home = env.tmpDir('memanto-home-');
    const project = env.makeProject({ phaseDirs: ['01-test'] });
    config(project, 'release-agent');
    const consentBefore = env.realConsentStamp();
    env.installBundle({ home, stagedDir: bundle, project, ...(scope === 'project' ? { scope: 'project' } : {}) });
    const installed = path.join(scope === 'project' ? project : home, '.gsd', 'capabilities', 'memanto');
    assert.equal(JSON.parse(fs.readFileSync(path.join(installed, 'capability.json'), 'utf8')).version, next);

    for (const [form, d] of Object.entries(doctorForms(project, home, installed))) {
      const bad = d.rep.checks.filter((c) => c.status === 'error').map((c) => `${c.id}: ${c.message}`);
      assert.equal(d.status, 0, `${form} doctor exit ${d.status}: ${bad.join(' | ')}`);
      for (const id of ['loaded', 'render:discuss:pre', 'gate-bundle']) assert.equal(d.check(id) && d.check(id).status, 'ok', `${form} ${id}: ${JSON.stringify(d.check(id))}`);
      assert.ok(d.check('loaded').message.includes(`memanto ${next} is active in ${scope} scope`), `${form}: ${d.check('loaded').message}`);
    }

    const gate = renderedGate(project, home);
    assert.ok(gate.check.predicate.command.includes(`npm:@taoc/gsd-memanto@${next} --yes`), 'the rendered gate does not pin the bumped version');
    const pass = env.checkPredicate(gate.check.predicate, { cwd: project, home, phaseDir: PHASE_DIR, phaseNumber: '01' });
    assert.equal(pass.status, 0, pass.stderr);
    assert.equal(pass.json.block, false, JSON.stringify(pass.json));

    // An empty agent_id: the gate blocks, and doctor exits 1 in both forms.
    config(project, '');
    const blocked = env.checkPredicate(renderedGate(project, home).check.predicate, { cwd: project, home, phaseDir: PHASE_DIR, phaseNumber: '01' });
    assert.equal(blocked.json.block, true, JSON.stringify(blocked.json));
    assert.match(blocked.json.message, /memanto: BLOCKED \[agent-id\]/, blocked.json.message);
    for (const [form, d] of Object.entries(doctorForms(project, home, installed))) {
      assert.equal(d.status, 1, `${form} doctor exit ${d.status} with an empty agent_id`);
      assert.ok(d.rep.checks.some((c) => c.id === 'agent-id' && c.status === 'error'), `${form}: ${JSON.stringify(d.rep.checks.map((c) => [c.id, c.status]))}`);
    }
    assert.equal(env.realConsentStamp(), consentBefore, 'the user consent store was written');
  });
}

// The rehearsal runs wherever npm test runs; CI runs npm test on both the
// engines.gsd floor and the latest gsd-core release.
test('CI runs the suite, and so the release rehearsal, on both gsd-core versions', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  const m = /gsd: \[([^\]]*)\]/.exec(ci);
  assert.ok(m, 'ci.yml has no gsd matrix');
  const versions = m[1].split(',').map((s) => s.trim().replace(/^"|"$/g, ''));
  const floor = JSON.parse(fs.readFileSync(path.join(ROOT, 'capability.json'), 'utf8')).engines.gsd.match(/>=\s*([0-9.]+)/)[1];
  assert.ok(versions.includes(floor), `the ci.yml gsd matrix ${versions} misses the engines.gsd floor ${floor}`);
  assert.ok(versions.length >= 2, `the ci.yml gsd matrix has one version: ${versions}`);
  assert.match(ci, /GSD_CORE_DIR=/);
  assert.match(ci, /^\s+npm test\s*$/m);
});
