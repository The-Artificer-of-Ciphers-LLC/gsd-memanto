'use strict';
// Round-7/8: ONE classification of the memanto install/load state, and ONE
// message/fix table for the doctor records loaded, consent, duplicate-install
// and gate-bundle. Earlier rounds derived the state separately in each record,
// and every patch to one record made another contradict it.
//
// classifyInstall(evidence) is pure: memanto.cjs gatherEvidence reads the
// evidence once (file checks, ledgers, capability list, render-hooks), and this
// module only reasons over it. installRecords(cls, opts) builds the four
// records from the classification alone.
//
// Round-8 CR-01: a copy counts as loaded only with POSITIVE render evidence (a
// memanto hook rendered), and loaded / gate-bundle are ok only when the memanto
// gate itself rendered at discuss:pre. Ledger rows and the loader's precedence
// alone are never enough: they are reported as a hedged prediction.
//
// Loader facts this relies on (gsd-core capability-loader.cjs 1.20.1 and
// 1.22.0; test/loader-drift.test.cjs reads the installed loader and fails when
// they change):
//   - overlayRoots scans the global root before the project root;
//   - when GSD_HOME is (an alias of) a genuine project root, overlayRoots
//     demotes the global root to consent-required project scope;
//   - the id is claimed (acceptedIds.add) only once a copy passes every check;
//   - a copy whose id is already claimed is skipped with "id collides ...",
//     so that reason proves gsd-core ACCEPTED the global copy; the warning is
//     printed for every skipped copy that declares a gate at the point;
//   - the POST_COLLISION_REASONS are given only after the collision check, so
//     while an accepted global copy holds the id a project copy never gets one:
//     such a reason names the global copy;
//   - a project copy is activated only with a committed ledger entry and a
//     user consent record; otherwise it is ignored without a warning. A copy
//     with an unreadable manifest, or one that declares no gate, is also
//     skipped without a printed reason.

const path = require('node:path');

