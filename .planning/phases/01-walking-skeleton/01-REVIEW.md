---
phase: 01-walking-skeleton
reviewed: 2026-11-22T04:30:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - lib/install-state.cjs
  - memanto.cjs
  - README.md
  - test/install-state.test.cjs
  - test/helpers/install-invariants.cjs
  - test/gate-bundle.test.cjs
  - test/loader-drift.test.cjs
  - test/bundle.test.cjs
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: issues_found
---

# Phase 1: Code Review Report (round 8, re-review of the round-7 classifier refactor)

**Reviewed:** 2026-11-22T04:30:00Z
**Depth:** standard
**Files Reviewed:** 8 (`git diff 493b810^1 493b810 -- . ':!.planning'`, plus `lib/gate-bundle.cjs` read as a callee)
**Status:** issues_found

## Summary

This round re-reviews the round-7 refactor (`4f88076`, merged in `493b810`). `npm test` reports 464 tests: 463 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network targets were the closed local port `127.0.0.1:9`, plus `GET http://localhost:8000/health` for one run (CR-01). The necessity reference was not read this round, so no necessity findings are claimed and the `necessity:` count is left out.

The repro scripts are in `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r8/`:
- `r8.cjs`, with modes `gnogate`, `twonogate` and `twoinvalid`;
- `r8h.cjs`, which is `r8.cjs` pointed at the live `/health`;
- `r8b.cjs`, with modes `homeplain` and `homesym`;
- `r8c.cjs`, with modes `gcorrupt` and `gpending`;
- `mutate.cjs`, the mutation runner over `mut/orig`, which is a `git archive HEAD` export.

`base/` is the `493b810^1` tree, used for comparison.

### Status of the round-7 findings

| Round-7 | Verdict | Evidence |
|---------|---------|----------|
| WR-01 | Fixed | In `r7.cjs strayproj`, `gate-bundle` now names the stray directory and its fix starts with `delete <dir> by hand`. The "did not load" wording is gone. The `strayproj` and `globalplusstray` doctor tests cover this. |
| WR-02 | Fixed | In `collide.cjs`, `loaded` and `gate-bundle` say "gsd-core loaded the global memanto copy …, but it renders no memanto hook". The fix deletes the hand-copied global directory and keeps the project bundle. `CLASH` is now `^owns ` only (`lib/install-state.cjs:70`). |
| IN-01 | Fixed for the reported case; see WR-02 for the cases that are still open | In `r7.cjs homeproj`, `duplicate-install` is `ok` and no record says "neither". Symlink and realpath aliases are still counted as two copies. |
| IN-02 | Fixed | A table row covers the mixed-reason fix. `classifyInstall(undefined)` and `installRecords(cls)` do not throw (`test/install-state.test.cjs:172-178`). |

### The refactor itself

The enum is closed. Every branch of `classifyInstall` (`lib/install-state.cjs:121-144`) assigns a member of `STATES`, and the template states (`${scope}-loaded`/`-skipped`) are all members. However, the enum does not cover all the evidence. `gatherEvidence` (`memanto.cjs:250-266`) does not collect four facts that the loader acts on:
- a ledgered install whose manifest is unreadable;
- the loader's alias demotion of GSD_HOME;
- whether the discuss:pre gate itself rendered (as opposed to any hook);
- silent skips, meaning `warnings.push` entries that never reach `blockedGates`, so render-hooks prints no "failed to load" line for them (`capability-loader.cjs:630, 642, 648, 791`; `loop-resolver.cjs:511-527`).

Each of these lands in a state whose text is wrong: CR-01, WR-01 and WR-02.

Results of mutating the records table (`mutate.cjs`):
- 4 of 5 mutations are caught.
- 2 of those are caught only by per-case `extra` assertions, not by the shared invariants.
- 1 survives: `duplicate-install` saying "loaded neither" while `loaded` says the global copy loaded (WR-03).

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Doctor exits 0 with `loaded ok` and `gate-bundle ok` when the installed manifest declares no gate, so no memanto gate runs anywhere (fail-open)

**File:**
- `memanto.cjs:179-195` (`declaredPoints` trusts the on-disk manifest), `:325-330`, `:258-263`
- `lib/install-state.cjs:137-141` (the no-render branch returns LOADED from the ledger rows), `:472`

