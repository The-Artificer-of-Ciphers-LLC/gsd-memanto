'use strict';
// Round-7: ONE classification of the memanto install/load state, and ONE
// message/fix table for the doctor records loaded, consent, duplicate-install
// and gate-bundle. Earlier rounds derived the state separately in each record,
// and every patch to one record made another contradict it.
//
// classifyInstall(evidence) is pure: memanto.cjs gathers the evidence once
// (file checks, ledgers, capability list, render-hooks), and this module only
// reasons over it. installRecords(cls, opts) builds the four records from the
// classification alone.
//
// Loader facts this relies on (gsd-core capability-loader.cjs 1.20.1 and
// 1.22.0; test/loader-drift.test.cjs reads the installed loader and fails when
// they change):
//   - overlayRoots scans the global root before the project root;
//   - the id is claimed (acceptedIds.add) only once a copy passes every check;
//   - a copy whose id is already claimed is skipped with "id collides ...",
//     so that reason proves gsd-core ACCEPTED the global copy;
//   - the POST_COLLISION_REASONS are given only after the collision check, so
//     while an accepted global copy holds the id a project copy never gets one:
//     such a reason names the global copy;
//   - a project copy is activated only with a committed ledger entry and a
//     user consent record; otherwise it is ignored without a warning.

const path = require('node:path');

const STATES = Object.freeze({
  NONE: 'none-installed', // no capability.json in either scope
  GLOBAL_LOADED: 'global-loaded',
  PROJECT_LOADED: 'project-loaded',
  UNDETERMINED: 'undetermined', // two copies, a hook rendered, a reason either copy can get
  GLOBAL_SKIPPED: 'global-skipped', // the only copy, skipped
  PROJECT_SKIPPED: 'project-skipped', // the only copy, skipped
  BOTH_SKIPPED: 'both-skipped', // two distinct copies, neither loaded
  GLOBAL_NO_HOOKS: 'global-accepted-no-hooks', // gsd-core accepted the global copy, no memanto hook renders
  PROJECT_INACTIVE: 'project-not-activated', // project copy with no ledger entry or no consent record
  UNEXPLAINED: 'no-hooks-unexplained', // an activated project copy renders nothing and no reason is given
});

const REASON_CLASSES = Object.freeze({
  CLASH: 'ownership-clash', // owns skill/agent/config key/command family: another capability holds it
  COLLISION: 'collision-with-accepted-global', // id collides: gsd-core accepted the global copy
  ENGINES: 'engines', // incompatible with GSD (engines.gsd)
  INVALID: 'invalid', // validation, manifest, fragment, cross-capability, configHome
  UNKNOWN: 'unknown',
});

// The loader's skip reasons that come only AFTER its id-collision check, in the
// loader's own order (test/loader-drift.test.cjs checks the order).
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
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const POST_COLLISION = new RegExp(`^(${POST_COLLISION_REASONS.map(escape).join('|')})`);
const COLLIDES = /^id collides/;
const INVALID =
  /^(failed validation: |unreadable or invalid capability\.json|id uses a reserved first-party prefix|hook fragment could not be materialized: |invalid hook fragment: |cross-capability validation |configHome confinement rejected: )/;

function reasonClass(reason) {
  const r = String(reason);
  if (/^owns /.test(r)) return REASON_CLASSES.CLASH;
  if (COLLIDES.test(r)) return REASON_CLASSES.COLLISION;
  if (/^incompatible with GSD /.test(r)) return REASON_CLASSES.ENGINES;
  if (INVALID.test(r)) return REASON_CLASSES.INVALID;
  return REASON_CLASSES.UNKNOWN;
}

const SCOPES = ['global', 'project'];
const other = (scope) => (scope === 'global' ? 'project' : 'global');