const STATES = Object.freeze({
  NONE: 'none-installed', // no capability.json in either scope
  GLOBAL_LOADED: 'global-loaded', // the global copy loaded and its gate renders at discuss:pre
  PROJECT_LOADED: 'project-loaded',
  GLOBAL_NO_GATE: 'global-loaded-no-gate', // gsd-core accepted the global copy, but no memanto gate renders at discuss:pre
  PROJECT_NO_GATE: 'project-loaded-no-gate',
  UNDETERMINED: 'undetermined', // two copies, a hook rendered, doctor cannot tell which copy it came from
  GLOBAL_SKIPPED: 'global-skipped', // the only copy, skipped with a reason
  PROJECT_SKIPPED: 'project-skipped',
  BOTH_SKIPPED: 'both-skipped', // two distinct copies, neither loaded
  BROKEN: 'broken-install', // committed ledger entry, unreadable capability.json
  PENDING: 'install-pending', // ledger entry with an _pending intent
  PROJECT_INACTIVE: 'project-not-activated', // project copy with no ledger entry or no consent record
  UNEXPLAINED: 'no-gate-unexplained', // a copy is on disk, nothing renders, no reason is given
  UNVERIFIED: 'no-render-evidence', // memanto is enabled but no render-hooks call succeeded
  DISABLED: 'disabled-not-checked', // memanto.enabled is not true, so doctor rendered nothing
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

// evidence = {
//   dirs: { global, project },            the two scope bundle directories
//   sameDir: bool,                        both are one physical directory (realpath-equal; memanto.cjs)
//   demoted: bool,                        gsd-core demotes the global root to project scope
//                                         (GSD_HOME is a genuine project root); default true when sameDir
//   manifest: { global, project },        capability.json exists there (in any form)
//   manifestOk: { global, project },      capability.json is readable with id memanto
//   declaresGate: { global, project },    that manifest declares a discuss:pre gate
//   gateFile: { global, project },        scripts/gate.cjs is a regular file there
//   ledger: { global, project },          'committed' | 'pending' | 'none'
//   gateRuns: 'global'|'project'|null,    the scope whose bundle the discuss:pre predicate runs (a directory is accepted too)
//   rows: [capability list rows] | null,  null when capability list could not be read
//   render: { ran, hook, gate, mismatch },ran: at least one render-hooks call succeeded;
//                                         hook: a memanto hook rendered at some point;
//                                         gate: the shipped memanto gate rendered at discuss:pre;
//                                         mismatch: 'command, blocking, ...' when a memanto gate
//                                         rendered there but differs from the shipped gate
//   reasons: [string],                    the loader's "failed to load (<reason>)" texts, one per skipped copy
//   enabled: bool,                        memanto.enabled as doctor reads it (default true: fail closed)
// }
function classifyInstall(evidence) {
  const ev = evidence || {};
  const dirs = { global: (ev.dirs && ev.dirs.global) || '', project: (ev.dirs && ev.dirs.project) || '' };
  const flag = (obj, scope) => Boolean(obj && obj[scope]);
  const sameDir = ev.sameDir !== undefined ? Boolean(ev.sameDir) : Boolean(dirs.global && path.resolve(dirs.global) === path.resolve(dirs.project));
  const sameScope = ev.demoted === false ? 'global' : 'project';
  const rowsKnown = Array.isArray(ev.rows);
  const rows = rowsKnown ? ev.rows.filter((r) => r && (r.id === undefined || r.id === 'memanto')) : [];
  const reasons = Array.isArray(ev.reasons) ? ev.reasons.map(String) : [];
  const classes = reasons.map(reasonClass);
  const render = {
    ran: Boolean(ev.render && ev.render.ran),
    hook: Boolean(ev.render && (ev.render.hook || ev.render.gate)),
    gate: Boolean(ev.render && ev.render.gate),
    // Round-9 WR-01: the fields in which the memanto gate that rendered at
    // discuss:pre differs from the shipped gate (render.gate is then false).
    mismatch: ev.render && !ev.render.gate && typeof ev.render.mismatch === 'string' && ev.render.mismatch ? ev.render.mismatch : null,
  };
  const enabled = ev.enabled !== false;
  const ledgerOf = (s) => {
    const v = ev.ledger && ev.ledger[s];
    return v === 'committed' || v === 'pending' ? v : 'none';
  };

  const any = (obj) => flag(obj, 'global') || flag(obj, 'project');
  const mk = (scope, pick) => {
    const ledger = pick((s) => ledgerOf(s), (a, b) => (a !== 'none' ? a : b));
    const manifestOk = pick((s) => flag(ev.manifestOk, s), (a, b) => a || b);
    return {
      scope,
      dir: dirs[scope],
      ledger,
      ledgered: ledger !== 'none',
      manifestOk,
      installed: ledger === 'committed' && manifestOk,
      broken: ledger === 'committed' && !manifestOk,
      pending: ledger === 'pending',
      declaresGate: pick((s) => flag(ev.declaresGate, s), (a, b) => a || b),
      gateFile: pick((s) => flag(ev.gateFile, s), (a, b) => a || b),
      row: sameDir ? rows.find((r) => r.scope === scope) || rows[0] || null : rows.find((r) => r.scope === scope) || null,
    };
  };
  let copies;
  if (sameDir) {
    // One physical directory: one copy, in the scope gsd-core gives it.
    const both = (f, join) => join(f('global'), f('project'));
    copies = any(ev.manifest) ? [mk(sameScope, both)] : [];
  } else {
    copies = SCOPES.filter((s) => flag(ev.manifest, s)).map((s) => mk(s, (f) => f(s)));
  }
  const copy = (s) => copies.find((c) => c.scope === s) || null;
  const g = copy('global');
  const p = copy('project');
  // A project copy is activated only with a ledger entry and consent; without
  // capability list, an installed bundle stands in for the row.
  const projectActive = Boolean(p && (rowsKnown ? p.row && p.row.status === 'active' : p.installed));
  const globalOut = Boolean(g && ((g.row && g.row.status !== 'active') || g.broken || g.pending));

  // The loader's precedence, used only as a hedged prediction (no render).
  const predict = () => {
    if (g && !globalOut) return g;
    if (p && projectActive && !p.broken && !p.pending) return p;
    return null;
  };

  let state;
  let loaded = null;
  let subject = null; // the copy a not-loaded message is about
  let predicted = null;
  if (copies.length === 0) {
    state = STATES.NONE;
  } else if (!enabled) {
    state = STATES.DISABLED;
    predicted = predict();
  } else if (!render.hook && copies.some((c) => c.pending)) {
    state = STATES.PENDING;
    subject = copies.find((c) => c.pending);
  } else if (!render.hook && copies.some((c) => c.broken)) {
    state = STATES.BROKEN;
    subject = copies.find((c) => c.broken);
  } else if (!render.ran) {
    state = STATES.UNVERIFIED;
    predicted = predict();
  } else if (!render.hook) {
    if (g && classes.includes(REASON_CLASSES.COLLISION)) {
      state = STATES.GLOBAL_NO_GATE;
      loaded = g;
    } else if (reasons.length) {
      state = copies.length === 2 ? STATES.BOTH_SKIPPED : `${copies[0].scope}-skipped`;
      subject = copies.length === 1 ? copies[0] : null;
    } else if (p && !projectActive && !g) {
      state = STATES.PROJECT_INACTIVE;
      subject = p;
    } else {
      // No reason and no hook is a silent skip or a manifest without the gate:
      // never "loaded".
      state = STATES.UNEXPLAINED;
      subject = g || p;
    }
  } else {
    // A memanto hook rendered, so exactly one copy loaded. Which one:
    let scope;
    if (copies.length === 1) scope = copies[0].scope;
    else if (classes.includes(REASON_CLASSES.COLLISION)) scope = 'global';
    else if (globalOut || reasons.some((r) => POST_COLLISION.test(r))) scope = 'project';
    else if (reasons.length === 0) {
      // An accepted global copy makes an activated project copy that declares
      // the gate print "id collides" at discuss:pre. No such warning: the
      // global copy was not accepted.
      if (!projectActive) scope = 'global';
      else if (p.declaresGate) scope = 'project';
      else scope = null;
    } else scope = null;
    if (!scope) state = STATES.UNDETERMINED;
    else {
      loaded = copy(scope);
      if (scope === 'global') state = render.gate ? STATES.GLOBAL_LOADED : STATES.GLOBAL_NO_GATE;
      else state = render.gate ? STATES.PROJECT_LOADED : STATES.PROJECT_NO_GATE;
    }
  }

  // Gate code in a directory that no ledger lists (stray or planted). A
  // ledgered copy with a broken manifest is a broken install, not stray code.
  let stray = null;
  if (sameDir) {
    const c = copies[0];
    const hasGate = flag(ev.gateFile, 'global') || flag(ev.gateFile, 'project');
    const ledgered = ledgerOf('global') !== 'none' || ledgerOf('project') !== 'none';
    if (hasGate && !ledgered) stray = { scope: c ? c.scope : sameScope, dir: dirs[c ? c.scope : sameScope] };
  } else {
    for (const s of SCOPES) {
      if (flag(ev.gateFile, s) && ledgerOf(s) === 'none') {
        stray = { scope: s, dir: dirs[s] };
        break;
      }
    }
  }

  let gateRuns = null;
  if (ev.gateRuns === 'global' || ev.gateRuns === 'project') gateRuns = sameDir && copies[0] ? copies[0].dir : dirs[ev.gateRuns];
  else if (typeof ev.gateRuns === 'string' && ev.gateRuns) gateRuns = ev.gateRuns;

  return {
    state,
    loaded: loaded ? { scope: loaded.scope, dir: loaded.dir } : null,
    predicted: predicted ? { scope: predicted.scope, dir: predicted.dir } : null,
    subject,
    stray,
    copies,
    sameDir,
    rowsKnown,
    rows,
    render,
    reasons,
    classes,
    gateRuns,
    dirs,
    enabled,
  };
}

// ---------------------------------------------------------------------------
// The message/fix table. Every record below is a function of the
// classification only, and every fix comes from the same few builders, so the
// records cannot disagree about which copy loads or what clears the error.

const LOADED_STATES = new Set([STATES.GLOBAL_LOADED, STATES.PROJECT_LOADED]);
const NO_GATE_STATES = new Set([STATES.GLOBAL_NO_GATE, STATES.PROJECT_NO_GATE]);
const LOAD_ERROR_STATES = new Set([
  STATES.GLOBAL_SKIPPED,
  STATES.PROJECT_SKIPPED,
  STATES.BOTH_SKIPPED,
  STATES.UNEXPLAINED,
  STATES.UNDETERMINED,
  STATES.BROKEN,
  STATES.PENDING,
  STATES.UNVERIFIED,
]);

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
const isConsent = (row) => Boolean(row && row.status !== 'active' && /consent/i.test(String(row.reason || '')));

function installCmd(o, scope) {
  return `gsd-tools capability install npm:@taoc/gsd-memanto@${o.version} --yes${scope === 'project' ? ' --scope project' : ''}`;
}

function clashed(cls, fix) {
  return isClash(cls) ? `${fix}; ${CLASH_NOTE}` : fix;
}

// A ledgered copy whose capability.json is unreadable or not id memanto.
function brokenFix(cls, c, o) {
  return clashed(cls, `reinstall the ${c.scope} copy in place (its capability.json is unreadable or not id memanto): ${installCmd(o, c.scope)}`);
}

// A ledger entry with an _pending intent.
function pendingFix(cls, c, o) {
  return clashed(
    cls,
    `finish or roll back the interrupted ${c.scope} install of memanto: rerun ${installCmd(o, c.scope)}, or roll it back with gsd-tools capability remove memanto${c.scope === 'project' ? ' --scope project' : ''}`,
  );
}

// Remove a copy that is in the way. A copy with any ledger entry is never
// deleted by hand: it is reinstalled in place (or its pending install
// finished). Only a copy that no ledger lists is deleted by hand.
function deleteFix(cls, c, o) {
  if (c.pending) return pendingFix(cls, c, o);
  if (c.ledgered) return clashed(cls, `reinstall the ${c.scope} copy at ${c.dir} in place: ${installCmd(o, c.scope)}`);
  const head = `delete ${c.dir} by hand (no ${c.scope} ledger entry lists it, so gsd-tools capability remove cannot remove it)`;
  if (isClash(cls)) return `${head}; ${CLASH_NOTE}`;
  const keep = cls.copies.find((x) => x.scope !== c.scope && x.installed);
  return keep ? `${head}; keep the installed ${keep.scope} bundle at ${keep.dir}` : `${head}, then ${o.reinstall}`;
}

function consentFix(cls, o) {
  return clashed(cls, `re-consent by reinstalling in the project: ${installCmd(o, 'project')}`);
}

function reasonFix(cls, o) {
  const reinstall = `fix the load error the loaded, engines and render checks report, or ${o.reinstall}`;
  if (cls.classes.length && cls.classes.every((c) => c === REASON_CLASSES.CLASH)) return CLASH_FIX;
  if (isClash(cls)) {
    return `${reinstall}; a reinstall does not clear the ownership clash, so also remove or fix the other capability that owns the memanto key`;
  }
  return reinstall;
}

// The one fix for the load state, used by loaded and (after any stray-code
// deletion) by gate-bundle.
function primaryFix(cls, o) {
  const s = cls.subject;
  switch (cls.state) {
    case STATES.NONE:
      return o.reinstall;
    case STATES.GLOBAL_LOADED:
    case STATES.PROJECT_LOADED:
      return '';
    case STATES.GLOBAL_NO_GATE:
    case STATES.PROJECT_NO_GATE: {
      const c = cls.copies.find((x) => x.scope === cls.loaded.scope);
      if (!c.ledgered) return deleteFix(cls, c, o);
      if (cls.render.mismatch) {
        return `reinstall the ${c.scope} copy at ${c.dir} in place at this release (its discuss:pre gate does not match this release: ${cls.render.mismatch}): ${installCmd(o, c.scope)}`;
      }
      return (
        `the ${c.scope} copy at ${c.dir} renders no memanto gate at discuss:pre${c.declaresGate ? '' : ' (its capability.json declares none)'}: ` +
        `check that gsd-core reads memanto.enabled as true for this project, or reinstall it in place: ${installCmd(o, c.scope)}`
      );
    }
    case STATES.UNDETERMINED:
      return 'fix the load error the render checks report, or remove one of the two copies, then run doctor again';
    case STATES.GLOBAL_SKIPPED:
    case STATES.PROJECT_SKIPPED:
    case STATES.BOTH_SKIPPED:
      return reasonFix(cls, o);
    case STATES.BROKEN:
      return brokenFix(cls, s, o);
    case STATES.PENDING:
      return pendingFix(cls, s, o);
    case STATES.PROJECT_INACTIVE:
      if (isConsent(s.row)) return consentFix(cls, o);
      if (cls.rowsKnown && !s.row) return deleteFix(cls, s, o);
      return `fix the error capability list reports for the project copy, or ${installCmd(o, 'project')}`;
    case STATES.UNEXPLAINED:
      if (s && isConsent(s.row)) return consentFix(cls, o);
      if (s && !s.ledgered) return deleteFix(cls, s, o);
      if (s && s.manifestOk && !s.declaresGate) return `its capability.json declares no discuss:pre gate: reinstall the ${s.scope} copy in place: ${installCmd(o, s.scope)}`;
      return `check that gsd-core reads memanto.enabled as true for this project and fix any error the render checks report, or reinstall the ${s ? s.scope : 'memanto'} copy in place: ${installCmd(o, s ? s.scope : 'global')}`;
    case STATES.UNVERIFIED:
      return 'fix the errors the capability-list and render checks report, then run doctor again';
    case STATES.DISABLED:
    default:
      return 'set "memanto": {"enabled": true} in .planning/config.json, then run doctor again to check the gate';
  }
}

// A not-loaded fix also re-consents when capability list reports a copy with
// no consent record: nothing else activates it.
function withConsent(cls, o, fix) {
  if (LOADED_STATES.has(cls.state) || !cls.rows.some((r) => isConsent(r)) || /re-consent/.test(fix)) return fix;
  return fix ? `${fix}; then ${consentFix(cls, o)}` : consentFix(cls, o);
}

const hedge = (cls) => (cls.predicted ? `by the loader's precedence gsd-core would load the ${cls.predicted.scope} copy at ${cls.predicted.dir}` : 'by the loader\'s precedence gsd-core would load no memanto copy');

// The one sentence for a state in which no memanto gate runs.
function notLoadedText(cls) {
  const [g, p] = [cls.copies.find((c) => c.scope === 'global'), cls.copies.find((c) => c.scope === 'project')];
  const s = cls.subject;
  const why = cls.reasons.length ? ` (${describeReasons(cls.reasons)})` : '';
  const tail = '; no memanto gate renders at discuss:pre, so it is not enforced (fails open)';
  const rowWhy = (c) => (c && c.row && c.row.status !== 'active' ? ` (capability list: ${describeRow(c.row)})` : '');
  switch (cls.state) {
    case STATES.BOTH_SKIPPED:
      return `gsd-core loaded neither memanto copy (global at ${g.dir}, project at ${p.dir})${why || rowWhy(g)}${tail}`;
    case STATES.GLOBAL_SKIPPED:
    case STATES.PROJECT_SKIPPED:
      return `gsd-core did not load the ${s.scope} memanto copy at ${s.dir}${why || rowWhy(s)}${tail}`;
    case STATES.GLOBAL_NO_GATE:
    case STATES.PROJECT_NO_GATE: {
      const l = cls.loaded;
      const collided = cls.classes.includes(REASON_CLASSES.COLLISION)
        ? ' (it holds the id, so gsd-core skipped the project copy: id collides with an already-registered capability)'
        : '';
      const what = cls.render.mismatch
        ? `the installed memanto gate at discuss:pre does not match this release: ${cls.render.mismatch}`
        : 'it renders no memanto gate at discuss:pre';
      return `gsd-core loaded the ${l.scope} memanto copy at ${l.dir}, but ${what}${collided}; it is not enforced (fails open)`;
    }
    case STATES.BROKEN:
      return `the ${s.scope} memanto install at ${s.dir} is broken: its ledger entry is committed but its capability.json is unreadable or not id memanto, so gsd-core skips it${tail}`;
    case STATES.PENDING:
      return `the ${s.scope} memanto install at ${s.dir} is unfinished: its ledger entry is _pending (an interrupted install or upgrade), so gsd-core does not load it${tail}`;
    case STATES.PROJECT_INACTIVE: {
      const whyNot = s.row ? ` (capability list: ${describeRow(s.row)})` : ' (no project capability ledger lists it; copied by hand?)';
      return `gsd-core does not activate the project memanto copy at ${s.dir}${whyNot}${tail}`;
    }
    case STATES.UNEXPLAINED: {
      const declares = s.manifestOk && !s.declaresGate ? ' (its capability.json declares no discuss:pre gate)' : '';
      return `no memanto gate renders at discuss:pre from the ${s.scope} copy at ${s.dir}, and gsd-core printed no load error${declares}${rowWhy(s)}; it is not enforced (fails open)`;
    }
    case STATES.UNDETERMINED:
      return (
        `gsd-core skipped a memanto copy (${describeReasons(cls.reasons) || 'no reason printed'}); doctor cannot tell whether it skipped ` +
        `the global copy at ${cls.dirs.global} or the project copy at ${cls.dirs.project}`
      );
    case STATES.UNVERIFIED:
      return `no render-hooks call succeeded, so doctor cannot confirm that a memanto gate renders at discuss:pre; ${hedge(cls)}`;
    case STATES.DISABLED:
      return `memanto is disabled for this project, so doctor rendered no hooks and did not check the discuss:pre gate; ${hedge(cls)}`;
    case STATES.NONE:
    default:
      return `no memanto copy is installed (no capability.json in ${cls.dirs.global} or ${cls.dirs.project})${cls.enabled ? tail : ''}`;
  }
}

function strayText(cls) {
  return (
    `${cls.stray.dir} holds scripts/gate.cjs but no ${cls.stray.scope} ledger entry lists a memanto install there; ` +
    'stray or planted gate code that the gate never runs'
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
  const fix = withConsent(cls, o, primaryFix(cls, o));
  return {
    loaded: loadedRecord(cls, o, fix),
    consent: consentRecord(cls, o),
    duplicate: duplicateRecord(cls, o),
    gateBundle: gateBundleRecord(cls, o, fix),
  };
}

function loadedRecord(cls, o, fix) {
  const active = cls.rows.filter((r) => r.status === 'active');
  // Round-9 IN-01: doctor prints loaded when memanto is disabled too, as a warn.
  if (!cls.enabled) {
    const what = cls.state === STATES.NONE ? 'no memanto copy is installed' : `doctor rendered no hooks; ${hedge(cls)}`;
    const enable = 'set "memanto": {"enabled": true} in .planning/config.json, then run doctor again to check the gate';
    return rec('loaded', 'warn', `memanto.enabled is not true, so gsd-core loads no memanto hook (${what})`, cls.state === STATES.NONE ? `${o.reinstall}; then ${enable}` : fix, o.clean);
  }
  if (LOADED_STATES.has(cls.state)) {
    const l = cls.loaded;
    const own = active.find((r) => r.scope === l.scope);
    if (own && active.length === 1) return rec('loaded', 'ok', `memanto ${own.version || ''} is active in ${l.scope} scope and its gate renders at discuss:pre`.replace('  ', ' '), '', o.clean);
    if (active.length) {
      const a = active[0];
      const base = `memanto ${a.version || ''} is active in ${a.scope} scope`.replace('  ', ' ');
      return rec('loaded', 'ok', `${base} per capability list; gsd-core loads the ${l.scope} copy at ${l.dir} (see gate-bundle)`, '', o.clean);
    }
    const c = cls.copies.find((x) => x.scope === l.scope);
    if (!cls.rowsKnown) {
      return rec('loaded', 'warn', `gsd-core loads the ${l.scope} copy at ${l.dir}, but capability list could not be read`, 'fix the error capability-list reports, then run doctor again', o.clean);
    }
    return rec(
      'loaded',
      'warn',
      `gsd-core loads the ${l.scope} memanto copy at ${l.dir}, but no ${l.scope} capability ledger lists it (see consent and gate-bundle)`,
      withConsent(cls, o, withStrayFirst(cls, deleteFix(cls, c, o))),
      o.clean,
    );
  }
  if (cls.state === STATES.NONE) {
    const message = cls.rows.length
      ? `memanto.enabled is true but memanto is ${cls.rows.map(describeRow).join('; ')} and no capability.json is on disk; its gate does not run (fails open)`
      : 'memanto.enabled is true but capability list has no memanto row (not installed or not in a ledger); its gate does not run (fails open)';
    return rec('loaded', 'error', message, fix, o.clean);
  }
  if (cls.state === STATES.DISABLED) return rec('loaded', 'warn', notLoadedText(cls), fix, o.clean);
  const joiner = NO_GATE_STATES.has(cls.state) ? '; ' : ', but ';
  const list =
    active.length && !cls.sameDir && ![STATES.UNDETERMINED, STATES.UNVERIFIED].includes(cls.state)
      ? `capability list shows memanto active in ${active.map((r) => r.scope).join(' and ')} scope${joiner}`
      : '';
  return rec('loaded', 'error', `${list}${notLoadedText(cls)}`, fix, o.clean);
}

function consentRecord(cls, o) {
  if (!cls.rowsKnown) {
    return rec('consent', 'warn', 'capability list could not be read, so consent and ledger entries were not checked', 'fix the error capability-list reports, then run doctor again', o.clean);
  }
  const unconsented = cls.rows.find((r) => isConsent(r));
  if (unconsented) {
    return rec('consent', 'error', `memanto in ${unconsented.scope} scope has no user consent record: ${unconsented.reason}`, consentFix(cls, o), o.clean);
  }
  for (const c of cls.copies) {
    if (c.row) continue;
    if (c.ledgered) {
      return rec(
        'consent',
        'error',
        `the ${c.scope} ledger lists memanto at ${c.dir}, but capability list shows no ${c.scope} row for it`,
        c.pending ? pendingFix(cls, c, o) : brokenFix(cls, c, o),
        o.clean,
      );
    }
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
  const neither = 'gsd-core loaded neither of them (see loaded)';
  const noGate = cls.render.mismatch ? `whose discuss:pre gate does not match this release (${cls.render.mismatch})` : 'which renders no memanto gate';
  const keeps =
    {
      [STATES.GLOBAL_LOADED]: 'gsd-core keeps the global one and skips the project one',
      [STATES.PROJECT_LOADED]: 'gsd-core skipped the global one and loads the project one (see gate-bundle)',
      [STATES.GLOBAL_NO_GATE]: `gsd-core keeps the global one, ${noGate}, and skips the project one (see loaded)`,
      [STATES.PROJECT_NO_GATE]: `gsd-core skipped the global one and loads the project one, ${noGate} (see loaded)`,
      [STATES.BOTH_SKIPPED]: neither,
      [STATES.UNEXPLAINED]: neither,
      [STATES.BROKEN]: neither,
      [STATES.PENDING]: neither,
    }[cls.state] ||
    (cls.predicted ? `${hedge(cls)} (see gate-bundle)` : 'gsd-core loads at most one of them (see loaded and gate-bundle)');
  const unledgered = cls.copies.find((c) => !c.ledgered);
  let fix;
  if (NO_GATE_STATES.has(cls.state)) {
    // Round-9 WR-03: the copy gsd-core loaded renders no shipped gate, so that
    // copy is the cure. The other copy may be the only healthy install: keep it.
    const l = cls.copies.find((c) => c.scope === cls.loaded.scope);
    const other = cls.copies.find((c) => c.scope !== l.scope);
    fix = l.ledgered
      ? `fix the load error first (see loaded): ${primaryFix(cls, o)}; keep the ${other.scope} copy at ${other.dir} until the ${l.scope} copy renders the shipped gate`
      : primaryFix(cls, o);
  } else {
    const remove = unledgered ? deleteFix(cls, unledgered, o) : 'remove one copy: gsd-tools capability remove memanto --scope project (or --scope global)';
    fix = LOAD_ERROR_STATES.has(cls.state) ? `fix the load error first (see loaded); then ${remove}` : remove;
  }
  return rec('duplicate-install', 'warn', `memanto is installed in both global (${g.dir}) and project (${p.dir}) scope; ${keeps}`, fix, o.clean);
}

function gateBundleRecord(cls, o, fix) {
  const strayClause = cls.stray ? `; ${strayText(cls)}` : '';
  // The copy gate-bundle compares the gate against: the one that loaded, or
  // (no render) the loader's predicted one.
  const l = cls.loaded || cls.predicted;
  const hedged = !cls.loaded;
  const loads = hedged ? 'by the loader\'s precedence gsd-core would load memanto from' : 'gsd-core loads memanto from';

  if (cls.state === STATES.NONE) {
    if (!cls.enabled && !cls.stray) return rec('gate-bundle', 'warn', 'memanto is disabled and no memanto copy is installed, so no discuss:pre gate runs', fix, o.clean);
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
  // Mismatch checks apply to a loaded copy, or to the prediction when doctor
  // has no render evidence (memanto disabled, or no render succeeded).
  const compare = LOADED_STATES.has(cls.state) || cls.state === STATES.DISABLED || cls.state === STATES.UNVERIFIED;
  if (compare && l && !cls.gateRuns) {
    // While a global capability.json exists the gate never falls back to a
    // project copy, so the global directory is the one in the way.
    const blocker = cls.copies.find((c) => c.scope === 'global') || cls.copies.find((c) => c.scope === l.scope);
    let collides = '';
    if (l.scope === 'global' && cls.copies.some((c) => c.scope === 'project')) {
      collides = cls.classes.includes(REASON_CLASSES.COLLISION)
        ? ' (a global capability.json exists, so gsd-core skips the project copy with the same id as colliding)'
        : ' (a global capability.json exists, and gsd-core scans the global copy first)';
    }
    const ledgerText = blocker.ledgered ? `is not an installed bundle (${blocker.pending ? 'its ledger entry is _pending' : 'its capability.json is unreadable or not id memanto'})` : `has no ${blocker.scope} ledger entry`;
    return rec(
      'gate-bundle',
      'error',
      `${loads} ${l.dir}${collides}, but the discuss:pre gate finds no installed bundle to run (capability.json plus a committed ledger entry): ` +
        `${blocker.dir} ${ledgerText}` +
        (blocker.scope === 'global' && cls.copies.some((c) => c.scope === 'project')
          ? ', and the gate never falls back to a project copy while a global capability.json exists'
          : '') +
        '; it blocks every run' +
        (cls.stray && cls.stray.dir !== blocker.dir ? strayClause : '') +
        (hedged ? `; ${notLoadedText(cls)}` : ''),
      withStrayFirst(cls, deleteFix(cls, blocker, o)),
      o.clean,
    );
  }
  if (compare && l && path.resolve(cls.gateRuns) !== path.resolve(l.dir)) {
    const skipped = l.scope === 'global' ? 'project' : 'global';
    const why = cls.reasons.length ? ` (gsd-core skipped the ${skipped} copy: ${describeReasons(cls.reasons)})` : '';
    const keep = cls.copies.find((c) => c.scope === l.scope && c.installed);
    const cure = isClash(cls)
      ? 'remove or fix the other capability that owns the memanto key (see the render checks); reinstalling memanto does not clear it'
      : `fix the load error the loaded, engines and render checks report, or replace it: ${installCmd(o, skipped)}`;
    return rec(
      'gate-bundle',
      'error',
      `the discuss:pre gate would run ${cls.gateRuns}/scripts/gate.cjs, but ${hedged ? "by the loader's precedence gsd-core would load" : 'gsd-core loads'} the bundle at ${l.dir}${why}${strayClause}`,
      withStrayFirst(cls, `gsd-core did not load the installed ${skipped} bundle at ${cls.gateRuns}: ${cure}${keep ? `; keep the installed ${keep.scope} bundle at ${keep.dir}` : ''}`),
      o.clean,
    );
  }
  if (cls.stray) {
    const keep = l && cls.copies.find((c) => c.scope === l.scope && c.installed);
    return rec(
      'gate-bundle',
      'error',
      LOADED_STATES.has(cls.state) ? strayText(cls) : `${notLoadedText(cls)}${strayClause}`,
      withStrayFirst(cls, LOADED_STATES.has(cls.state) ? (keep ? `keep the installed ${keep.scope} bundle at ${keep.dir}` : o.reinstall) : fix),
      o.clean,
    );
  }
  if (cls.state === STATES.DISABLED) return rec('gate-bundle', 'warn', notLoadedText(cls), fix, o.clean);
  if (!LOADED_STATES.has(cls.state)) return rec('gate-bundle', 'error', notLoadedText(cls), fix, o.clean);
  // Positive evidence only: the memanto gate rendered at discuss:pre and the
  // predicate runs the bundle of the copy that rendered it.
  return rec('gate-bundle', 'ok', `the discuss:pre gate renders and runs the installed bundle gsd-core loads (${cls.gateRuns})`, '', o.clean);
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
