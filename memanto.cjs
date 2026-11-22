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
const { classifyInstall, installRecords, renderFix, STATES, POST_COLLISION, POST_COLLISION_REASONS } = require('./lib/install-state.cjs');

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
// IN-06: a probe record is trusted only for its known shape. A status other
// than ok/warn/error, or a record that is not an object, becomes an error, so
// doctor can never exit 0 on a record it does not understand.
const STATUSES = new Set(['ok', 'warn', 'error']);

function probeRecord(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) {
    return record('check-probe', 'error', 'check probe returned a record that is not an object', INTERNAL_FIX);
  }
  const id = clean(c.id === undefined ? 'check-probe' : c.id, REASON_MAX);
  const message = clean(c.message === undefined ? '' : c.message, REASON_MAX);
  // Round-2 IN-01: fix is printed by renderText too, so it is cleaned like id and message.
  const fix = typeof c.fix === 'string' ? clean(c.fix, REASON_MAX) : '';
  if (!STATUSES.has(c.status)) {
    return record(id, 'error', clean(`check probe returned status ${JSON.stringify(c.status)}: ${message}`, REASON_MAX), fix || INTERNAL_FIX);
  }
  return record(id, c.status, message, fix);
}

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
    return parsed.checks.map(probeRecord);
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

function pointsOf(manifest, points) {
  for (const kind of ['gates', 'steps', 'contributions']) {
    for (const h of manifest && Array.isArray(manifest[kind]) ? manifest[kind] : []) {
      if (h && typeof h.point === 'string' && !points.includes(h.point)) points.push(h.point);
    }
  }
  return points;
}

// Round-8 CR-01: the points to render are discuss:pre, every point THIS
// doctor's own shipped manifest declares, and every point the installed
// manifests declare. An installed manifest with "gates": [] can no longer hide
// the gate point, so a missing gate always shows as a render error.
function declaredPoints(scopeDirs) {
  const points = ['discuss:pre'];
  pointsOf(readJson(OWN_MANIFEST), points);
  for (const dir of [scopeDirs.global, scopeDirs.project]) pointsOf(readJson(path.join(dir, 'capability.json')), points);
  return points;
}

const isMemantoGate = (h) => Boolean(h && h.capId === 'memanto' && h.kind === 'gate');

function loadFailureReason(rh) {
  const lines = [...rh.warnings, ...String(rh.stderr || '').split('\n')];
  const line = lines.find((l) => l.includes('capability "memanto" failed to load'));
  if (!line) return null;
  const m = /failed to load \((.*)\); its /.exec(line);
  return m ? m[1] : line;
}

function renderCheck(point, rh) {
  const id = `render:${point}`;
  if (!rh.ok) {
    return record(id, 'error', clean(`loop render-hooks ${point} failed: ${rh.reason}`, REASON_MAX), 'run gsd_run loop render-hooks to see the host error');
  }
  if (point === 'discuss:pre' && rh.hooks.some(isMemantoGate)) return record(id, 'ok', 'the memanto gate renders at discuss:pre', '');
  if (point !== 'discuss:pre' && rh.hooks.some((h) => h && h.capId === 'memanto')) return record(id, 'ok', `memanto renders at ${point}`, '');
  const reason = loadFailureReason(rh);
  const why = reason ? ` (host: ${clean(reason, REASON_MAX)})` : '';
  const what = point === 'discuss:pre' ? 'no memanto gate renders at discuss:pre' : `no memanto hook renders at ${point}`;
  return record(id, 'error', `${what}; it is not enforced (fails open)${why}`, renderFix(reason, reinstallFix()));
}