// evidence = {
//   dirs: { global, project },            the two scope bundle directories
//   manifest: { global, project },        capability.json exists there
//   gateFile: { global, project },        scripts/gate.cjs is a regular file there
//   installed: { global, project },       capability.json with id memanto plus a committed ledger entry
//   gateRuns: dir | null,                 the bundle the discuss:pre predicate runs (lib/gate-bundle.cjs)
//   rows: [capability list rows] | null,  null when capability list could not be read
//   render: { ran, hook },                ran: at least one render-hooks call succeeded;
//                                         hook: a memanto hook rendered in one of them
//   reasons: [string],                    the loader's "failed to load (<reason>)" texts, one per skipped copy
//   enabled: bool,                        memanto.enabled as doctor reads it (default true: fail closed)
// }
function classifyInstall(evidence) {
  const ev = evidence || {};
  const dirs = ev.dirs || {};
  const flag = (obj, scope) => Boolean(obj && obj[scope]);
  const sameDir = Boolean(dirs.global && dirs.project && path.resolve(dirs.global) === path.resolve(dirs.project));
  const rowsKnown = Array.isArray(ev.rows);
  const rows = rowsKnown ? ev.rows.filter((r) => r && (r.id === undefined || r.id === 'memanto')) : [];
  const reasons = Array.isArray(ev.reasons) ? ev.reasons.map(String) : [];
  const classes = reasons.map(reasonClass);
  const render = { ran: Boolean(ev.render && ev.render.ran), hook: Boolean(ev.render && ev.render.hook) };

  // One directory when the project root is GSD_HOME: count it once, as global
  // (the loader scans it as the global root first).
  const scopes = sameDir
    ? flag(ev.manifest, 'global') || flag(ev.manifest, 'project')
      ? ['global']
      : []
    : SCOPES.filter((s) => flag(ev.manifest, s));
  const installedIn = (s) => (sameDir ? flag(ev.installed, 'global') || flag(ev.installed, 'project') : flag(ev.installed, s));
  const rowFor = (s) => (sameDir ? rows.find((r) => r.status === 'active') || rows[0] : rows.find((r) => r.scope === s)) || null;
  const copies = scopes.map((s) => ({ scope: s, dir: dirs[s], installed: installedIn(s), row: rowFor(s) }));
  const copy = (s) => copies.find((c) => c.scope === s) || null;
  const g = copy('global');
  const p = copy('project');
  // A project copy is activated only with a ledger entry and consent; without
  // capability list, the committed ledger entry stands in for the row.
  const projectActive = Boolean(p && (rowsKnown ? p.row && p.row.status === 'active' : p.installed));
  const globalRowInactive = Boolean(g && g.row && g.row.status !== 'active');

  let state;
  if (copies.length === 0) {
    state = STATES.NONE;
  } else if (render.ran && !render.hook) {
    if (g && classes.includes(REASON_CLASSES.COLLISION)) state = STATES.GLOBAL_NO_HOOKS;
    else if (reasons.length) state = copies.length === 2 ? STATES.BOTH_SKIPPED : `${copies[0].scope}-skipped`;
    else if (g) state = STATES.GLOBAL_NO_HOOKS; // accepted (no reason), but nothing renders
    else if (!projectActive) state = STATES.PROJECT_INACTIVE;
    else state = STATES.UNEXPLAINED;
  } else if (render.ran) {
    // A memanto hook rendered, so one copy loaded.
    if (copies.length === 1) state = `${copies[0].scope}-loaded`;
    else if (classes.includes(REASON_CLASSES.COLLISION)) state = STATES.GLOBAL_LOADED;
    else if (globalRowInactive || reasons.some((r) => POST_COLLISION.test(r))) state = STATES.PROJECT_LOADED;
    else if (reasons.length === 0) state = STATES.GLOBAL_LOADED;
    else state = STATES.UNDETERMINED;
  } else if (g) {
    // No render evidence: the loader's precedence and the ledger rows only.
    if (!globalRowInactive) state = STATES.GLOBAL_LOADED;
    else if (projectActive) state = STATES.PROJECT_LOADED;
    else state = p ? STATES.BOTH_SKIPPED : STATES.GLOBAL_SKIPPED;
  } else {
    state = projectActive ? STATES.PROJECT_LOADED : STATES.PROJECT_INACTIVE;
  }

  let loaded = null;
  if (state === STATES.GLOBAL_LOADED || state === STATES.GLOBAL_NO_HOOKS) loaded = { scope: 'global', dir: g.dir };
  else if (state === STATES.PROJECT_LOADED) loaded = { scope: 'project', dir: p.dir };

  // Gate code in a directory that is not an installed bundle (stray or planted).
  let stray = null;
  for (const s of sameDir ? ['global'] : SCOPES) {
    const hasGate = sameDir ? flag(ev.gateFile, 'global') || flag(ev.gateFile, 'project') : flag(ev.gateFile, s);
    if (hasGate && !installedIn(s)) {
      stray = { scope: s, dir: dirs[s] };
      break;
    }
  }

  return {
    state,
    loaded,
    stray,
    copies,
    sameDir,
    rowsKnown,
    rows,
    render,
    reasons,
    classes,
    gateRuns: ev.gateRuns || null,
    dirs,
    enabled: ev.enabled !== false,
  };
}

