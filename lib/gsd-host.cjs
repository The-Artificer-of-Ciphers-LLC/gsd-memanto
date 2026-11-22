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
// Owner decision 2026-11-20: one bound for every doctor child process (the
// check probe in memanto.cjs and each host query here), so a config file that
// blocks on read (a FIFO) or a hung host cannot hang doctor. memanto.cjs
// re-exports this constant.
const PROBE_TIMEOUT_MS = 15000;

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// timeoutMs is injectable for tests only.
function runTools(tools, args, { cwd, env, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const res = spawnSync(process.execPath, [tools, ...args], {
    cwd: cwd || process.cwd(),
    env: env || process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
  });
  return {
    error: res.error || null,
    status: res.status,
    stdout: res.stdout || '',
    stderr: res.stderr || '',
    timeoutMs,
  };
}

function errorReason(res) {
  if (res.error && res.error.code === 'ETIMEDOUT') return `timed out after ${res.timeoutMs} ms and was stopped`;
  return res.error.message;
}

function parseJson(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// T-01-23: a located binary counts only when it reports gsd-core's package name.
function hostIdentity(tools, { env, timeoutMs } = {}) {
  const res = runTools(tools, ['runtime-identity', '--raw'], { cwd: path.dirname(tools), env, timeoutMs });
  if (res.error) return { ok: false, reason: errorReason(res) };
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

// Runtime config homes, in the order gsd-core's own launcher shim searches them
// (~/.claude first). Each entry is [env override(s)..., default under HOME].
function runtimeHomes(e) {
  const home = os.homedir();
  const xdg = e.XDG_CONFIG_HOME || path.join(home, '.config');
  const pick = (...vals) => vals.find((v) => typeof v === 'string' && v !== '');
  return [
    pick(e.CLAUDE_CONFIG_DIR, path.join(home, '.claude')),
    pick(e.ANTIGRAVITY_CONFIG_DIR, path.join(home, '.gemini', 'antigravity')),
    path.join(home, '.gemini', 'antigravity-ide'),
    path.join(home, '.gemini', 'antigravity-cli'),
    pick(e.AUGMENT_CONFIG_DIR, path.join(home, '.augment')),
    pick(e.CLINE_CONFIG_DIR, path.join(home, '.cline')),
    pick(e.CODEBUDDY_CONFIG_DIR, path.join(home, '.codebuddy')),
    pick(e.CODEX_HOME, path.join(home, '.codex')),
    pick(e.COPILOT_CONFIG_DIR, e.COPILOT_HOME, path.join(home, '.copilot')),
    pick(e.CURSOR_CONFIG_DIR, path.join(home, '.cursor')),
    pick(e.HERMES_HOME, path.join(home, '.hermes')),
    pick(e.KILO_CONFIG_DIR, path.join(xdg, 'kilo')),
    pick(e.KIMI_CONFIG_DIR, path.join(home, '.config', 'agents')),
    path.join(home, '.agents'),
    pick(e.KIMI_CODE_HOME, path.join(home, '.kimi-code')),
    pick(e.OPENCODE_CONFIG_DIR, path.join(xdg, 'opencode')),
    pick(e.PI_CODING_AGENT_DIR, path.join(home, '.pi', 'agent')),
    pick(e.QWEN_CONFIG_DIR, path.join(home, '.qwen')),
    pick(e.TRAE_CONFIG_DIR, path.join(home, '.trae')),
    pick(e.WINDSURF_CONFIG_DIR, path.join(home, '.codeium', 'windsurf')),
    pick(e.ZCODE_CONFIG_DIR, path.join(home, '.zcode')),
    pick(e.GROK_AGENTS_HOME, path.join(home, '.agents')),
  ];
}

// Search order (WR-02): GSD_CORE_DIR, when set, wins outright and is the only
// candidate (an identity failure there is terminal). Otherwise: the running
// gsd-tools (under gsd_run), then the user's runtime config homes. A
// project-local gsd-core (<project>/gsd-core, <project>/.claude/gsd-core) is
// never a candidate: identifying a candidate means executing it, so a cloned
// repo could otherwise plant a gsd-tools.cjs that doctor runs. Owner decision
// 2026-11-20 departs from gsd-core's own resolver, which searches the project
// first; set GSD_CORE_DIR to use a project-local gsd-core on purpose.
function candidates({ env, mainFilename }) {
  const e = env || process.env;
  if (e.GSD_CORE_DIR) return [path.resolve(e.GSD_CORE_DIR, 'bin', 'gsd-tools.cjs')];
  const list = [];
  if (mainFilename && path.basename(mainFilename) === 'gsd-tools.cjs') list.push(mainFilename);
  for (const dir of runtimeHomes(e)) list.push(path.join(dir, TOOLS_REL));
  return [...new Set(list.map((p) => path.resolve(p)))];
}

// projectRoot is accepted for call-site compatibility and deliberately unused.
function locateGsdTools({ env, mainFilename } = {}) {
  const tried = [];
  for (const tools of candidates({ env, mainFilename })) {
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

function capabilityList(tools, { cwd, env, timeoutMs } = {}) {
  const res = runTools(tools, ['capability', 'list', '--raw'], { cwd, env, timeoutMs });
  if (res.error) return { ok: false, rows: [], stderr: res.stderr, reason: errorReason(res) };
  const parsed = parseJson(res.stdout);
  if (!parsed.ok || !Array.isArray(parsed.value)) {
    return { ok: false, rows: [], stderr: res.stderr, reason: `capability list printed no JSON array (exit ${res.status})` };
  }
  return { ok: true, rows: parsed.value, stderr: res.stderr, reason: null };
}

function renderHooksAt(tools, point, { cwd, env, timeoutMs } = {}) {
  const res = runTools(tools, ['loop', 'render-hooks', point, '--raw'], { cwd, env, timeoutMs });
  if (res.error) return { ok: false, hooks: [], warnings: [], stderr: res.stderr, reason: errorReason(res) };
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

module.exports = { locateGsdTools, hostIdentity, capabilityList, renderHooksAt, HOST_PACKAGE, PROBE_TIMEOUT_MS };