// Every "capability "memanto" failed to load (<reason>)" warning gsd-core
// printed while rendering hooks, one entry per skipped copy. Round-5 WR-01:
// one render-hooks call prints one warning per skipped copy, so the same reason
// twice in one call means both copies were skipped for it. Repeats within a
// call are kept; repeats across calls (several points) are not counted again.
// The warnings list and stderr carry the same lines, so each call counts the
// source that holds more of them.
function loadFailureReasons(renders) {
  const re = /capability "memanto" failed to load \((.*)\); its /;
  const counts = new Map();
  for (const rh of renders) {
    const tally = (lines) => {
      const t = new Map();
      for (const line of lines) {
        const m = re.exec(line);
        if (m) t.set(m[1], (t.get(m[1]) || 0) + 1);
      }
      return t;
    };
    const fromWarnings = tally(rh.warnings);
    const fromStderr = tally(String(rh.stderr || '').split('\n'));
    for (const reason of new Set([...fromWarnings.keys(), ...fromStderr.keys()])) {
      const n = Math.max(fromWarnings.get(reason) || 0, fromStderr.get(reason) || 0);
      counts.set(reason, Math.max(counts.get(reason) || 0, n));
    }
  }
  const reasons = [];
  for (const [reason, n] of counts) for (let i = 0; i < n; i++) reasons.push(reason);
  return reasons;
}

function canonical(dir) {
  try {
    return { path: fs.realpathSync(dir), failed: false, enoent: false };
  } catch (e) {
    return { path: path.resolve(dir), failed: true, enoent: e && (e.code === 'ENOENT' || e.code === 'ENOTDIR') };
  }
}

function hasProjectMarker(root) {
  try {
    if (fs.statSync(path.join(root, '.planning')).isDirectory()) return true;
  } catch {
    /* fall through */
  }
  return fs.existsSync(path.join(root, '.git'));
}

// Round-8 WR-02: mirror gsd-core overlayRoots (capability-loader.cjs 1.20.1
// :259-290). The two capability roots are one copy when they canonicalize
// equal (a symlinked GSD_HOME included). With a genuine project root (.planning
// or .git) the global root is demoted to consent-required project scope unless
// it is provably a different physical directory.
function rootsAlias(roots) {
  const g = canonical(path.join(roots.gsdHome, '.gsd', 'capabilities'));
  const p = canonical(path.join(roots.projectRoot, '.gsd', 'capabilities'));
  const sameDir = !g.failed && !p.failed ? g.path === p.path : path.resolve(g.path) === path.resolve(p.path);
  let demoted = false;
  if (hasProjectMarker(roots.projectRoot) && !(p.failed && p.enoent)) {
    demoted = !(!g.failed && !p.failed && g.path !== p.path);
  }
  return { sameDir, demoted };
}

function sameReal(a, b) {
  return canonical(a).path === canonical(b).path;
}

// Round-7/8: everything lib/install-state.cjs classifies, read once. rows is
// null when capability list could not be read; renders are the successful
// render-hooks results as { point, rh } (none when memanto is disabled or
// nothing rendered).
function gatherEvidence({ scopeDirs, roots, rows, renders, enabled = true }) {
  const rootOf = { global: roots.gsdHome, project: roots.projectRoot };
  const per = (fn) => ({ global: fn('global'), project: fn('project') });
  const manifests = per((s) => gateBundle.readManifest(rootOf[s]));
  const alias = rootsAlias(roots);
  const runs = gateBundle.resolveGateBundle(roots);
  let gateRuns = null;
  if (runs) gateRuns = sameReal(runs, scopeDirs.global) ? 'global' : sameReal(runs, scopeDirs.project) ? 'project' : null;
  const rhs = renders.map((r) => r.rh);
  return {
    dirs: scopeDirs,
    sameDir: alias.sameDir,
    demoted: alias.demoted,
    manifest: per((s) => gateBundle.hasManifest(rootOf[s])),
    manifestOk: per((s) => Boolean(manifests[s])),
    declaresGate: per((s) => Boolean(manifests[s] && Array.isArray(manifests[s].gates) && manifests[s].gates.some((x) => x && x.point === 'discuss:pre'))),
    gateFile: per((s) => isFile(path.join(scopeDirs[s], 'scripts', 'gate.cjs'))),
    ledger: per((s) => gateBundle.ledgerState(rootOf[s])),
    gateRuns,
    rows,
    render: {
      ran: renders.length > 0,
      hook: rhs.some((rh) => rh.hooks.some((h) => h && h.capId === 'memanto')),
      gate: renders.some((r) => r.point === 'discuss:pre' && r.rh.hooks.some(isMemantoGate)),
    },
    reasons: renders.length ? loadFailureReasons(rhs) : [],
    enabled,
  };
}

