'use strict';
// INST-01 / INST-05 / TEST-01: the release file set installs through gsd-core's
// real third-party installer into a temp GSD_HOME, and gsd-core is never modified.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./helpers/gsd-env.cjs');

let consentBefore;

before(() => {
  consentBefore = env.realConsentStamp();
});

after(() => env.cleanup());

function ledger(home) {
  const file = path.join(home, '.gsd-capabilities.json');
  if (!fs.existsSync(file)) return { entries: {} };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hasLedgerEntry(home) {
  const entries = ledger(home).entries || {};
  return Object.prototype.hasOwnProperty.call(entries, 'memanto');
}

function bundleDir(home) {
  return path.join(home, '.gsd', 'capabilities', 'memanto');
}

function parse(res) {
  try {
    return JSON.parse(res.stdout);
  } catch {
    return {};
  }
}

// A copy of the staged bundle that declares a command module, so the host's
// consent disclosure counts an executable surface (capability-trust
// hasExecutable counts hooks, commands, mcpServers and reviewer lanes only;
// a gate's command-exit-zero predicate is not counted).
function stagedCopyWithCommands() {
  const src = env.stageBundle();
  const dest = path.join(env.tmpDir('memanto-exec-stage-'), 'memanto');
  fs.cpSync(src, dest, { recursive: true });
  const manifestPath = path.join(dest, 'capability.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.commands = [{ family: 'memanto', module: 'memanto.cjs', router: 'route' }];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(
    path.join(dest, 'memanto.cjs'),
    "'use strict';\nfunction route() { process.stdout.write('{}\\n'); }\nmodule.exports = { route };\n",
  );
  return dest;
}

test('fresh install reports installed and places the release file set only', () => {
  const home = env.tmpDir('memanto-home-');
  const res = env.installBundle({ home });
  assert.equal(res.status, 'installed');
  assert.equal(res.id, 'memanto');
  assert.ok(hasLedgerEntry(home), 'ledger has no memanto entry');
  const dir = bundleDir(home);
  for (const rel of ['capability.json', 'scripts/gate.cjs', 'lib/config.cjs', 'lib/checks.cjs', 'package.json']) {
    assert.ok(fs.statSync(path.join(dir, rel)).isFile(), `missing ${rel}`);
  }
  for (const rel of ['test', 'tools', '.planning', '.github']) {
    assert.equal(fs.existsSync(path.join(dir, rel)), false, `unexpected ${rel} in installed bundle`);
  }
});

test('install, render-hooks and check predicate leave gsd-core bin and workflows unchanged', () => {
  const core = env.coreDir();
  const before = {
    bin: env.snapshotTree(path.join(core, 'bin')),
    workflows: env.snapshotTree(path.join(core, 'workflows')),
  };
  const home = env.tmpDir('memanto-home-');
  const project = env.makeProject({
    config: { memanto: { enabled: true, agent_id: '' } },
    phaseDirs: ['01-test'],
  });
  env.installBundle({ home });
  const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home }));
  assert.equal(hooks.length, 1);
  const verdict = env.checkPredicate(hooks[0].check.predicate, {
    cwd: project,
    home,
    phaseDir: '.planning/phases/01-test',
    phaseNumber: '01',
  });
  assert.equal(verdict.json.block, true);
  const afterSnap = {
    bin: env.snapshotTree(path.join(core, 'bin')),
    workflows: env.snapshotTree(path.join(core, 'workflows')),
  };
  assert.deepStrictEqual(afterSnap, before);
});

// A copy of the staged bundle with the command family removed (gate only).
function stagedCopyGateOnly() {
  const src = env.stageBundle();
  const dest = path.join(env.tmpDir('memanto-gateonly-stage-'), 'memanto');
  fs.cpSync(src, dest, { recursive: true });
  const manifestPath = path.join(dest, 'capability.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  delete manifest.commands;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  fs.rmSync(path.join(dest, 'memanto.cjs'), { force: true });
  return dest;
}

test('host behavior: a gate-only manifest installs without --yes (gate predicates are not consent-gated)', () => {
  const home = env.tmpDir('memanto-home-');
  const res = env.gsd(env.installArgs(stagedCopyGateOnly(), null, false), { home });
  assert.equal(parse(res).status, 'installed', `${res.stdout}${res.stderr}`);
});

test('the release bundle declares the memanto command family, so install without --yes reports aborted', () => {
  const home = env.tmpDir('memanto-home-');
  const res = env.gsd(env.installArgs(env.stageBundle(), null, false), { home });
  assert.equal(parse(res).status, 'aborted', `${res.stdout}${res.stderr}`);
  assert.equal(hasLedgerEntry(home), false);
  assert.equal(fs.existsSync(bundleDir(home)), false);
});

test('install without --yes of a bundle with an executable surface reports aborted and leaves nothing behind', () => {
  const home = env.tmpDir('memanto-home-');
  const staged = stagedCopyWithCommands();
  const aborted = env.gsd(env.installArgs(staged, null, false), { home });
  assert.equal(parse(aborted).status, 'aborted', `${aborted.stdout}${aborted.stderr}`);
  assert.notEqual(aborted.status, 0);
  assert.equal(hasLedgerEntry(home), false, 'aborted install left a memanto ledger entry');
  assert.equal(fs.existsSync(bundleDir(home)), false, 'aborted install left a bundle directory');

  const installed = env.gsd(env.installArgs(staged, null, true), { home });
  assert.equal(parse(installed).status, 'installed', `${installed.stdout}${installed.stderr}`);
  assert.equal(installed.status, 0);
  assert.ok(hasLedgerEntry(home));
});

test('re-install reports installed and remove leaves no bundle and no ledger entry', () => {
  const home = env.tmpDir('memanto-home-');
  env.installBundle({ home });
  const again = env.installBundle({ home });
  assert.equal(again.status, 'installed');
  const removed = env.gsd(['capability', 'remove', 'memanto'], { home });
  assert.equal(removed.status, 0, removed.stderr);
  assert.equal(parse(removed).status, 'removed');
  assert.equal(fs.existsSync(bundleDir(home)), false);
  assert.equal(hasLedgerEntry(home), false);
});

test('the real ~/.gsd/consent.json is untouched by the install suite', () => {
  assert.equal(env.realConsentStamp(), consentBefore);
});
