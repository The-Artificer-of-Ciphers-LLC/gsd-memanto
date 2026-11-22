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

function describeRow(r) {
  return `${r.status} in ${r.scope} scope${r.reason ? ` (${r.reason})` : ''}`;
}

// Round-4 WR-01: gsd-core skipped one of two copies and doctor cannot tell which.
function undeterminedText(loaded, scopeDirs) {
  return `gsd-core skipped a memanto copy (${describeReasons(loaded.reasons)}); doctor cannot tell whether it skipped the global copy at ${scopeDirs.global} or the project copy at ${scopeDirs.project}`;
}

// Round-5 WR-01: renders succeeded and none held a memanto hook.
// Round-6 WR-01: the wording follows how many memanto manifests are on disk,
// and the fix follows the reasons gsd-core gave.
function notLoadedText(failures, scopeDirs, roots) {
  const inGlobal = gateBundle.hasManifest(roots.gsdHome);
  const inProject = gateBundle.hasManifest(roots.projectRoot);
  let what;
  if (inGlobal && inProject) what = 'gsd-core loaded neither memanto copy';
  else if (inGlobal || inProject) {
    const scope = inGlobal ? 'global' : 'project';
    what = `gsd-core did not load the ${scope} memanto copy at ${scopeDirs[scope]}`;
  } else what = 'gsd-core loaded no memanto copy';
  const why = failures && failures.length ? ` (${describeReasons(failures)})` : ' and printed no load error';
  return `${what}${why}; no memanto hook renders, so its gate does not run (fails open)`;
}
// An ownership clash: another capability holds the id or a memanto config key,
// skill, agent or command family. Reinstalling memanto does not clear it.
const CLASH = /^(owns |id collides)/;
const CLASH_FIX =
  'fix the load error first (for example another capability that owns a memanto config key, skill, agent or command family); reinstalling or removing a memanto copy does not clear it';
function notLoadedFix(failures) {
  const reasons = failures || [];
  if (reasons.length === 0) return `fix the error the render checks report, or ${reinstallFix()}`;
  if (reasons.every((r) => CLASH.test(r))) return CLASH_FIX;
  // engines.gsd, validation, manifest or fragment failures: a valid or
  // compatible release is the cure, as the engines and render:* records say.
  const fix = `fix the load error the loaded, engines and render checks report, or ${reinstallFix()}`;
  return reasons.some((r) => CLASH.test(r))
    ? `${fix}; a reinstall does not clear the ownership clash, so also fix or remove the capability that owns the memanto key`
    : fix;
}

