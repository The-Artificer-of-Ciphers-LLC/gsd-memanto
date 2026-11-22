#!/usr/bin/env node
'use strict';
// Dev-only (not shipped). Stages exactly the `npm pack` file set into a temp
// directory and installs it through gsd-core's real third-party installer.
//
//   node tools/stage-bundle.cjs [--stage-only] [--json]
//                               [--home <dir> | --real]
//                               [--scope project --project <dir>]
//
// Default target is a FRESH temp GSD_HOME. The owner's real home is touched
// only with an explicit --real (which refuses --home).
//
// Temp directories (IN-08): after an install the staging copy is deleted, since
// the scope directory now holds the installed bundle. What is left for the
// caller to delete is listed in `cleanup` (--json) or on a "cleanup:" line:
// the staged root for --stage-only, and the fresh temp GSD_HOME when no
// --home or --real was given. --home and --real directories are never listed. On a failure (IN-02, round
// 2) the script removes the staging root and a fresh temp GSD_HOME it created
// before it exits, so a failed run leaves no memanto-* directory behind.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

// Thrown for every refusal or failure; main() prints it and exits 1. A throw
// (not process.exit) lets each step remove its own temp directories first.
class StageError extends Error {}

function fail(msg) {
  throw new StageError(msg);
}

function parseArgs(argv) {
  const opts = { stageOnly: false, json: false, home: null, real: false, scope: null, project: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) fail(`missing value for ${a}`);
      i++;
      return v;
    };
    if (a === '--stage-only') opts.stageOnly = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--real') opts.real = true;
    else if (a === '--home') opts.home = path.resolve(value());
    else if (a === '--scope') opts.scope = value();
    else if (a === '--project') opts.project = path.resolve(value());
    else fail(`unknown argument ${a}`);
  }
  if (opts.real && opts.home) fail('--real and --home are mutually exclusive');
  if (opts.scope !== null && opts.scope !== 'project' && opts.scope !== 'global') {
    fail(`--scope must be project or global, got ${opts.scope}`);
  }
  if (opts.scope === 'project' && !opts.project) fail('--scope project requires --project <dir>');
  if (opts.project && opts.scope !== 'project') fail('--project requires --scope project');
  return opts;
}

function packFileList(repoRoot = REPO_ROOT) {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'silent' },
  });
  if (res.error) fail(`npm pack failed to start: ${res.error.message}`);
  if (res.status !== 0) fail(`npm pack --dry-run exited ${res.status}: ${res.stderr}`);
  let parsed;
  try {
    parsed = JSON.parse(res.stdout);
  } catch (e) {
    fail(`npm pack --dry-run --json printed non-JSON output: ${e.message}`);
  }
  const first = Array.isArray(parsed) ? parsed[0] : null;
  if (!first || !Array.isArray(first.files)) fail('npm pack --dry-run --json output has no files[]');
  return first.files.map((f) => f.path);
}

// repoRoot, files and tmpRoot are injectable for tests only.
function stage({ repoRoot = REPO_ROOT, files = null, tmpRoot = os.tmpdir() } = {}) {
  const list = files || packFileList(repoRoot);
  const root = fs.mkdtempSync(path.join(tmpRoot, 'memanto-stage-'));
  try {
    const stagedDir = path.join(root, 'memanto');
    fs.mkdirSync(stagedDir);
    for (const rel of list) {
      const src = path.resolve(repoRoot, rel);
      if (src !== repoRoot && !src.startsWith(repoRoot + path.sep)) {
        fail(`refusing to stage path outside the repo: ${rel}`);
      }
      const st = fs.lstatSync(src);
      if (st.isSymbolicLink()) fail(`refusing to stage symlink: ${rel}`);
      if (!st.isFile()) fail(`refusing to stage non-regular file: ${rel}`);
      const dest = path.join(stagedDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
    }
    return stagedDir;
  } catch (e) {
    fs.rmSync(root, { recursive: true, force: true });
    throw e;
  }
}

function gsdToolsPath() {
  const core = process.env.GSD_CORE_DIR || path.join(os.homedir(), '.claude', 'gsd-core');
  return path.join(core, 'bin', 'gsd-tools.cjs');
}

function install(stagedDir, opts) {
  const env = { ...process.env, GSD_WORKSTREAM: '', GSD_PROJECT: '' };
  let home = null;
  let freshHome = false;
  if (opts.real) {
    delete env.GSD_HOME;
  } else {
    freshHome = !opts.home;
    home = opts.home || fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-home-'));
    fs.mkdirSync(home, { recursive: true });
    env.GSD_HOME = home;
  }
  const args = [gsdToolsPath(), 'capability', 'install', stagedDir, '--yes'];
  if (opts.scope) args.push('--scope', opts.scope);
  let res;
  try {
    res = spawnSync(process.execPath, args, {
      cwd: opts.project || path.dirname(stagedDir),
      encoding: 'utf8',
      env,
    });
  } finally {
    // The staging copy is no longer needed once the installer has run (it copies
    // the bundle into the scope directory), whatever the outcome.
    fs.rmSync(path.dirname(stagedDir), { recursive: true, force: true });
  }
  // IN-02: a fresh temp home that holds no result is removed before failing.
  const dropFreshHome = () => {
    if (freshHome) fs.rmSync(home, { recursive: true, force: true });
  };
  if (res.error) {
    dropFreshHome();
    fail(`gsd-tools failed to start: ${res.error.message}`);
  }
  let result;
  try {
    result = JSON.parse(res.stdout);
  } catch {
    dropFreshHome();
    fail(`capability install printed non-JSON stdout (exit ${res.status}): ${res.stdout}${res.stderr}`);
  }
  return { home: opts.real ? null : home, freshHome, install: result, status: res.status, stderr: res.stderr };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stagedDir = stage();
  if (opts.stageOnly) {
    const cleanup = [path.dirname(stagedDir)];
    if (opts.json) process.stdout.write(JSON.stringify({ stagedDir, cleanup }) + '\n');
    else process.stdout.write(`${stagedDir}\ncleanup: rm -rf ${cleanup[0]}\n`);
    return;
  }
  const out = install(stagedDir, opts);
  const cleanup = out.freshHome ? [out.home] : [];
  if (opts.json) {
    process.stdout.write(JSON.stringify({ stagedDir, home: out.home, install: out.install, cleanup }) + '\n');
  } else {
    process.stdout.write(`staged:  ${stagedDir} (deleted after install)\n`);
    process.stdout.write(`home:    ${out.home || '(real home)'}\n`);
    process.stdout.write(`status:  ${out.install && out.install.status}\n`);
    for (const dir of cleanup) process.stdout.write(`cleanup: rm -rf ${dir}\n`);
  }
  if (!out.install || out.install.status !== 'installed') {
    process.stderr.write(out.stderr || '');
    fail(`install did not report status installed (got ${out.install && out.install.status})`);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    if (!(e instanceof StageError)) throw e;
    process.stderr.write(`stage-bundle: ${e.message}\n`);
    process.exit(1);
  }
}

// stage, install and StageError are exported for tests only.
module.exports = { stage, install, StageError };
