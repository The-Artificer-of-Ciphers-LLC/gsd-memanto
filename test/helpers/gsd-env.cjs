'use strict';
// Hermetic real-host harness. Every gsd-tools spawn gets a temp GSD_HOME and
// blank GSD_WORKSTREAM / GSD_PROJECT; HOME is never changed (some host code
// uses os.homedir()). The owner's real ~/.gsd is only ever stat()ed.

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const STAGE_SCRIPT = path.join(REPO_ROOT, 'tools', 'stage-bundle.cjs');

const tmpDirs = [];
let stagedMemo = null;

function coreDir() {
  return process.env.GSD_CORE_DIR || path.join(os.homedir(), '.claude', 'gsd-core');
}

function toolsPath() {
  return path.join(coreDir(), 'bin', 'gsd-tools.cjs');
}

function tmpDir(prefix = 'memanto-test-') {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(dir);
  return dir;
}

function cleanup() {
  while (tmpDirs.length > 0) {
    fs.rmSync(tmpDirs.pop(), { recursive: true, force: true });
  }
  stagedMemo = null;
}

function hostEnv(home, extra) {
  if (!home) throw new Error('gsd-env: a temp GSD_HOME is required for every gsd-tools spawn');
  return { ...process.env, GSD_HOME: home, GSD_WORKSTREAM: '', GSD_PROJECT: '', ...(extra || {}) };
}

function gsd(args, { cwd, home, env } = {}) {
  const res = spawnSync(process.execPath, [toolsPath(), ...args], {
    cwd: cwd || home,
    encoding: 'utf8',
    env: hostEnv(home, env),
  });
  if (res.error) throw res.error;
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

function parseStdout(res, what) {
  try {
    return JSON.parse(res.stdout);
  } catch (e) {
    throw new Error(`${what}: stdout is not JSON (exit ${res.status}): ${res.stdout}\nstderr: ${res.stderr}`);
  }
}

function writeConfig(project, config) {
  const file = path.join(project, '.planning', 'config.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof config === 'string' ? config : JSON.stringify(config, null, 2) + '\n');
  return file;
}

function makeProject({ config, phaseDirs = [] } = {}) {
  const project = tmpDir('memanto-proj-');
  fs.mkdirSync(path.join(project, '.planning'), { recursive: true });
  if (config !== undefined) writeConfig(project, config);
  for (const d of phaseDirs) fs.mkdirSync(path.join(project, '.planning', 'phases', d), { recursive: true });
  return project;
}

function stageBundle() {
  if (stagedMemo && fs.existsSync(stagedMemo)) return stagedMemo;
  const res = spawnSync(process.execPath, [STAGE_SCRIPT, '--stage-only', '--json'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`stage-bundle exited ${res.status}: ${res.stderr}`);
  const { stagedDir } = JSON.parse(res.stdout);
  tmpDirs.push(path.dirname(stagedDir));
  stagedMemo = stagedDir;
  return stagedDir;
}

function installArgs(stagedDir, scope, yes) {
  const args = ['capability', 'install', stagedDir];
  if (yes) args.push('--yes');
  if (scope) args.push('--scope', scope);
  return args;
}

function installBundle({ home, stagedDir, scope, project, yes = true } = {}) {
  const dir = stagedDir || stageBundle();
  const res = gsd(installArgs(dir, scope, yes), { cwd: project || home, home });
  let json = {};
  try {
    json = JSON.parse(res.stdout);
  } catch {
    // A refused install prints its reason on stderr only; the assertion below reports it.
  }
  assert.equal(json.status, 'installed', `capability install did not report installed (exit ${res.status}): ${res.stdout}${res.stderr}`);
  return json;
}

function renderHooks(point, { cwd, home, env } = {}) {
  const res = gsd(['loop', 'render-hooks', point, '--raw'], { cwd, home, env });
  const json = parseStdout(res, `loop render-hooks ${point}`);
  Object.defineProperty(json, '_stderr', { value: res.stderr, enumerable: false });
  return json;
}

function memantoHooks(renderResult) {
  const hooks = (renderResult && renderResult.activeHooks) || [];
  return hooks.filter((h) => h && h.capId === 'memanto');
}

function checkPredicate(predicate, { cwd, home, env, phaseDir, phaseNumber } = {}) {
  const args = ['check', 'predicate', '--predicate', JSON.stringify(predicate)];
  if (phaseDir !== undefined) args.push('--phase-dir', phaseDir);
  if (phaseNumber !== undefined) args.push('--phase-number', String(phaseNumber));
  args.push('--raw');
  const res = gsd(args, { cwd, home, env });
  return { status: res.status, stderr: res.stderr, json: parseStdout(res, 'check predicate') };
}

function loadRegistry({ home, cwd } = {}) {
  const loader = require(path.join(coreDir(), 'bin', 'lib', 'capability-loader.cjs'));
  return loader.loadRegistry({ includeInstalled: true, cwd, gsdHome: home });
}

function snapshotTree(dir) {
  const out = {};
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs).sort()) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      if (st.isDirectory()) {
        walk(a, r);
      } else if (st.isSymbolicLink()) {
        out[r] = { size: st.size, mtimeMs: st.mtimeMs, sha256: `link:${fs.readlinkSync(a)}` };
      } else {
        const sha256 = crypto.createHash('sha256').update(fs.readFileSync(a)).digest('hex');
        out[r] = { size: st.size, mtimeMs: st.mtimeMs, sha256 };
      }
    }
  };
  walk(dir, '');
  return out;
}

function realConsentStamp() {
  try {
    return fs.statSync(path.join(os.homedir(), '.gsd', 'consent.json')).mtimeMs;
  } catch {
    return null;
  }
}

module.exports = {
  REPO_ROOT,
  coreDir,
  gsd,
  tmpDir,
  cleanup,
  makeProject,
  writeConfig,
  stageBundle,
  installArgs,
  installBundle,
  renderHooks,
  memantoHooks,
  checkPredicate,
  loadRegistry,
  snapshotTree,
  realConsentStamp,
};