// installRecords cleans with a length factor: 2 for messages, 3 for fixes.
function cleanFactor(text, factor) {
  return clean(text, factor === 3 ? 600 : REASON_MAX * factor);
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
  let listOk = false;
  const renders = [];
  const renderChecks = [];

  const located = host.locateGsdTools({ env, mainFilename: require.main && require.main.filename });
  checks.push(locatedCheck(located));
  const { enabled, rec } = enabledCheck(cfg);
  checks.push(rec);

  let listFailure = null;
  if (located.ok) {
    const opts = { cwd, env };
    const list = host.capabilityList(located.tools, opts);
    if (!list.ok) {
      listFailure = record('capability-list', 'error', clean(`capability list failed: ${list.reason}`, REASON_MAX), 'run gsd-tools capability list to see the host error');
    } else {
      listOk = true;
      rows = list.rows.filter((r) => r && r.id === 'memanto');
    }
    if (enabled) {
      for (const point of declaredPoints(scopeDirs)) {
        const rh = host.renderHooksAt(located.tools, point, opts);
        if (rh.ok) renders.push({ point, rh });
        renderChecks.push(renderCheck(point, rh));
      }
    }
  }

  // Round-7: the evidence is gathered once and classified once; loaded,
  // consent, duplicate-install and gate-bundle all come from that one result.
  const cls = classifyInstall(gatherEvidence({ scopeDirs, roots, rows, renders, enabled }));
  const recs = installRecords(cls, { version: ownVersion(), reinstall: reinstallFix(), clean: cleanFactor });

  if (listFailure) checks.push(listFailure);
  if (located.ok && enabled) checks.push(recs.loaded);
  if (listOk) {
    checks.push(recs.consent);
    checks.push(enginesCheck(rows, scopeDirs, located.version));
  }
  checks.push(...renderChecks);
  checks.push(recs.duplicate);
  checks.push(recs.gateBundle);
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
  let output;
  // IN-06: rendering is guarded too, so a malformed record yields a
  // doctor-internal error instead of a thrown router.
  try {
    checks = collectChecks(cwd);
    output = ctx.raw ? JSON.stringify({ checks }) + '\n' : renderText(checks);
  } catch (e) {
    checks = [record('doctor-internal', 'error', clean(e && e.message ? e.message : e, REASON_MAX), INTERNAL_FIX)];
    output = ctx.raw ? JSON.stringify({ checks }) + '\n' : renderText(checks);
  }
  process.stdout.write(output);
  process.exitCode = checks.some((c) => c.status === 'error') ? 1 : 0;
  return undefined;
}

function route(ctx) {
  const sub = ctx && Array.isArray(ctx.args) ? ctx.args[1] : undefined;
  if (sub === 'doctor') return runDoctor(ctx);
  ctx.error(USAGE);
  return undefined;
}

// enginesCheck, the classifier, its record table and the POST_COLLISION list
// are exported for tests only. Round-7 IN-02: the per-record helpers are no
// longer exported; tests go through classifyInstall and installRecords, which
// take one evidence object and need no optional arguments.
module.exports = {
  route,
  gateChecks,
  enginesCheck,
  gatherEvidence,
  classifyInstall,
  installRecords,
  STATES,
  POST_COLLISION,
  POST_COLLISION_REASONS,
  PROBE_TIMEOUT_MS,
};

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
