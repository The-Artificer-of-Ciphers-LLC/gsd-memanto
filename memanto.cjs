'use strict';
// `memanto` command family (D-17). route(ctx) is synchronous: gsd-core rejects
// a router that returns a Promise. ctx = { args, cwd, raw, error }, args[0] is
// the family name. Also runnable directly as `node memanto.cjs doctor [--raw]`
// for the states in which gsd-core does not route the family (not consented,
// outside engines.gsd, failed validation, not in a ledger).

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { resolveConfig } = require('./lib/config.cjs');
const { cap, CONTROL_CHARS } = require('./lib/health.cjs');
const host = require('./lib/gsd-host.cjs');
const gateBundle = require('./lib/gate-bundle.cjs');
const { readJsonOrNull, MANIFEST_MAX_BYTES } = require('./lib/safe-read.cjs');
const { classifyInstall, installRecords, renderFix, reasonClass, REASON_CLASSES, STATES, POST_COLLISION, POST_COLLISION_REASONS } = require('./lib/install-state.cjs');

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

// Round-9 CR-01: never a plain readFileSync. A FIFO, device or oversized file
// is unreadable (null) instead of blocking doctor (lib/safe-read.cjs).
function readJson(file) {
  return readJsonOrNull(file, MANIFEST_MAX_BYTES);
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

// Round-9 WR-02: the loop points gsd-core defines (loop-host-contract.cjs
// LOOP_HOST_CONTRACT; test/render-points.test.cjs fails when they change). A
// manifest point outside this list is never rendered, so a planted manifest
// cannot add spawns or put control characters into a record id.
const LOOP_POINTS = Object.freeze([
  'discuss:pre',
  'discuss:post',
  'plan:pre',
  'plan:post',
  'execute:pre',
  'execute:wave:pre',
  'execute:wave:post',
  'execute:post',
  'verify:pre',
  'verify:post',
  'ship:pre',
  'ship:post',
]);

function pointsOf(manifest, points) {
  for (const kind of ['gates', 'steps', 'contributions']) {
    for (const h of manifest && Array.isArray(manifest[kind]) ? manifest[kind] : []) {
      if (points.length >= LOOP_POINTS.length) return points;
      if (h && LOOP_POINTS.includes(h.point) && !points.includes(h.point)) points.push(h.point);
    }
  }
  return points;
}

// Round-8 CR-01: discuss:pre is always rendered, and every point THIS doctor's
// own shipped manifest declares, so an installed manifest with "gates": []
// cannot hide the gate point. Round-9 WR-02: an installed manifest adds its
// points only when it is the copy gsd-core loads (loaded; null otherwise), and
// only known loop points, at most one render per loop point.
function pointsToRender(own, loaded) {
  const points = ['discuss:pre'];
  pointsOf(own, points);
  if (loaded) pointsOf(loaded, points);
  return points;
}

function readManifests(roots) {
  return { global: gateBundle.readManifest(roots.gsdHome), project: gateBundle.readManifest(roots.projectRoot) };
}

// Round-9 CR-01: a capability.json or ledger in either scope that exists but is
// not a regular file under the size cap (a FIFO, socket, device, a symlink to
// one, or too large). Doctor and gsd-core both treat it as unreadable.
function unreadableCheck(scopeDirs, roots, version) {
  const seen = new Set();
  const found = [];
  for (const [scope, root] of [['global', roots.gsdHome], ['project', roots.projectRoot]]) {
    for (const u of gateBundle.unreadableFiles(root)) {
      if (seen.has(u.file)) continue;
      seen.add(u.file);
      found.push({ ...u, scope, ledgered: gateBundle.ledgerState(root) !== 'none' });
    }
  }
  if (!found.length) return null;
  const fixes = found.map((u) => {
    if (u.kind === 'manifest' && u.ledgered) {
      return `reinstall the ${u.scope} copy in place: gsd-tools capability install npm:@taoc/gsd-memanto@${version} --yes${u.scope === 'project' ? ' --scope project' : ''}`;
    }
    if (u.kind === 'manifest') return `move ${u.file} aside (no ${u.scope} ledger lists that copy)`;
    return `move ${u.file} aside, then reinstall memanto in ${u.scope} scope (gsd-core cannot read that ledger either)`;
  });
  return record(
    'unreadable-files',
    'error',
    clean(`${found.map((u) => u.reason).join('; ')}; doctor and gsd-core read only small regular files there, so doctor treats it as invalid and never reads it`, REASON_MAX * 2),
    clean(fixes.join('; '), REASON_MAX * 2),
  );
}

const isMemantoGate = (h) => Boolean(h && h.capId === 'memanto' && h.kind === 'gate');

// Round-9 WR-01: the discuss:pre gate THIS doctor ships. A rendered memanto
// gate counts only when it matches it exactly: kind gate, blocking true,
// onError halt, a command-exit-zero predicate and the same command string.
// blocking and onError are checked against constants too, so an edited own
// manifest cannot relax them. A missing own gate matches nothing (fail closed).
// The returned gate carries the own manifest's version as releaseVersion.
function shippedGate() {
  const m = readJson(OWN_MANIFEST);
  const g = m && Array.isArray(m.gates) ? m.gates.find((x) => x && x.point === 'discuss:pre') : null;
  if (!g || !g.check || !g.check.predicate) return null;
  return { ...g, releaseVersion: typeof m.version === 'string' ? m.version : null };
}

// The predicate carries a version-pinned reinstall hint, which the release
// bump (publish.yml "Bump the version", the same pattern) rewrites. The command
// is therefore compared with every pin normalised to @<version>, and the pins
// are checked on their own against this bundle's version.
const PIN = /npm:@taoc\/gsd-memanto@[0-9A-Za-z.+-]+/g;
const normalisePins = (cmd) => String(cmd).replace(PIN, 'npm:@taoc/gsd-memanto@<version>');
const pinsOf = (cmd) => (String(cmd).match(PIN) || []).map((x) => x.slice('npm:@taoc/gsd-memanto@'.length));

// The sha256 of the shipped predicate command with its pins normalised. The
// own capability.json sits in the same editable bundle as this file, so the
// command is also checked against this constant: doctor run from a bundle
// whose capability.json was edited still reports the edit. The constant does
// not depend on the release version, so the release bump never touches it.
// test/gate-bundle.test.cjs fails when capability.json changes the command
// without updating this constant; test/release.test.cjs runs the bump.
const SHIPPED_GATE_COMMAND_SHA256 = '718039219206da78b2b7ce250262212e9e547fc3889ed6ed08c38275df8cea68';
const sha256 = (s) => crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');

// The fields in which a rendered hook differs from the shipped gate:
// 'command' (another command), 'version' (the shipped command pinned to
// another release), 'blocking', 'onError'. [] when it is the shipped gate.
function gateMismatch(h, shipped) {
  if (!isMemantoGate(h)) return ['kind'];
  const p = h.check && h.check.predicate ? h.check.predicate : {};
  const fields = [];
  const commandOk =
    shipped &&
    p.kind === 'command-exit-zero' &&
    p.kind === shipped.check.predicate.kind &&
    typeof p.command === 'string' &&
    normalisePins(p.command) === normalisePins(shipped.check.predicate.command) &&
    sha256(normalisePins(p.command)) === SHIPPED_GATE_COMMAND_SHA256;
  if (!commandOk) fields.push('command');
  else {
    const pins = pinsOf(p.command);
    if (!shipped.releaseVersion || !pins.length || pins.some((v) => v !== shipped.releaseVersion)) fields.push('version');
  }
  if (h.blocking !== true || (shipped && h.blocking !== shipped.blocking)) fields.push('blocking');
  if (h.onError !== 'halt' || (shipped && h.onError !== shipped.onError)) fields.push('onError');
  return fields;
}

// The fields in which the memanto gates rendered at discuss:pre differ from
// the shipped gate: null when one matches or none rendered.
function gateMismatchAt(rh, shipped) {
  const gates = rh.hooks.filter(isMemantoGate);
  if (!gates.length || gates.some((h) => gateMismatch(h, shipped).length === 0)) return null;
  return gateMismatch(gates[0], shipped).join(', ');
}

const rendersShippedGate = (rh, shipped) => rh.hooks.some((h) => isMemantoGate(h) && gateMismatch(h, shipped).length === 0);

function loadFailureReason(rh) {
  const lines = [...rh.warnings, ...String(rh.stderr || '').split('\n')];
  const line = lines.find((l) => l.includes('capability "memanto" failed to load'));
  if (!line) return null;
  const m = /failed to load \((.*)\); its /.exec(line);
  return m ? m[1] : line;
}

// loadedFix: the loaded record's fix (the remedy for the copy it names), used
// when gsd-core reported no load error (round-9 IN-03).
function renderCheck(rawPoint, rh, shipped, loadedFix) {
  // Round-9 WR-02: the point is cleaned before it reaches the id or a message.
  const point = clean(rawPoint, 64);
  const id = `render:${point}`;
  const remedy = loadedFix || reinstallFix();
  if (!rh.ok) {
    return record(id, 'error', clean(`loop render-hooks ${point} failed: ${rh.reason}`, REASON_MAX), 'run gsd_run loop render-hooks to see the host error');
  }
  if (point === 'discuss:pre' && rendersShippedGate(rh, shipped)) return record(id, 'ok', 'the memanto gate renders at discuss:pre and matches this release', '');
  if (point === 'discuss:pre' && rh.hooks.some(isMemantoGate)) {
    return record(
      id,
      'error',
      `the installed memanto gate at discuss:pre does not match this release: ${gateMismatchAt(rh, shipped)}; it is not enforced as shipped (fails open)`,
      remedy,
    );
  }
  if (point !== 'discuss:pre' && rh.hooks.some((h) => h && h.capId === 'memanto')) return record(id, 'ok', `memanto renders at ${point}`, '');
  const reason = loadFailureReason(rh);
  const why = reason ? ` (host: ${clean(reason, REASON_MAX)})` : '';
  const what = point === 'discuss:pre' ? 'no memanto gate renders at discuss:pre' : `no memanto hook renders at ${point}`;
  // "id collides" is not a load error of the copy gsd-core kept: its remedy applies.
  const loadError = reason && reasonClass(reason) !== REASON_CLASSES.COLLISION;
  return record(id, 'error', `${what}; it is not enforced (fails open)${why}`, loadError ? renderFix(reason, reinstallFix()) : remedy);
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
function gatherEvidence({ scopeDirs, roots, rows, renders, enabled = true, manifests: read, shipped = shippedGate() }) {
  const rootOf = { global: roots.gsdHome, project: roots.projectRoot };
  const per = (fn) => ({ global: fn('global'), project: fn('project') });
  const manifests = read || readManifests(roots);
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
      // Round-9 WR-01: the gate counts only when it is the shipped gate.
      gate: renders.some((r) => r.point === 'discuss:pre' && rendersShippedGate(r.rh, shipped)),
      mismatch: renders.filter((r) => r.point === 'discuss:pre').map((r) => gateMismatchAt(r.rh, shipped)).find(Boolean) || null,
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
  const manifests = readManifests(roots);
  const shipped = shippedGate();
  const checks = [];
  let rows = null;
  let listOk = false;
  const renders = [];
  const rendered = [];

  const located = host.locateGsdTools({ env, mainFilename: require.main && require.main.filename });
  checks.push(locatedCheck(located));
  const { enabled, rec } = enabledCheck(cfg);
  checks.push(rec);

  let listFailure = null;
  // Round-9 CR-01: gsd-core reads .planning/config.json with a plain read, so
  // with a FIFO or device there every capability list and render-hooks call
  // blocks until PROBE_TIMEOUT_MS. Doctor does not start them; it reports why.
  const hostBlocked = !cfg.ok && cfg.kind === 'read' && cfg.code === 'ENOTREG';
  if (located.ok && hostBlocked) {
    listFailure = record(
      'capability-list',
      'error',
      clean(`doctor did not query gsd-core (capability list, render-hooks): ${cfg.error}, and gsd-core blocks reading it`, REASON_MAX),
      clean(`replace ${cfg.path} with a regular JSON file, then run doctor again`, REASON_MAX),
    );
  } else if (located.ok) {
    const opts = { cwd, env };
    const list = host.capabilityList(located.tools, opts);
    if (!list.ok) {
      listFailure = record('capability-list', 'error', clean(`capability list failed: ${list.reason}`, REASON_MAX), 'run gsd-tools capability list to see the host error');
    } else {
      listOk = true;
      rows = list.rows.filter((r) => r && r.id === 'memanto');
    }
    if (enabled) {
      const renderAll = (points) => {
        for (const point of points) {
          if (rendered.some((r) => r.point === point)) continue;
          const rh = host.renderHooksAt(located.tools, point, opts);
          if (rh.ok) renders.push({ point, rh });
          rendered.push({ point, rh });
        }
      };
      // Round-9 WR-02: first discuss:pre and the doctor's own points; then the
      // points of the installed manifest gsd-core loads, if any (known loop
      // points only, never a manifest gsd-core skipped or did not activate).
      const own = readJson(OWN_MANIFEST);
      renderAll(pointsToRender(own, null));
      const first = classifyInstall(gatherEvidence({ scopeDirs, roots, rows, renders, enabled, manifests, shipped }));
      if (first.loaded) renderAll(pointsToRender(own, manifests[first.loaded.scope]));
    }
  }

  // Round-7: the evidence is gathered once and classified once; loaded,
  // consent, duplicate-install and gate-bundle all come from that one result.
  const cls = classifyInstall(gatherEvidence({ scopeDirs, roots, rows, renders, enabled, manifests, shipped }));
  const recs = installRecords(cls, { version: ownVersion(), reinstall: reinstallFix(), clean: cleanFactor });
  const unreadable = unreadableCheck(scopeDirs, roots, ownVersion());
  // Round-9 IN-03: built after the classification, so a no-reason render fix
  // is the loaded record's own remedy (the reinstall of the copy it names).
  const renderChecks = rendered.map((r) => renderCheck(r.point, r.rh, shipped, recs.loaded.fix));

  if (listFailure) checks.push(listFailure);
  if (unreadable) checks.push(unreadable);
  // Round-9 IN-01: with memanto disabled, loaded is a warn (see the README).
  if (located.ok) checks.push(recs.loaded);
  if (listOk) {
    checks.push(recs.consent);
    checks.push(enginesCheck(rows, scopeDirs, located.version));
  }
  checks.push(...renderChecks);
  checks.push(recs.duplicate);
  checks.push(recs.gateBundle);
  checks.push(discussBypassCheck(cfg));
  if (enabled) checks.push(...gateChecks(cwd));
  // Round-9 WR-02: no control character reaches the terminal or the JSON,
  // whatever a record interpolated (lengths are capped where each is built).
  return checks.map((c) => ({ ...c, id: sanitize(c.id), message: sanitize(c.message), fix: sanitize(c.fix) }));
}

function sanitize(value) {
  return String(value === undefined || value === null ? '' : value).replace(CONTROL_CHARS, '?');
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
  LOOP_POINTS,
  pointsToRender,
  SHIPPED_GATE_COMMAND_SHA256,
  shippedGate,
  gateMismatch,
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