// ---------------------------------------------------------------------------
// The message/fix table. Every record below is a function of the
// classification only, and every fix comes from the same few builders, so the
// records cannot disagree about which copy loads or what clears the error.

const LOADED_STATES = new Set([STATES.GLOBAL_LOADED, STATES.PROJECT_LOADED]);
const LOAD_ERROR_STATES = new Set([STATES.GLOBAL_SKIPPED, STATES.PROJECT_SKIPPED, STATES.BOTH_SKIPPED, STATES.UNEXPLAINED, STATES.UNDETERMINED]);

function describeReasons(reasons) {
  const counts = new Map();
  for (const r of reasons || []) counts.set(r, (counts.get(r) || 0) + 1);
  return [...counts].map(([r, n]) => (n > 1 ? `${r} (reported for both copies)` : r)).join('; ');
}

function describeRow(r) {
  return `${r.status} in ${r.scope} scope${r.reason ? ` (${r.reason})` : ''}`;
}

const isClash = (cls) => cls.classes.includes(REASON_CLASSES.CLASH);
const CLASH_NOTE = 'this does not clear the ownership clash (see loaded)';
const CLASH_FIX =
  'fix the load error first: remove or fix the other capability that owns a memanto config key, skill, agent or command family (see the reason in loaded); reinstalling or removing a memanto copy does not clear it';

// Delete a copy that no committed ledger lists (gsd-tools capability remove
// cannot remove it), then keep the installed other copy or reinstall.
// A copy with a committed ledger entry is never deleted by hand: it is
// reinstalled in place instead.
function deleteFix(cls, c, opts) {
  if (c.installed) {
    const fix = `reinstall the ${c.scope} copy at ${c.dir}: gsd-tools capability install npm:@taoc/gsd-memanto@${opts.version} --yes${c.scope === 'project' ? ' --scope project' : ''}`;
    return isClash(cls) ? `${fix}; ${CLASH_NOTE}` : fix;
  }
  const head = `delete ${c.dir} by hand (no committed ${c.scope} ledger entry lists it, so gsd-tools capability remove cannot remove it)`;
  if (isClash(cls)) return `${head}; ${CLASH_NOTE}`;
  const keep = cls.copies.find((x) => x.scope !== c.scope && x.installed);
  return keep ? `${head}; keep the installed ${keep.scope} bundle at ${keep.dir}` : `${head}, then ${opts.reinstall}`;
}

function consentFix(cls, opts) {
  const fix = `re-consent by reinstalling in the project: gsd-tools capability install npm:@taoc/gsd-memanto@${opts.version} --scope project --yes`;
  return isClash(cls) ? `${fix}; ${CLASH_NOTE}` : fix;
}