**Issue:** `declaredPoints` takes the hook points from the manifest of the active row's scope. The shipped manifest declares one hook only, the discuss:pre gate. If the installed global `capability.json` has `gates: []`, the declared point list is empty. Doctor then renders nothing, writes no `render:*` record, and passes `render.ran = false`. The classifier's "no render evidence" branch then picks `GLOBAL_LOADED` from the ledger rows. As a result:
- `loaded` says ok: "memanto 0.1.0 is active in global scope".
- `gate-bundle` says ok: "the discuss:pre gate runs the installed bundle gsd-core loads".

In fact, no memanto hook renders at discuss:pre.

There is a second variant (`twoinvalid`): the global manifest has `gates: []` and fails validation, next to a consented project install. gsd-core skips the global copy silently (no gate means no `blockedGates`, so no warning) and loads the project copy. That copy's gate runs the global `scripts/gate.cjs`, from a bundle that gsd-core rejected, and `gate-bundle` still says ok.

The base tree (`493b810^1`) behaves the same, so this is not a round-7 regression. It is the fail-open state this round was asked to rule out. Global bundles are not hash-bound, so a stale or edited global manifest is enough to reach it.

**Reproduced:**
- `r8h.cjs gnogate` against the live `/health`: doctor exits 0, no record has status error, and render-hooks shows no memanto hook at discuss:pre.
- `r8.cjs twoinvalid`: `gate-bundle` is ok, while render-hooks shows that the project copy's gate rendered.

**Fix:**
- Always render the points that the doctor's own shipped manifest declares, and at least `discuss:pre`:
  `const points = new Set([...declaredPoints(rows, scopeDirs), ...pointsOf(readJson(OWN_MANIFEST))]);`
- Pass `render.gate` to the classifier: whether a memanto hook of kind `gate` rendered at `discuss:pre`.
- Make `gate-bundle` ok only when `render.gate` is true.
- When `enabled && !render.ran`, return an error: "no render evidence, so doctor cannot confirm the gate runs", not a ledger-based LOADED.
- At `:135`, when the project copy is activated, a hook rendered and no `id collides` reason appeared, classify the state as `PROJECT_LOADED` (or `UNDETERMINED`), not `GLOBAL_LOADED`. Reason: an accepted global copy would make the activated project copy print `id collides` at its gate point.
- Add the `gnogate` and `twoinvalid` cases as doctor tests.

## Warnings

### WR-01: A ledgered install whose manifest is unreadable is called "loaded", "stray or planted gate code", and "not listed by a committed ledger entry", and doctor says to delete it by hand

**File:**
- `lib/gate-bundle.cjs:51-60` (`installed` means a committed ledger entry AND a readable manifest with id `memanto`)
- `memanto.cjs:256`
- `lib/install-state.cjs:110`, `:150-158` (stray), `:204-212` (`deleteFix`), `:124-127`, `:281`

**Issue:** The evidence has no separate "ledgered" bit, so a committed install with a corrupt `capability.json` gets `installed: false`. In `gcorrupt`, the setup is a global install followed by writing `{` to the manifest. The loader skips the copy with a `warnings.push` that never reaches `blockedGates`, so it prints no reason. The state becomes `GLOBAL_NO_HOOKS`. Doctor then reports:
- `loaded`: "gsd-core loaded the global memanto copy … printed no load error". This is false, because gsd-core skipped the copy.
- `loaded` fix: "delete <dir> by hand (no committed global ledger entry lists it, so gsd-tools capability remove cannot remove it)". This is false too: the ledger lists the copy, and `capability list` shows it as active.
- `gate-bundle`: calls the install "stray or planted gate code".
- `consent`: ok, "every memanto bundle on disk is in a capability ledger".

So the records contradict each other, and the delete fix leaves the ledger entry orphaned. The `_pending` case (`gpending`) gets the same delete fix for an upgrade that is still in progress. The invariant "never delete an installed bundle" cannot catch this, because it takes `installedDirs` from the same conflated bit.

**Reproduced:** `r8c.cjs gcorrupt` and `r8c.cjs gpending`. Doctor exits 1 in both.

**Fix:**
- Gather `ledgered: {global, project}` (committed entry only) separately from `installed`.
- Base `deleteFix`, `stray` and the "no committed ledger entry" text on `ledgered`.
- For a ledgered copy that is not installed: "its capability.json is unreadable or not id memanto: reinstall it in place (gsd-tools capability install … [--scope project])".
- For a `_pending` entry: "finish or roll back the interrupted install".
- Never describe a copy with a silent skip as "loaded". When the only evidence is "no reason and no hook", use the existing unexplained wording for the global scope too.

