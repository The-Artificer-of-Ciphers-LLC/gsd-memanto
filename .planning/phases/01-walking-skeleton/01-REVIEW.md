---
phase: 01-walking-skeleton
reviewed: 2026-11-22T03:45:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - memanto.cjs
  - test/gate-bundle.test.cjs
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
  necessity: 0
status: issues_found
---

# Phase 1: Code Review Report (round 7, re-review of the round-6 fixes)

**Reviewed:** 2026-11-22T03:45:00Z
**Depth:** standard
**Files Reviewed:** 2 (`git diff aa1a367^1 aa1a367 -- . ':!.planning'`)
**Status:** issues_found

## Summary

This round re-reviews the round-6 fixes (`130d4fd`, `8b1ccc7`, merged in `aa1a367`). `npm test` reports 426 tests: 425 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network targets were the closed local port `127.0.0.1:9`. No Memanto server was contacted. The necessity reference was not re-read this round, and no necessity findings are claimed.

Each repro ran doctor twice: once from the current tree, and once from the `aa1a367^1` tree extracted to `scratchpad/r7/base`. The scripts are `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r7/r7.cjs` (modes `strayproj`, `strayglobal`, `nothing`, `homeproj`, `globalplusstray`) and `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r7/collide.cjs`. Doctor exits 1 in every run, so nothing fails open. All findings concern wrong or lost diagnostics.

### Status of the round-6 findings

| Round-6 | Verdict | Notes |
|---------|---------|-------|
| WR-01 | Fixed for the reported cases; one classification defect remains (new WR-02) | `single.cjs` modes `gengines`, `pengines`, `gsquat` and `psquat` now name the single copy and its directory. Each gives a fix that matches the reason, and in `gengines`/`pengines` the fix no longer contradicts the `engines` record. However, `CLASH` (`memanto.cjs:185`) also matches `id collides`, which is not an ownership clash. The round-6 review proposed that regex, so the error started in the round-6 review. |
| IN-01 | Fixed, but it causes one regression (new WR-01) | `gateBundleCheck` now gets `rendered` (`:457-458`), and `rendered === false` is an error with or without a reason. In mode `nothing`, `gate-bundle` used to report a false `ok`; it is now an error, which is correct. The same early return now also runs before the stray-gate-code check. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Since the IN-01 fix, `gate-bundle` no longer reports stray or planted gate code when no hook renders and gsd-core gives no reason

**File:** `memanto.cjs:465-468` (early return on `noneLoaded`), `:522-531` (the stray-gate loop, now never reached), `:609-610`
**Issue:** `noneLoaded` is now `rendered === false` on its own. When no reason is printed, the `noneLoaded` return comes before the CR-01 / round-2 check that flags `scripts/gate.cjs` in a directory that is not an installed bundle. A hand-copied project bundle (no ledger, no consent) renders no hook and prints no load warning. It used to get the specific "stray or planted gate code" error with `delete <dir>`. It now gets "gsd-core did not load the project memanto copy at <dir> and printed no load error", with the fix "fix the error the render checks report, or reinstall …". The message implies gsd-core tried to load the copy and failed silently. In fact gsd-core ignores it by design. The `consent` record still says "remove the copied directory", so the cure appears only in the report's other records, and `gate-bundle` no longer flags the planted code itself.
**Reproduced:** `r7.cjs strayproj`. The BASE run gives `gate-bundle` "…holds scripts/gate.cjs but is not an installed memanto bundle…; stray or planted gate code" with fix "delete <dir> (the gate never runs it), then reinstall". The NOW run gives the generic not-loaded text. Mode `globalplusstray` shows that this masking already applied when a reason was printed (round 5), so the gap is now in both branches.
**Fix:** In `gateBundleCheck`, run the stray-gate loop (`:522-531`) before the `noneLoaded` return. Alternatively, inside the `noneLoaded` branch, find the first scope dir that holds `scripts/gate.cjs` but fails `isInstalledBundle`. Add its "stray or planted gate code" clause to the message, and put `delete <dir>` first in the fix. Add `strayproj` to `test/gate-bundle.test.cjs`, asserting that `gate-bundle` names the stray directory and that the fix says delete.