function reasonFix(cls, opts) {
  const reinstall = `fix the load error the loaded, engines and render checks report, or ${opts.reinstall}`;
  if (cls.classes.length && cls.classes.every((c) => c === REASON_CLASSES.CLASH)) return CLASH_FIX;
  if (isClash(cls)) {
    return `${reinstall}; a reinstall does not clear the ownership clash, so also remove or fix the other capability that owns the memanto key`;
  }
  return reinstall;
}

// The one fix for the load state, used by loaded and (after any stray-code
// deletion) by gate-bundle.
function primaryFix(cls, opts) {
  const g = cls.copies.find((c) => c.scope === 'global');
  const p = cls.copies.find((c) => c.scope === 'project');
  switch (cls.state) {
    case STATES.NONE:
      return opts.reinstall;
    case STATES.GLOBAL_LOADED:
    case STATES.PROJECT_LOADED:
      return '';
    case STATES.UNDETERMINED:
      return 'fix the load error the render checks report, or remove one of the two copies, then run doctor again';
    case STATES.GLOBAL_SKIPPED:
    case STATES.PROJECT_SKIPPED:
    case STATES.BOTH_SKIPPED:
      return reasonFix(cls, opts);
    case STATES.GLOBAL_NO_HOOKS:
      if (!g.installed) return deleteFix(cls, g, opts);
      return (
        `the global copy at ${g.dir} renders no memanto hook here: check that gsd-core reads memanto.enabled as true for this project, ` +
        `or reinstall it: gsd-tools capability install npm:@taoc/gsd-memanto@${opts.version} --yes`
      );
    case STATES.PROJECT_INACTIVE:
      if (cls.rowsKnown && !p.row) return deleteFix(cls, p, opts);
      if (p.row && /consent/i.test(String(p.row.reason || ''))) return consentFix(cls, opts);
      return `fix the error capability list reports for the project copy, or ${opts.reinstall}`;
    case STATES.UNEXPLAINED:
    default:
      return `fix the error the render checks report, or ${opts.reinstall}`;
  }
}

// The one sentence for a state in which no memanto gate runs.
function notLoadedText(cls) {
  const g = cls.copies.find((c) => c.scope === 'global');
  const p = cls.copies.find((c) => c.scope === 'project');
  const why = cls.reasons.length ? ` (${describeReasons(cls.reasons)})` : '';
  const tail = cls.render.ran ? '; no memanto hook renders, so its gate does not run (fails open)' : '; its gate does not run (fails open)';
  const rowWhy = (c) => (c && c.row && c.row.status !== 'active' ? ` (capability list: ${describeRow(c.row)})` : '');
  switch (cls.state) {
    case STATES.BOTH_SKIPPED:
      return `gsd-core loaded neither memanto copy (global at ${g.dir}, project at ${p.dir})${why || rowWhy(g)}${tail}`;
    case STATES.GLOBAL_SKIPPED:
    case STATES.PROJECT_SKIPPED: {
      const c = cls.copies[0];
      return `gsd-core did not load the ${c.scope} memanto copy at ${c.dir}${why || rowWhy(c)}${tail}`;
    }
    case STATES.GLOBAL_NO_HOOKS: {
      const collided = cls.classes.includes(REASON_CLASSES.COLLISION)
        ? ' (it holds the id, so gsd-core skipped the project copy: id collides with an already-registered capability)'
        : ' and gsd-core printed no load error';
      return `gsd-core loaded the global memanto copy at ${g.dir}, but it renders no memanto hook${collided}; its gate does not run (fails open)`;
    }
    case STATES.PROJECT_INACTIVE: {
      const whyNot = p.row ? ` (capability list: ${describeRow(p.row)})` : ' (no project capability ledger lists it; copied by hand?)';
      return `gsd-core does not activate the project memanto copy at ${p.dir}${whyNot}${tail}`;
    }
    case STATES.UNEXPLAINED:
      return `gsd-core did not load the project memanto copy at ${p.dir} and printed no load error${tail}`;
    case STATES.UNDETERMINED:
      return (
        `gsd-core skipped a memanto copy (${describeReasons(cls.reasons)}); doctor cannot tell whether it skipped ` +
        `the global copy at ${cls.dirs.global} or the project copy at ${cls.dirs.project}`
      );
    case STATES.NONE:
    default:
      return `no memanto copy is installed (no capability.json in ${cls.dirs.global} or ${cls.dirs.project})${cls.render.ran ? tail : ''}`;
  }
}

