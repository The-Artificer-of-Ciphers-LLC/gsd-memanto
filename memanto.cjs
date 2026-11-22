'use strict';
// `memanto` command family (D-17). route(ctx) is synchronous: gsd-core rejects
// a router that returns a Promise. ctx = { args, cwd, raw, error }, args[0] is
// the family name. Also runnable directly as `node memanto.cjs doctor [--raw]`
// for the states in which gsd-core does not route the family (not consented,
// outside engines.gsd, failed validation, not in a ledger).

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveConfig } = require('./lib/config.cjs');
const { cap, CONTROL_CHARS } = require('./lib/health.cjs');
const host = require('./lib/gsd-host.cjs');
const gateBundle = require('./lib/gate-bundle.cjs');

const USAGE = 'Usage: gsd_run memanto doctor [--raw]';
const DIRECT_FORM = 'node "${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/memanto.cjs" doctor';
const PROBE = path.join(__dirname, 'scripts', 'check-probe.cjs');
const OWN_MANIFEST = path.join(__dirname, 'capability.json');
const INTERNAL_FIX = 'report this failure; memanto.enabled=false disables Memanto for this project';
const REASON_MAX = 300;
// Shared with every host query in lib/gsd-host.cjs (WR-01).
const { PROBE_TIMEOUT_MS } = host;

function record(id, status, message, fix) {
  return { id, status, message, fix: fix || '' };
}