### WR-02: `id collides` is classified as an ownership clash, so doctor says "loaded neither memanto copy" and "removing a memanto copy does not clear it" when removing a copy is the cure

**File:** `memanto.cjs:185` (`CLASH = /^(owns |id collides)/`), `:191`, `:175` (`neither` wording)
**Issue:** The loader emits `id collides with an already-registered capability` (`capability-loader.cjs:691`) only after an earlier memanto copy has passed every check and been added to `acceptedIds` (`:879`). So that reason proves gsd-core loaded the global copy, and it is a clash between the two memanto copies. When that loaded copy renders no hook at the declared points (for example a hand-copied or stale global manifest), the round-6 code gives two wrong statements:
- The message says "gsd-core loaded neither memanto copy", but the global copy was loaded.
- The fix says "reinstalling or removing a memanto copy does not clear it", but deleting the hand-copied global copy is exactly what clears it.

Within the same report, `consent` says "remove the copied directory and reinstall" and `duplicate-install` says "delete <global dir> by hand", so `loaded` and `gate-bundle` contradict them. This is the same kind of contradiction that round-6 WR-01 was meant to remove.
**Reproduced:** `collide.cjs`. The setup is a project install plus a hand-copied global `capability.json` with `gates`, `steps` and `contributions` emptied. Render warning: `id collides with an already-registered capability`, with 0 memanto hooks. `loaded` and `gate-bundle` both say "loaded neither memanto copy (id collides …)" with `CLASH_FIX`. `consent` and `duplicate-install` say to delete the global directory. Doctor exits 1.
**Fix:** Narrow `CLASH` to `/^owns /`. When any reason matches `COLLIDES`, describe the global copy as loaded but rendering no memanto hook. For example, `notLoadedText` can say "gsd-core loaded the global memanto copy at <dir>, but it renders no memanto hook". Make the fix: delete `<global dir>` by hand when `!isInstalledBundle(gsdHome)`, otherwise reinstall the global copy. Add `collide.cjs` as a test, and assert that `loaded`/`gate-bundle` neither say "neither" nor "does not clear it".

## Info

### IN-01: The "neither" wording counts manifests, not distinct directories

**File:** `memanto.cjs:172-175`
**Issue:** `notLoadedText` checks `hasManifest(gsdHome) && hasManifest(projectRoot)`. When the project root is `GSD_HOME`, both checks see the same file, so one copy is reported as "loaded neither memanto copy". `duplicateCheck` already guards this case with `distinct.size < 2` (`:311-312`). Reproduced with `r7.cjs homeproj`: `duplicate-install` says "at most one scope", while `loaded` and `gate-bundle` say "neither".
**Fix:** Compare `path.resolve(scopeDirs.global) !== path.resolve(scopeDirs.project)` before choosing the two-copy wording.

### IN-02: The mixed-reason fix is untested, and the exported `loadedCheck` throws without `roots`

**File:** `memanto.cjs:195-197`, `:200`, `:655`
**Issue:** The mixed branch of `notLoadedFix` (a clash plus another reason) can be reached. One example is a global copy that fails validation while the project copy then fails `owns config key`. No test covers this branch. Separately, `loadedCheck` is now exported, but `roots` has no default. A call with `noneLoaded: true` and a reason, but without `roots`, throws `TypeError` at `roots.gsdHome` (`:172`). `collectChecks` always passes `roots`, so production is unaffected.
**Fix:** Add a unit row for `notLoadedFix(['failed validation: x', 'owns config key "memanto.enabled" …'])`. Make `roots` a required positional argument, or guard it in `notLoadedText`.

---

_Reviewed: 2026-11-22T03:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