function strayText(cls) {
  return (
    `${cls.stray.dir} holds scripts/gate.cjs but is not an installed memanto bundle ` +
    `(no capability.json with id memanto or no committed ${cls.stray.scope} ledger entry); stray or planted gate code that the gate never runs`
  );
}

function withStrayFirst(cls, fix) {
  if (!cls.stray || fix.startsWith(`delete ${cls.stray.dir} `)) return fix;
  const head = `delete ${cls.stray.dir} by hand (stray or planted gate code; the gate never runs it)`;
  return fix ? `${head}; then ${fix}` : head;
}

function rec(id, status, message, fix, clean) {
  return { id, status, message: clean(message, 2), fix: status === 'ok' ? '' : clean(fix || '', 3) };
}

// opts = { version, reinstall, clean(text, factor) }
function installRecords(cls, opts) {
  const o = {
    version: (opts && opts.version) || '<version>',
    reinstall: (opts && opts.reinstall) || 'reinstall: gsd-tools capability install npm:@taoc/gsd-memanto --yes',
    clean: (opts && opts.clean) || ((s) => String(s)),
  };
  const fix = primaryFix(cls, o);
  return {
    loaded: loadedRecord(cls, o, fix),
    consent: consentRecord(cls, o),
    duplicate: duplicateRecord(cls, o),
    gateBundle: gateBundleRecord(cls, o, fix),
  };
}

function loadedRecord(cls, o, fix) {
  const active = cls.rows.filter((r) => r.status === 'active');
  if (LOADED_STATES.has(cls.state)) {
    const l = cls.loaded;
    const own = active.find((r) => r.scope === l.scope);
    if (own && active.length === 1) return rec('loaded', 'ok', `memanto ${own.version || ''} is active in ${l.scope} scope`.replace('  ', ' '), '', o.clean);
    if (active.length) {
      const a = active[0];
      const base = `memanto ${a.version || ''} is active in ${a.scope} scope`.replace('  ', ' ');
      return rec('loaded', 'ok', `${base} per capability list; gsd-core loads the ${l.scope} copy at ${l.dir} (see gate-bundle)`, '', o.clean);
    }
    if (!cls.rowsKnown) {
      return rec('loaded', 'warn', `capability list could not be read; by the loader's precedence gsd-core loads the ${l.scope} copy at ${l.dir}`, 'fix the error capability-list reports, then run doctor again', o.clean);
    }
    return rec(
      'loaded',
      'warn',
      `gsd-core loads the ${l.scope} memanto copy at ${l.dir}, but no ${l.scope} capability ledger lists it (see consent and gate-bundle)`,
      withStrayFirst(cls, deleteFix(cls, cls.copies.find((c) => c.scope === l.scope), o)),
      o.clean,
    );
  }
  if (cls.state === STATES.NONE) {
    const message = cls.rows.length
      ? `memanto.enabled is true but memanto is ${cls.rows.map(describeRow).join('; ')} and no capability.json is on disk; its gate does not run (fails open)`
      : 'memanto.enabled is true but capability list has no memanto row (not installed or not in a ledger); its gate does not run (fails open)';
    return rec('loaded', 'error', message, fix, o.clean);
  }
  const joiner = cls.state === STATES.GLOBAL_NO_HOOKS ? '; ' : ', but ';
  const list = active.length && cls.state !== STATES.UNDETERMINED ? `capability list shows memanto active in ${active.map((r) => r.scope).join(' and ')} scope${joiner}` : '';
  return rec('loaded', 'error', `${list}${notLoadedText(cls)}`, fix, o.clean);
}

