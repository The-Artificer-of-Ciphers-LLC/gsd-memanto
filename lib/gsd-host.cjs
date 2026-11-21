'use strict';
// Read-only queries against the gsd-core host CLI for `memanto doctor`
// (D-17, D-20). Every spawn is a query (runtime-identity, capability list,
// loop render-hooks); nothing here writes, consents or installs.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const HOST_PACKAGE = '@opengsd/gsd-core';
const TOOLS_REL = path.join('gsd-core', 'bin', 'gsd-tools.cjs');

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function runTools(tools, args, { cwd, env } = {}) {
  const res = spawnSync(process.execPath, [tools, ...args], {
    cwd: cwd || process.cwd(),
    env: env || process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    error: res.error || null,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
  };
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// T-01-23: a located binary counts only when it reports gsd-core's package name.
function hostIdentity(tools, { env } = {}) {
  const res = runTools(tools, ['runtime-identity', '--raw'], { cwd: path.dirname(tools), env });
  if (res.error) return { ok: false, reason: res.error.message };
  const parsed = parseJson(res.stdout);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
    return { ok: false, reason: `runtime-identity printed no JSON (exit ${res.status})` };
  }
  const { packageName, version } = parsed.value;
  if (packageName !== HOST_PACKAGE) {
    return { ok: false, reason: `runtime-identity reports ${JSON.stringify(packageName)}, not ${HOST_PACKAGE}` };
  }
  return { ok: true, packageName, version: typeof version === 'string' ? version : null };
}

// Fixed search order: GSD_CORE_DIR (wins outright), the running gsd-tools
// (under gsd_run), the user config homes (~/.claude first, then opencode),
// and only then the project-local <project>/gsd-core and
// <project>/.claude/gsd-core. Owner decision 2026-11-20: this deliberately
// departs from RESEARCH Pattern 5 and gsd-core's own resolver, which search
// the project first, so a cloned repo cannot plant a gsd-tools.cjs that
// doctor runs ahead of the user's own install.
function candidates({ env, mainFilename, projectRoot }) {
  const e = env || process.env;
  const list = [];
  if (e.GSD_CORE_DIR) list.push(path.join(e.GSD_CORE_DIR, 'bin', 'gsd-tools.cjs'));
  if (mainFilename && path.basename(mainFilename) === 'gsd-tools.cjs') list.push(mainFilename);
  list.push(path.join(e.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), TOOLS_REL));
  list.push(path.join(e.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode'), TOOLS_REL));
  if (projectRoot) {
    list.push(path.join(projectRoot, TOOLS_REL));
    list.push(path.join(projectRoot, '.claude', TOOLS_REL));
  }
  return [...new Set(list.map((p) => path.resolve(p)))];
}

function locateGsdTools({ env, mainFilename, projectRoot } = {}) {
  const tried = [];
  for (const tools of candidates({ env, mainFilename, projectRoot })) {
    if (!isFile(tools)) {
      tried.push({ path: tools, reason: 'not found' });
      continue;
    }
    const identity = hostIdentity(tools, { env });
    if (identity.ok) return { ok: true, tools, version: identity.version, tried };
    tried.push({ path: tools, reason: identity.reason });
  }
  return { ok: false, tools: null, version: null, tried };
}

function capabilityList(tools, { cwd, env } = {}) {
  const res = runTools(tools, ['capability', 'list', '--raw'], { cwd, env });
  if (res.error) return { ok: false, rows: [], stderr: res.stderr, reason: res.error.message };
  const parsed = parseJson(res.stdout);
  if (!parsed.ok || !Array.isArray(parsed.value)) {
    return { ok: false, rows: [], stderr: res.stderr, reason: `capability list printed no JSON array (exit ${res.status})` };
  }
  return { ok: true, rows: parsed.value, stderr: res.stderr, reason: null };
}

function renderHooksAt(tools, point, { cwd, env } = {}) {
  const res = runTools(tools, ['loop', 'render-hooks', point, '--raw'], { cwd, env });
  if (res.error) return { ok: false, hooks: [], warnings: [], stderr: res.stderr, reason: res.error.message };
  const parsed = parseJson(res.stdout);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') {
    return { ok: false, hooks: [], warnings: [], stderr: res.stderr, reason: `render-hooks printed no JSON (exit ${res.status})` };
  }
  const v = parsed.value;
  return {
    ok: true,
    hooks: Array.isArray(v.activeHooks) ? v.activeHooks : [],
    warnings: Array.isArray(v.warnings) ? v.warnings.map(String) : [],
    stderr: res.stderr,
    reason: null,
  };
}

module.exports = { locateGsdTools, hostIdentity, capabilityList, renderHooksAt, HOST_PACKAGE };
