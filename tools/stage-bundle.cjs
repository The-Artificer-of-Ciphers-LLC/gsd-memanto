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

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const REPO_ROOT = path.resolve(__dirname, '..');

function fail(msg) {
  process.stderr.write(`stage-bundle: ${msg}\n`);
  process.exit(1);
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

function packFileList() {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: REPO_ROOT,
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

function stage() {
  const files = packFileList();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-stage-'));
  const stagedDir = path.join(root, 'memanto');
  fs.mkdirSync(stagedDir);
  for (const rel of files) {
    const src = path.resolve(REPO_ROOT, rel);
    if (src !== REPO_ROOT && !src.startsWith(REPO_ROOT + path.sep)) {
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
}

function gsdToolsPath() {
  const core = process.env.GSD_CORE_DIR || path.join(os.homedir(), '.claude', 'gsd-core');
  return path.join(core, 'bin', 'gsd-tools.cjs');
}

function install(stagedDir, opts) {
  const env = { ...process.env, GSD_WORKSTREAM: '', GSD_PROJECT: '' };
  let home = null;
  if (opts.real) {
    delete env.GSD_HOME;
  } else {
    home = opts.home || fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-home-'));
    fs.mkdirSync(home, { recursive: true });
    env.GSD_HOME = home;
  }
  const args = [gsdToolsPath(), 'capability', 'install', stagedDir, '--yes'];
  if (opts.scope) args.push('--scope', opts.scope);
  const res = spawnSync(process.execPath, args, {
    cwd: opts.project || path.dirname(stagedDir),
    encoding: 'utf8',
    env,
  });
  if (res.error) fail(`gsd-tools failed to start: ${res.error.message}`);
  let result;
  try {
    result = JSON.parse(res.stdout);
  } catch {
    fail(`capability install printed non-JSON stdout (exit ${res.status}): ${res.stdout}${res.stderr}`);
  }
  return { home: opts.real ? null : home, install: result, status: res.status, stderr: res.stderr };
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const stagedDir = stage();
  if (opts.stageOnly) {
    process.stdout.write(opts.json ? JSON.stringify({ stagedDir }) + '\n' : stagedDir + '\n');
    return;
  }
  const out = install(stagedDir, opts);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ stagedDir, home: out.home, install: out.install }) + '\n');
  } else {
    process.stdout.write(`staged:  ${stagedDir}\n`);
    process.stdout.write(`home:    ${out.home || '(real home)'}\n`);
    process.stdout.write(`status:  ${out.install && out.install.status}\n`);
  }
  if (!out.install || out.install.status !== 'installed') {
    process.stderr.write(out.stderr || '');
    fail(`install did not report status installed (got ${out.install && out.install.status})`);
  }
}

main();