function consentRecord(cls, o) {
  if (!cls.rowsKnown) {
    return rec('consent', 'warn', 'capability list could not be read, so consent and ledger entries were not checked', 'fix the error capability-list reports, then run doctor again', o.clean);
  }
  const unconsented = cls.rows.find((r) => r.status === 'inactive' && /consent/i.test(String(r.reason || '')));
  if (unconsented) {
    return rec('consent', 'error', `memanto in ${unconsented.scope} scope has no user consent record: ${unconsented.reason}`, consentFix(cls, o), o.clean);
  }
  for (const c of cls.copies) {
    if (c.row) continue;
    return rec(
      'consent',
      'error',
      `the memanto bundle at ${c.dir} is not in the ${c.scope} capability ledger (copied by hand?); gsd-core does not route gsd_run memanto for it`,
      deleteFix(cls, c, o),
      o.clean,
    );
  }
  return rec('consent', 'ok', 'every memanto bundle on disk is in a capability ledger and consented (global scope needs no consent record)', '', o.clean);
}

function duplicateRecord(cls, o) {
  if (cls.copies.length < 2) return rec('duplicate-install', 'ok', 'memanto is installed in at most one scope', '', o.clean);
  const [g, p] = cls.copies;
  const keeps = {
    [STATES.GLOBAL_LOADED]: 'gsd-core keeps the global one and skips the project one',
    [STATES.PROJECT_LOADED]: 'gsd-core skipped the global one and loads the project one (see gate-bundle)',
    [STATES.GLOBAL_NO_HOOKS]: 'gsd-core keeps the global one, which renders no memanto hook, and skips the project one (see loaded)',
    [STATES.BOTH_SKIPPED]: 'gsd-core loaded neither of them (see loaded)',
    [STATES.UNEXPLAINED]: 'gsd-core loaded neither of them (see loaded)',
  }[cls.state] || 'gsd-core loads at most one of them (see loaded and gate-bundle)';
  const unledgered = cls.copies.find((c) => !c.installed);
  const remove = unledgered ? deleteFix(cls, unledgered, o) : 'remove one copy: gsd-tools capability remove memanto --scope project (or --scope global)';
  const fix = LOAD_ERROR_STATES.has(cls.state) ? `fix the load error first (see loaded); then ${remove}` : remove;
  return rec('duplicate-install', 'warn', `memanto is installed in both global (${g.dir}) and project (${p.dir}) scope; ${keeps}`, fix, o.clean);
}