function clean(value, max) {
  return cap(String(value).replace(CONTROL_CHARS, '?'), max);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function ownVersion() {
  const m = readJson(OWN_MANIFEST);
  return m && typeof m.version === 'string' ? m.version : '<version>';
}

// Fix hints for not-loaded states never use `gsd_run config-set`, which fails
// with "Unknown config key" while the capability is not loaded (Pattern 4.7).
function reinstallFix() {
  return (
    `reinstall: gsd-tools capability install npm:@taoc/gsd-memanto@${ownVersion()} --yes ` +
    '(add --scope project inside a project for project scope; in a dev checkout: node tools/stage-bundle.cjs)'
  );
}

// The gate's own checks, from the same check library, in a child process
// (the router cannot await the health probes). The health probes inside it run
// in parallel within the gate's 5 s budget (lib/health.cjs). PROBE_TIMEOUT_MS
// (owner decision, 2026-11-20) bounds everything else, such as a config file
// that blocks on read (a FIFO), so doctor reports a check-probe error instead
// of hanging. probe and timeoutMs are injectable for tests only.
function gateChecks(cwd, { probe = PROBE, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const res = spawnSync(process.execPath, [probe], { cwd, env: process.env, encoding: 'utf8', timeout: timeoutMs });
  if (res.error && res.error.code === 'ETIMEDOUT') {
    return [
      record(
        'check-probe',
        'error',
        `check probe timed out after ${timeoutMs} ms and was stopped (${res.signal || 'killed'}); a config file that blocks on read, such as a FIFO, or a stalled endpoint can cause this`,
        'make sure .planning/config.json and the memanto config files are regular readable files, then rerun doctor; memanto.enabled=false disables Memanto for this project',
      ),
    ];
  }
  if (res.error) {
    return [record('check-probe', 'error', `check probe did not run: ${clean(res.error.message, REASON_MAX)}`, INTERNAL_FIX)];
  }
  try {
    const parsed = JSON.parse(res.stdout);
    if (!parsed || !Array.isArray(parsed.checks)) throw new Error('no checks array');
    return parsed.checks.map((c) => record(String(c.id), c.status, String(c.message), c.fix));
  } catch (e) {
    const why = `exit ${res.status === null ? res.signal : res.status}: ${clean(res.stderr || e.message, REASON_MAX)}`;
    return [record('check-probe', 'error', `check probe output was not readable (${why})`, INTERNAL_FIX)];
  }
}

function enabledCheck(cfg) {
  if (!cfg.ok && cfg.kind === 'env') {
    return {
      enabled: true, // fail closed: run every check
      rec: record(
        'enabled',
        'warn',
        clean(`memanto.enabled could not be read: ${cfg.variable} is invalid (see config-unreadable)`, REASON_MAX),
        clean(`unset ${cfg.variable} or set it to a name without '/', '\\' or '..'`, REASON_MAX),
      ),
    };
  }
  if (!cfg.ok) {
    return {
      enabled: true, // fail closed: run every check
      rec: record('enabled', 'warn', 'memanto.enabled could not be read (see config-unreadable)', 'fix the config file named by config-unreadable'),
    };
  }
  if (cfg.get('memanto.enabled') === true) {
    return { enabled: true, rec: record('enabled', 'ok', 'memanto.enabled is true', '') };
  }
  return {
    enabled: false,
    rec: record(
      'enabled',
      'warn',
      'Memanto is disabled for this project; no Memanto hook runs',
      'set "memanto": {"enabled": true} in .planning/config.json to enable Memanto',
    ),
  };
}

function locatedCheck(located) {
  if (located.ok) {
    return record('gsd-core-located', 'ok', clean(`gsd-core ${located.version || '(unknown version)'} at ${located.tools}`, REASON_MAX), '');
  }
  const tried = located.tried.map((t) => t.path).join(', ');
  return record(
    'gsd-core-located',
    'error',
    clean(`no gsd-core gsd-tools.cjs was found (tried: ${tried})`, REASON_MAX),
    'set GSD_CORE_DIR to the gsd-core directory that holds bin/gsd-tools.cjs',
  );
}

function describeRow(r) {
  return `${r.status} in ${r.scope} scope${r.reason ? ` (${r.reason})` : ''}`;
}

function loadedCheck(rows) {
  const active = rows.find((r) => r.status === 'active');
  if (active) return record('loaded', 'ok', `memanto ${active.version || ''} is active in ${active.scope} scope`.replace('  ', ' '), '');
  const message = rows.length
    ? `memanto.enabled is true but memanto is ${rows.map(describeRow).join('; ')}; its gate does not run (fails open)`
    : 'memanto.enabled is true but capability list has no memanto row (not installed or not in a ledger); its gate does not run (fails open)';
  return record('loaded', 'error', clean(message, REASON_MAX), reinstallFix());
}

// OD-3: "not consented" is (a) a project-scope row inactive for lack of a
// user consent record, or (b) a bundle on disk that no ledger lists.
function consentCheck(rows, scopeDirs) {
  const unconsented = rows.find((r) => r.status === 'inactive' && /consent/i.test(String(r.reason || '')));
  if (unconsented) {
    return record(
      'consent',
      'error',
      clean(`memanto in ${unconsented.scope} scope has no user consent record: ${unconsented.reason}`, REASON_MAX),
      `re-consent by reinstalling in the project: gsd-tools capability install npm:@taoc/gsd-memanto@${ownVersion()} --scope project --yes`,
    );
  }
  for (const [scope, dir] of Object.entries(scopeDirs)) {
    if (!dir || !isFile(path.join(dir, 'capability.json'))) continue;
    if (rows.some((r) => r.scope === scope)) continue;
    return record(
      'consent',
      'error',
      clean(`the memanto bundle at ${dir} is not in the ${scope} capability ledger (copied by hand?); gsd-core does not route gsd_run memanto for it`, REASON_MAX),
      `remove the copied directory and ${reinstallFix()}`,
    );
  }
  return record('consent', 'ok', 'every memanto bundle on disk is in a capability ledger and consented (global scope needs no consent record)', '');
}

function enginesCheck(rows, scopeDirs, hostVersion) {
  const bad = rows.find((r) => r.status === 'incompatible');
  if (!bad) return record('engines', 'ok', `memanto engines.gsd accepts GSD ${hostVersion || '(unknown version)'}`, '');
  // IN-04: an unknown scope has no directory to read; never fall back to a
  // relative capability.json in the cwd.
  const dir = Object.prototype.hasOwnProperty.call(scopeDirs, bad.scope) ? scopeDirs[bad.scope] : null;
  const manifest = (dir && readJson(path.join(dir, 'capability.json'))) || {};
  const declared = manifest.engines && manifest.engines.gsd;
  const range = typeof declared === 'string' ? JSON.stringify(declared) : '(unknown range)';
  return record(
    'engines',
    'error',
    clean(`memanto in ${bad.scope} scope requires engines.gsd ${range} but the host is GSD ${hostVersion || '(unknown version)'}; its gate does not run (fails open)`, REASON_MAX),
    `install a memanto release whose engines.gsd includes GSD ${hostVersion || 'this host'} ` +
      `(gsd-tools capability install npm:@taoc/gsd-memanto@<version> --yes), or use a gsd-core inside ${range}`,
  );
}

// Points declared by the installed manifest (or this bundle's own when none is installed).
function declaredPoints(rows, scopeDirs) {
  const active = rows.find((r) => r.status === 'active');
  const order = [active && scopeDirs[active.scope], scopeDirs.global, scopeDirs.project].filter(Boolean);
  let manifest = null;
  for (const dir of order) {
    manifest = readJson(path.join(dir, 'capability.json'));
    if (manifest) break;
  }
  if (!manifest) manifest = readJson(OWN_MANIFEST) || {};
  const points = [];
  for (const kind of ['gates', 'steps', 'contributions']) {
    for (const h of Array.isArray(manifest[kind]) ? manifest[kind] : []) {
      if (h && typeof h.point === 'string' && !points.includes(h.point)) points.push(h.point);
    }
  }
  return points;
}

function loadFailureReason(rh) {
  const lines = [...rh.warnings, ...String(rh.stderr || '').split('\n')];
  const line = lines.find((l) => l.includes('capability "memanto" failed to load'));
  if (!line) return null;
  const m = /failed to load \((.*)\); its /.exec(line);
  return m ? m[1] : line;
}

function renderCheck(tools, point, opts) {
  const id = `render:${point}`;
  const rh = host.renderHooksAt(tools, point, opts);
  if (!rh.ok) {
    return record(id, 'error', clean(`loop render-hooks ${point} failed: ${rh.reason}`, REASON_MAX), 'run gsd_run loop render-hooks to see the host error');
  }
  if (rh.hooks.some((h) => h && h.capId === 'memanto')) return record(id, 'ok', `memanto renders at ${point}`, '');
  const reason = loadFailureReason(rh);
  const why = reason ? ` (host: ${clean(reason, REASON_MAX)})` : '';
  return record(id, 'error', `no memanto hook renders at ${point}; it is not enforced (fails open)${why}`, `fix the reported load error or ${reinstallFix()}`);
}

function duplicateCheck(scopeDirs) {
  const present = Object.entries(scopeDirs).filter(([, dir]) => dir && isFile(path.join(dir, 'capability.json')));
  const distinct = new Set(present.map(([, dir]) => path.resolve(dir)));
  if (present.length < 2 || distinct.size < 2) {
    return record('duplicate-install', 'ok', 'memanto is installed in at most one scope', '');
  }
  return record(
    'duplicate-install',
    'warn',
    clean(`memanto is installed in both global (${scopeDirs.global}) and project (${scopeDirs.project}) scope; gsd-core keeps the global one and skips the project one`, REASON_MAX),
    'remove one copy: gsd-tools capability remove memanto --scope project (or --scope global)',
  );
}

// CR-01: the discuss:pre predicate runs scripts/gate.cjs only from an installed
// bundle (lib/gate-bundle.cjs). Error when that differs from the bundle
// gsd-core loaded, when no installed bundle exists while one is loaded, or when
// a scope directory holds gate code that is not an installed bundle (stray or
// planted). rows is null when capability list could not be read.
function gateBundleCheck(rows, scopeDirs, roots) {
  const active = rows ? rows.find((r) => r.status === 'active') : null;
  const loaded = active ? scopeDirs[active.scope] : null;
  const resolved = gateBundle.resolveGateBundle(roots);
  if (loaded && resolved && path.resolve(resolved) !== path.resolve(loaded)) {
    return record(
      'gate-bundle',
      'error',
      clean(`the discuss:pre gate would run ${resolved}/scripts/gate.cjs, but gsd-core loaded the bundle at ${loaded}`, REASON_MAX),
      `remove one copy so a single installed bundle remains: gsd-tools capability remove memanto --scope ${active.scope === 'global' ? 'project' : 'global'}`,
    );
  }
  if (loaded && !resolved) {
    return record(
      'gate-bundle',
      'error',
      clean(`gsd-core loaded memanto from ${loaded}, but the discuss:pre gate finds no installed bundle (capability.json plus a committed ledger entry) and blocks every run`, REASON_MAX),
      reinstallFix(),
    );
  }
  for (const [scope, dir] of Object.entries(scopeDirs)) {
    if (!dir || !isFile(path.join(dir, 'scripts', 'gate.cjs'))) continue;
    if (gateBundle.isInstalledBundle(roots[scope === 'global' ? 'gsdHome' : 'projectRoot'])) continue;
    return record(
      'gate-bundle',
      'error',
      clean(`${dir} holds scripts/gate.cjs but is not an installed memanto bundle (no capability.json with id memanto or no committed ${scope} ledger entry); stray or planted gate code`, REASON_MAX),
      `delete ${dir} (the gate never runs it), then ${reinstallFix()}`,
    );
  }
  return record('gate-bundle', 'ok', 'the discuss:pre gate runs the installed bundle gsd-core loads', '');
}

// F11 / Pitfall 2: these discuss paths never render discuss:pre.
function discussBypassCheck(cfg) {
  const mode = cfg.ok ? cfg.get('workflow.discuss_mode') : undefined;
  if (mode === 'assumptions') {
    return record(
      'discuss-bypass',
      'warn',
      'workflow.discuss_mode is "assumptions", so /gsd-discuss-phase skips the discuss:pre Memanto gate',
      'set "workflow": {"discuss_mode": "discuss"} in .planning/config.json to keep the gate',
    );
  }
  return record(
    'discuss-bypass',
    'warn',
    '/gsd-discuss-phase --power and --assumptions skip the discuss:pre Memanto gate',
    'run /gsd-discuss-phase without --power or --assumptions when the gate must run',
  );
}

// D-20: read-only. Reads config, the ledger (through capability list), the
// installed manifests and versions, and makes GET /health calls. It never
// writes, consents, installs or activates a Memanto session.
function collectChecks(cwd) {
  const env = process.env;
  const gsdHome = env.GSD_HOME || os.homedir();
  const scopeDirs = {
    global: path.join(gsdHome, '.gsd', 'capabilities', 'memanto'),
    project: path.join(cwd, '.gsd', 'capabilities', 'memanto'),
  };
  const roots = { gsdHome, projectRoot: cwd };
  const cfg = resolveConfig({ cwd, env });
  const checks = [];
  let rows = null;

  const located = host.locateGsdTools({
    env,
    mainFilename: require.main && require.main.filename,
    projectRoot: cwd,
  });
  checks.push(locatedCheck(located));
  const { enabled, rec } = enabledCheck(cfg);
  checks.push(rec);

  if (located.ok) {
    const opts = { cwd, env };
    const list = host.capabilityList(located.tools, opts);
    if (!list.ok) {
      checks.push(record('capability-list', 'error', clean(`capability list failed: ${list.reason}`, REASON_MAX), 'run gsd-tools capability list to see the host error'));
    } else {
      rows = list.rows.filter((r) => r && r.id === 'memanto');
      if (enabled) checks.push(loadedCheck(rows));
      checks.push(consentCheck(rows, scopeDirs));
      checks.push(enginesCheck(rows, scopeDirs, located.version));
      if (enabled) {
        for (const point of declaredPoints(rows, scopeDirs)) checks.push(renderCheck(located.tools, point, opts));
      }
    }
  }
  checks.push(duplicateCheck(scopeDirs));
  checks.push(gateBundleCheck(rows, scopeDirs, roots));
  checks.push(discussBypassCheck(cfg));
  if (enabled) checks.push(...gateChecks(cwd));
  return checks;
}

function renderText(checks) {
  const lines = [];
  for (const c of checks) {
    lines.push(`${c.status.padEnd(5)} ${c.id}  ${c.message}`);
    if (c.status !== 'ok' && c.fix) lines.push(`      fix: ${c.fix}`);
  }
  const errors = checks.filter((c) => c.status === 'error').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  lines.push(`memanto doctor: ${errors} error(s), ${warnings} warning(s)`);
  lines.push(`direct form (when gsd_run memanto is unavailable): ${DIRECT_FORM}`);
  return lines.join('\n') + '\n';
}

function runDoctor(ctx) {
  const cwd = ctx.cwd || process.cwd();
  let checks;
  try {
    checks = collectChecks(cwd);
  } catch (e) {
    checks = [record('doctor-internal', 'error', clean(e && e.message ? e.message : e, REASON_MAX), INTERNAL_FIX)];
  }
  if (ctx.raw) process.stdout.write(JSON.stringify({ checks }) + '\n');
  else process.stdout.write(renderText(checks));
  process.exitCode = checks.some((c) => c.status === 'error') ? 1 : 0;
  return undefined;
}

function route(ctx) {
  const sub = ctx && Array.isArray(ctx.args) ? ctx.args[1] : undefined;
  if (sub === 'doctor') return runDoctor(ctx);
  ctx.error(USAGE);
  return undefined;
}

// enginesCheck is exported for tests only.
module.exports = { route, gateChecks, enginesCheck, PROBE_TIMEOUT_MS };

if (require.main === module) {
  route({
    args: ['memanto', ...process.argv.slice(2).filter((a) => a !== '--raw')],
    cwd: process.cwd(),
    raw: process.argv.includes('--raw'),
    error: (msg) => {
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(1);
    },
  });
}