function loadedCheck(rows, loaded, scopeDirs, { noneLoaded = false, failures = null, roots } = {}) {
  const shown = rows.filter((r) => r.status === 'active').map((r) => r.scope);
  const reported = Boolean(failures && failures.length);
  if (noneLoaded && (shown.length || reported)) {
    const list = shown.length ? `capability list shows memanto active in ${shown.join(' and ')} scope, but ` : '';
    return record('loaded', 'error', clean(`${list}${notLoadedText(failures, scopeDirs, roots)}`, REASON_MAX * 2), notLoadedFix(failures));
  }
  if (loaded && loaded.scope === 'unknown') {
    return record('loaded', 'error', clean(undeterminedText(loaded, scopeDirs), REASON_MAX * 2), 'fix the load error the render checks report, or remove one of the two copies');
  }
  const activeRows = rows.filter((r) => r.status === 'active');
  const active = activeRows[0];
  if (active) {
    const base = `memanto ${active.version || ''} is active in ${active.scope} scope`.replace('  ', ' ');
    // Round-3 IN-02 / round-4 WR-01: capability list can show a copy the loader
    // skipped as active, so name the copy gsd-core loads whenever it is not the
    // only active row.
    if (loaded && (loaded.scope !== active.scope || activeRows.length > 1)) {
      return record('loaded', 'ok', clean(`${base} per capability list; gsd-core loads the ${loaded.scope} copy at ${loaded.dir} (see gate-bundle)`, REASON_MAX * 2), '');
    }
    return record('loaded', 'ok', base, '');
  }
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

function renderCheck(point, rh) {
  const id = `render:${point}`;
  if (!rh.ok) {
    return record(id, 'error', clean(`loop render-hooks ${point} failed: ${rh.reason}`, REASON_MAX), 'run gsd_run loop render-hooks to see the host error');
  }
  if (rh.hooks.some((h) => h && h.capId === 'memanto')) return record(id, 'ok', `memanto renders at ${point}`, '');
  const reason = loadFailureReason(rh);
  const why = reason ? ` (host: ${clean(reason, REASON_MAX)})` : '';
  return record(id, 'error', `no memanto hook renders at ${point}; it is not enforced (fails open)${why}`, `fix the reported load error or ${reinstallFix()}`);
}

function duplicateCheck(scopeDirs, roots, loaded, noneLoaded = false) {
  const present = Object.entries(scopeDirs).filter(([, dir]) => dir && isFile(path.join(dir, 'capability.json')));
  const distinct = new Set(present.map(([, dir]) => path.resolve(dir)));
  if (present.length < 2 || distinct.size < 2) {
    return record('duplicate-install', 'ok', 'memanto is installed in at most one scope', '');
  }
  // Round-3 IN-02: a copy that no ledger lists cannot be removed with
  // gsd-tools capability remove, and the other copy is the install to keep
  // (the same hint as gate-bundle).
  const unledgered = ['global', 'project'].find((scope) => !gateBundle.isInstalledBundle(roots[scope === 'global' ? 'gsdHome' : 'projectRoot']));
  const fix = unledgered
    ? clean(`delete ${scopeDirs[unledgered]} by hand (no ${unledgered} ledger lists it, so gsd-tools capability remove cannot remove it; see gate-bundle)`, 600)
    : 'remove one copy: gsd-tools capability remove memanto --scope project (or --scope global)';
  // Round-4 WR-01: say which copy gsd-core keeps only when doctor knows it.
  // Round-5 WR-01: when it loaded neither, removing a copy does not fix that.
  if (noneLoaded) {
    return record(
      'duplicate-install',
      'warn',
      clean(`memanto is installed in both global (${scopeDirs.global}) and project (${scopeDirs.project}) scope; gsd-core loaded neither of them (see loaded)`, REASON_MAX * 2),
      `fix the load error first (see loaded); then ${fix}`,
    );
  }
  let keeps;
  if (loaded && loaded.scope === 'global') keeps = 'gsd-core keeps the global one and skips the project one';
  else if (loaded && loaded.scope === 'project') keeps = 'gsd-core skipped the global one and loads the project one (see gate-bundle)';
  else keeps = 'gsd-core loads at most one of them (see loaded and gate-bundle)';
  return record(
    'duplicate-install',
    'warn',
    clean(`memanto is installed in both global (${scopeDirs.global}) and project (${scopeDirs.project}) scope; ${keeps}`, REASON_MAX * 2),
    fix,
  );
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

// Reasons for a message: each once, marked when it was reported for both copies.
function describeReasons(reasons) {
  const counts = new Map();
  for (const r of reasons || []) counts.set(r, (counts.get(r) || 0) + 1);
  return [...counts].map(([r, n]) => (n > 1 ? `${r} (reported for both copies)` : r)).join('; ');
}

const COLLIDES = /^id collides/;
// Round-4 WR-01: the skip reasons gsd-core's loader gives only AFTER its
// id-collision check (capability-loader.cjs 1.20.1: owned skill, agent, config
// key or command family, engines.gsd, hook fragments, cross-capability
// validation, configHome confinement). While an accepted global copy holds the
// id, a project copy is skipped as colliding before it can get one of these, so
// such a reason names the global copy as the skipped one. Every other reason
// (manifest read, reserved prefix, failed validation, or one this list does not
// know) can belong to either copy.
// The prefixes are listed in the loader's own order: test/loader-drift.test.cjs
// reads the installed loader's source and fails when that order changes.
const POST_COLLISION_REASONS = Object.freeze([
  'owns skill ',
  'owns agent ',
  'owns config key ',
  'owns command family ',
  'incompatible with GSD ',
  'hook fragment could not be materialized: ',
  'invalid hook fragment: ',
  'cross-capability validation error: ',
  'cross-capability validation failed: ',
  'configHome confinement rejected: ',
]);
const POST_COLLISION = new RegExp(`^(${POST_COLLISION_REASONS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);

// The copy gsd-core loads, by the loader's precedence. The loader scans the
// global root first. A global capability.json it accepts claims the id, even
// with no ledger entry, and a project copy with the same id is then skipped as
// colliding. capability list (built from the ledgers) can show a skipped copy
// as active and has no row for an unledgered global copy, so it alone cannot
// say which copy loads. failures are the loader's own skip reasons from
// render-hooks (loadFailureReasons), which carry no scope, or null when no hook
// was rendered. Round-4 WR-01: a reason that names the global copy (see
// POST_COLLISION) means the global copy is not loaded even when capability
// list shows a ledgered global row as active, and a reason that either copy
// could have is reported as undetermined, never guessed.
// Round-5 WR-01: rendered says whether any memanto hook rendered (null when no
// render succeeded). A post-collision reason proves only that the global copy
// did not claim the id, not that the project copy loaded, so when renders
// succeeded and none held a memanto hook, no copy is loaded.
// { scope, dir } | { scope: 'unknown', dir: null, reasons } | null (no copy loaded)
function loadedCopy({ rows, scopeDirs, roots, failures, rendered = null }) {
  if (rendered === false) return null;
  const list = rows || [];
  const projectActive = list.find((r) => r.scope === 'project' && r.status === 'active');
  const projectCopy = projectActive && scopeDirs.project ? { scope: 'project', dir: scopeDirs.project } : null;
  // No global capability.json: only the project copy can load.
  if (!gateBundle.hasManifest(roots.gsdHome)) return projectCopy;
  const reasons = failures || [];
  const globalRow = list.find((r) => r.scope === 'global');
  let globalSkipped;
  if (reasons.some((r) => COLLIDES.test(r))) globalSkipped = false; // proves the global copy holds the id
  else if (globalRow && globalRow.status !== 'active') globalSkipped = true;
  else if (reasons.some((r) => POST_COLLISION.test(r))) globalSkipped = true;
  else if (reasons.length === 0) globalSkipped = false;
  else if (!gateBundle.hasManifest(roots.projectRoot)) globalSkipped = true; // only the global copy exists
  else return { scope: 'unknown', dir: null, reasons };
  if (!globalSkipped) return { scope: 'global', dir: scopeDirs.global };
  return projectCopy;
}

const otherScope = (scope) => (scope === 'global' ? 'project' : 'global');

// CR-01: the discuss:pre predicate runs scripts/gate.cjs only from an installed
// bundle (lib/gate-bundle.cjs). Error when that differs from the copy gsd-core
// loads (loadedCopy), when no installed bundle exists while a copy is loaded,
// or when a scope directory holds gate code that is not an installed bundle
// (stray or planted).
// Round-2 WR-03: a fix hint never removes the copy gsd-core loaded when it is
// installed, nor any installed copy. It names the stray copy: a directory with
// no committed ledger entry is deleted by hand, because gsd-tools capability
// remove only removes ledgered installs.
// Round-6 IN-01: rendered is the render evidence itself (true, false, or null
// when no render succeeded). rendered === false is an error whether or not
// gsd-core printed a reason, so gate-bundle agrees with loaded.
function gateBundleCheck(loaded, scopeDirs, roots, failures = null, rendered = null) {
  const noneLoaded = rendered === false;
  const resolved = gateBundle.resolveGateBundle(roots);
  const installed = {
    global: gateBundle.isInstalledBundle(roots.gsdHome),
    project: gateBundle.isInstalledBundle(roots.projectRoot),
  };
  const keep = (scope) => (installed[scope] ? `; keep the installed ${scope} bundle at ${scopeDirs[scope]}` : '');
  if (noneLoaded) {
    // Round-5 WR-01: no memanto hook renders, so no discuss:pre gate runs at all.
    return record('gate-bundle', 'error', clean(notLoadedText(failures, scopeDirs, roots), REASON_MAX * 2), notLoadedFix(failures));
  }
  if (loaded && loaded.scope === 'unknown') {
    // Round-4 WR-01: fail closed when doctor cannot tell which copy loads.
    return record(
      'gate-bundle',
      'error',
      clean(`${undeterminedText(loaded, scopeDirs)}, so it cannot confirm that the discuss:pre gate (${resolved ? `${resolved}/scripts/gate.cjs` : 'no installed bundle'}) runs the copy gsd-core loads`, REASON_MAX * 2),
      'fix the load error the render checks report, or remove one of the two copies, then run doctor again',
    );
  }
  if (loaded && resolved && path.resolve(resolved) !== path.resolve(loaded.dir)) {
    // Only reachable as: the global bundle is installed, but gsd-core skipped it
    // (failed validation, an invalid fragment, a clash, outside engines.gsd) and
    // loads the project one. Round-4 WR-01: the loader's reasons, when reported.
    const other = otherScope(loaded.scope);
    const why = failures && failures.length ? ` (gsd-core skipped the ${other} copy: ${describeReasons(failures)})` : '';
    return record(
      'gate-bundle',
      'error',
      clean(`the discuss:pre gate would run ${resolved}/scripts/gate.cjs, but gsd-core loads the bundle at ${loaded.dir}${why}`, REASON_MAX * 2),
      clean(
        `gsd-core did not load the installed ${other} bundle at ${resolved}: fix the load error the loaded, engines and render checks report, ` +
          `or replace it: gsd-tools capability install npm:@taoc/gsd-memanto@${ownVersion()} --yes${other === 'project' ? ' --scope project' : ''}${keep(loaded.scope)}`,
        600,
      ),
    );
  }
  if (loaded && !resolved) {
    // While a global capability.json exists the gate never falls back to a
    // project copy, so the global directory is the one to remove.
    const strayScope = gateBundle.hasManifest(roots.gsdHome) ? 'global' : 'project';
    const strayDir = scopeDirs[strayScope];
    const then = installed[otherScope(strayScope)] ? keep(otherScope(strayScope)) : `, then ${reinstallFix()}`;
    // Round-4 IN-01: claim the collision only when gsd-core reported it;
    // otherwise state only what is known.
    let collides = '';
    if (loaded.scope === 'global' && gateBundle.hasManifest(roots.projectRoot)) {
      collides = (failures || []).some((r) => COLLIDES.test(r))
        ? ' (a global capability.json exists, so gsd-core skips the project copy with the same id as colliding)'
        : ' (a global capability.json exists, and gsd-core scans the global copy first)';
    }
    return record(
      'gate-bundle',
      'error',
      clean(
        `gsd-core loads memanto from ${loaded.dir}${collides}, but the discuss:pre gate finds no installed bundle to run (capability.json plus a committed ledger entry): ` +
          `${strayDir} has no committed ${strayScope} ledger entry` +
          (strayScope === 'global' ? ', and the gate never falls back to a project copy while a global capability.json exists' : '') +
          '; it blocks every run',
        REASON_MAX * 2,
      ),
      clean(`delete ${strayDir} by hand (gsd-tools capability remove cannot remove a copy that no ledger lists)${then}`, 600),
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
  let failures = null;

  const located = host.locateGsdTools({ env, mainFilename: require.main && require.main.filename });
  checks.push(locatedCheck(located));
  const { enabled, rec } = enabledCheck(cfg);
  checks.push(rec);

  let rendered = null;
  const loadedNow = () => loadedCopy({ rows, scopeDirs, roots, failures, rendered });

  if (located.ok) {
    const opts = { cwd, env };
    const list = host.capabilityList(located.tools, opts);
    if (!list.ok) {
      checks.push(record('capability-list', 'error', clean(`capability list failed: ${list.reason}`, REASON_MAX), 'run gsd-tools capability list to see the host error'));
    } else {
      rows = list.rows.filter((r) => r && r.id === 'memanto');
      // Render first, so the loaded check can use the loader's skip reasons.
      const renders = [];
      const renderChecks = [];
      if (enabled) {
        for (const point of declaredPoints(rows, scopeDirs)) {
          const rh = host.renderHooksAt(located.tools, point, opts);
          if (rh.ok) renders.push(rh);
          renderChecks.push(renderCheck(point, rh));
        }
        failures = renders.length ? loadFailureReasons(renders) : null;
        // Round-5 WR-01: whether any memanto hook rendered (null: no render succeeded).
        rendered = renders.length ? renders.some((rh) => rh.hooks.some((h) => h && h.capId === 'memanto')) : null;
        checks.push(loadedCheck(rows, loadedNow(), scopeDirs, { noneLoaded: rendered === false, failures, roots }));
      }
      checks.push(consentCheck(rows, scopeDirs));
      checks.push(enginesCheck(rows, scopeDirs, located.version));
      checks.push(...renderChecks);
    }
  }
  // rows is null when capability list could not be read; loadedCopy then
  // decides only what the remaining evidence proves.
  const loaded = loadedNow();
  // Round-5 WR-01 / round-6 IN-01: renders succeeded and no memanto hook
  // rendered, with or without a reason; failures only feed the message text.
  checks.push(duplicateCheck(scopeDirs, roots, loaded, rendered === false));
  checks.push(gateBundleCheck(loaded, scopeDirs, roots, failures, rendered));
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

// enginesCheck, loadedCopy and the POST_COLLISION list are exported for tests only.
module.exports = { route, gateChecks, enginesCheck, loadedCopy, loadedCheck, gateBundleCheck, POST_COLLISION, POST_COLLISION_REASONS, PROBE_TIMEOUT_MS };

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