function gateBundleRecord(cls, o, fix) {
  const strayClause = cls.stray ? `; ${strayText(cls)}` : '';
  if (cls.state === STATES.NONE) {
    // Memanto disabled and nothing installed: nothing should run. Enabled and
    // nothing installed is an error even when no render succeeded, as in loaded.
    if (!cls.enabled && !cls.stray) return rec('gate-bundle', 'ok', 'no memanto copy is installed, so no discuss:pre gate runs', '', o.clean);
    return rec('gate-bundle', 'error', `${notLoadedText(cls)}${strayClause}`, withStrayFirst(cls, fix), o.clean);
  }
  if (cls.state === STATES.UNDETERMINED) {
    const runs = cls.gateRuns ? `${cls.gateRuns}/scripts/gate.cjs` : 'no installed bundle';
    return rec(
      'gate-bundle',
      'error',
      `${notLoadedText(cls)}, so it cannot confirm that the discuss:pre gate (${runs}) runs the copy gsd-core loads${strayClause}`,
      withStrayFirst(cls, fix),
      o.clean,
    );
  }
  if (!LOADED_STATES.has(cls.state)) {
    return rec('gate-bundle', 'error', `${notLoadedText(cls)}${strayClause}`, withStrayFirst(cls, fix), o.clean);
  }
  const l = cls.loaded;
  if (!cls.gateRuns) {
    // While a global capability.json exists the gate never falls back to a
    // project copy, so the global directory is the one in the way.
    const blocker = cls.copies.find((c) => c.scope === 'global') || cls.copies.find((c) => c.scope === l.scope);
    let collides = '';
    if (l.scope === 'global' && cls.copies.some((c) => c.scope === 'project')) {
      collides = cls.classes.includes(REASON_CLASSES.COLLISION)
        ? ' (a global capability.json exists, so gsd-core skips the project copy with the same id as colliding)'
        : ' (a global capability.json exists, and gsd-core scans the global copy first)';
    }
    return rec(
      'gate-bundle',
      'error',
      `gsd-core loads memanto from ${l.dir}${collides}, but the discuss:pre gate finds no installed bundle to run (capability.json plus a committed ledger entry): ` +
        `${blocker.dir} has no committed ${blocker.scope} ledger entry` +
        (blocker.scope === 'global' ? ', and the gate never falls back to a project copy while a global capability.json exists' : '') +
        '; it blocks every run' +
        (cls.stray && cls.stray.dir !== blocker.dir ? strayClause : ''),
      withStrayFirst(cls, deleteFix(cls, blocker, o)),
      o.clean,
    );
  }
  if (path.resolve(cls.gateRuns) !== path.resolve(l.dir)) {
    const skipped = other(l.scope);
    const why = cls.reasons.length ? ` (gsd-core skipped the ${skipped} copy: ${describeReasons(cls.reasons)})` : '';
    const keep = cls.copies.find((c) => c.scope === l.scope && c.installed);
    const cure = isClash(cls)
      ? 'remove or fix the other capability that owns the memanto key (see the render checks); reinstalling memanto does not clear it'
      : `fix the load error the loaded, engines and render checks report, or replace it: gsd-tools capability install npm:@taoc/gsd-memanto@${o.version} --yes${skipped === 'project' ? ' --scope project' : ''}`;
    return rec(
      'gate-bundle',
      'error',
      `the discuss:pre gate would run ${cls.gateRuns}/scripts/gate.cjs, but gsd-core loads the bundle at ${l.dir}${why}${strayClause}`,
      withStrayFirst(cls, `gsd-core did not load the installed ${skipped} bundle at ${cls.gateRuns}: ${cure}${keep ? `; keep the installed ${keep.scope} bundle at ${keep.dir}` : ''}`),
      o.clean,
    );
  }
  if (cls.stray) {
    const keep = cls.copies.find((c) => c.scope === l.scope && c.installed);
    return rec(
      'gate-bundle',
      'error',
      strayText(cls),
      withStrayFirst(cls, keep ? `keep the installed ${keep.scope} bundle at ${keep.dir}` : o.reinstall),
      o.clean,
    );
  }
  return rec('gate-bundle', 'ok', 'the discuss:pre gate runs the installed bundle gsd-core loads', '', o.clean);
}

// The render:<point> fix for a no-hook render: an ownership clash is not
// cleared by a reinstall, every other reason is.
function renderFix(reason, reinstall) {
  if (reason && reasonClass(reason) === REASON_CLASSES.CLASH) {
    return 'fix the reported load error: another capability owns a memanto key (see loaded); reinstalling memanto does not clear it';
  }
  return `fix the reported load error or ${reinstall}`;
}

module.exports = {
  STATES,
  REASON_CLASSES,
  POST_COLLISION,
  POST_COLLISION_REASONS,
  COLLIDES,
  reasonClass,
  classifyInstall,
  installRecords,
  describeReasons,
  renderFix,
};