### WR-02: The project root at GSD_HOME is still modelled as a trusted global copy, so the fix does not cure the problem and the records contradict each other; symlink aliases are counted as two copies

**File:**
- `lib/install-state.cjs:96` (`path.resolve`, not realpath), `:103-111`, `:246-251`, `:277-281`
- loader `~/.claude/gsd-core/bin/lib/capability-loader.cjs:259-290`

**Issue:** When GSD_HOME is the project root (or an alias of it), gsd-core 1.20.1 demotes the global root to the consent-required `project` scope. The classifier instead assumes that the loader "scans it as the global root first". Two cases follow:
- **`homeplain`** (the project at GSD_HOME, a plain global install, no consent). `loaded` and `gate-bundle` say "gsd-core loaded the global memanto copy …, but it renders no memanto hook and gsd-core printed no load error". Their fix is "check memanto.enabled … or reinstall it: … --yes", a global reinstall, which records no consent and does not fix this. At the same time, `consent` says "re-consent … --scope project", which is the actual cure. The invariants do not catch the disagreement.
- **`homesym`** (GSD_HOME is a symlink to the project root). `duplicate-install` warns "installed in both global (…/r8sym-…) and project (…) scope; gsd-core keeps the global one … and skips the project one". This is one physical directory, and the loader deduplicates it. Round-7 IN-01 is therefore fixed only for paths that are textually equal.

**Reproduced:** `r8b.cjs homeplain` and `r8b.cjs homesym`. Doctor exits 1 in both.

**Fix:**
- Compare paths with `fs.realpathSync` (and treat a realpath failure as an alias, as the loader does).
- In the same-directory case, model the single copy as project scope, which needs consent. Then `PROJECT_INACTIVE` and `consentFix` apply, and `loaded`/`gate-bundle` give the same re-consent fix as `consent`.
- Add the drift-test check that `overlayRoots` still demotes the global root on an alias.

### WR-03: The invariants are fed facts that come from the classifier itself, and a cross-record contradiction about which copy loaded survives mutation

**File:**
- `test/install-state.test.cjs:156-161` (`stray`, `installedDirs` and `loaded` are read from `cls`)
- `test/gate-bundle.test.cjs:387-395` (the doctor-level facts have no `loaded`, and each test picks `stray` by hand)
- `test/helpers/install-invariants.cjs:57-63`

**Issue:** In the table test, `facts.loaded = Boolean(cls.loaded)`, so the invariant "nothing claims a load when no copy loaded" checks the classifier against itself. It could not catch WR-01's false "loaded" claim. In the doctor tests, `loaded` is never passed, so that invariant never runs there.

No invariant checks that `loaded`, `duplicate-install` and `gate-bundle` name the same loaded copy, or that `consent` and `loaded` give compatible fixes. The mutation runner confirms this. With mutation `MD`, `duplicate-install` says "gsd-core loaded neither of them" for `GLOBAL_NO_HOOKS`, while `loaded` and `gate-bundle` say the global copy loaded, and all 72 tests still pass. `MH` (consent ok for an unledgered copy) and `MI` (loaded fix not re-consent) are caught only by per-case `extra` assertions.

**Fix:**
- Derive facts from the host, not from `cls`: run render-hooks, and use the `scope` of `_overlay`-free evidence such as the marker from `ledgeredGlobalSkipped`, or the `id collides` warning.
- Add a cross-record invariant: extract the "loaded copy" claimed by each record (a "loaded the <scope>" or "loads the <scope>" phrase, "neither", "keeps the global one") and assert that they agree.
- Add a consent/loaded fix-compatibility rule: if `consent` says re-consent, the `loaded` fix must too.
- Keep `MD` as a regression test.

## Info

### IN-01: With no render evidence, `gate-bundle` states "gsd-core loads memanto from <dir>" without hedging

**File:** `lib/install-state.cjs:137-139`, `:438`

**Issue:** When `capability list` fails and no render runs (`gpending`), the classifier gives `GLOBAL_LOADED` from the loader's precedence alone. `gate-bundle` then states "gsd-core loads memanto from <dir>", although gsd-core defers a `_pending` entry. `loaded` hedges in this case ("by the loader's precedence", `:345`), but doctor does not print `loaded` when the list fails.

**Fix:** When `!cls.render.ran`, use the same hedge in `gate-bundle` ("by the loader's precedence gsd-core would load …"), or report the state as undetermined.

---

_Reviewed: 2026-11-22T04:30:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
