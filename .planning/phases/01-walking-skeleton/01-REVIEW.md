---
phase: 01-walking-skeleton
reviewed: 2026-11-22T03:15:48Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - README.md
  - lib/checks.cjs
  - lib/health.cjs
  - memanto.cjs
  - test/doctor.test.cjs
  - test/gate-bundle.test.cjs
  - test/health.test.cjs
  - test/loader-drift.test.cjs
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
  necessity: 0
status: issues_found
---

# Phase 1: Code Review Report (round 6, re-review of the round-5 fixes)

**Reviewed:** 2026-11-22T03:15:48Z
**Depth:** standard
**Files Reviewed:** 8 (`git diff 5b8643e^1 5b8643e -- . ':!.planning'`)
**Status:** issues_found

## Summary

This round re-reviews the round-5 fixes (`11c9189`, `9e8465c`, `66755b1`, merged in `5b8643e`). `npm test` reports 422 tests: 421 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network traffic went to the closed local ports `127.0.0.1:9` and `[::1]:9`. No Memanto server was contacted. The necessity reference was read, and no necessity findings apply.

WR-02 and IN-01 are fixed and complete. WR-01 is fixed for the reported two-copy case. However, the new "neither loaded" branch also handles the common single-copy case. In that case its wording is wrong, and for a copy rejected by `engines.gsd` or by validation, its fix hint is wrong too (new WR-01). This regresses the fix hint that doctor gave before `11c9189`. Doctor still exits 1 in every case, so nothing fails open.

### Status of the round-5 findings

| Round-5 | Verdict | Notes |
|---------|---------|-------|
| WR-01 | Fixed for the reported case; one regression (new WR-01) | The reviewer's squat repro now reports `loaded` and `gate-bundle` as errors, and no record claims a loaded copy. `loadFailureReasons` (`memanto.cjs:328-350`) counts warnings per call and takes the maximum of the warnings list and stderr, so one skipped copy stays at a count of 1. A single-copy squat run gave one warning and no "(reported for both copies)" mark. When the global copy fails validation and the project copy fails a post-collision check, `rendered === false` short-circuits `loadedCopy` to `null` (`:401`), which is correct. |
| WR-02 | Fixed, complete | `test/loader-drift.test.cjs:453-486` passes against the installed 1.20.1 loader (global add `:290`, project add `:292`, `acceptedIds.has(id)` `:690`, the single `acceptedIds.add` `:879`). It fails against the round-5 two-mutation loader (`scratchpad/r5/core`) with the root-order message, which names `memanto.cjs loadedCopy`. The guard window (`collision.line-4 .. collision.line`) contains the `if` line at 690. |
| IN-01 | Fixed, complete | The hint is `curl -fsS '<scheme://host[:port][/BASE_PATH]>/health'` (`lib/checks.cjs:150`). The display can hold only `[A-Za-z0-9.:-]`, brackets and `/BASE_PATH`, so it can never hold a `'`. No other curl hint exists in `lib/`, `scripts/` or `memanto.cjs`. A pasted IPv6 hint runs as intended: `curl -fsS 'http://[::1]:9/BASE_PATH/health'` attempts the connection (exit 7, connection refused) and does not glob. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: With only one memanto copy installed, doctor reports that it "loaded neither memanto copy" and says that reinstalling does not help, even when a reinstall is the fix

**File:** `memanto.cjs:173-174` (`NEITHER_FIX`), `:169-172` (`neitherLoadedText`), `:179-182` (`loadedCheck`), `:438-441` (`gateBundleCheck`), `:581` (`neither`)
**Issue:** `noneLoaded` and `neither` depend only on `rendered === false`. They do not check whether two copies exist, and they do not check which reason gsd-core gave. As a result, two things go wrong whenever any single copy is skipped:
- The message says "neither memanto copy".
- The fix is always `NEITHER_FIX`, which says "reinstalling or removing a memanto copy does not clear it".

That fix holds only for an ownership clash, such as an `owns …` squat or a first-party `id collides`. It is false when the reason is `incompatible with GSD …`, `failed validation: …`, a manifest read error or an invalid hook fragment. For each of those, installing a valid or compatible release is the cure.

Within the same report, the `engines` record (`:243`) and the `render:discuss:pre` record (`:283`) both say to reinstall, so doctor now contradicts itself. Before `11c9189`, the same state gave `loaded` the fix `reinstall: gsd-tools capability install …`, which was correct.

**Reproduced** with `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r6/single.cjs`:
- `gengines` (one global install whose `engines.gsd` is `">=9.0.0"`):
  - `loaded` and `gate-bundle` say "gsd-core loaded neither memanto copy (incompatible with GSD 1.20.1 …)", with `NEITHER_FIX`.
  - `engines` says "install a memanto release whose engines.gsd includes GSD 1.20.1".
- `gsquat` and `psquat` (one global or one project install, plus a squat): the message says "neither memanto copy" although only one copy exists. `duplicate-install` correctly says "at most one scope".
- Baseline: `single-base.cjs gengines`, run against the `5b8643e^1` tree extracted to `scratchpad/r6/base`, gives `loaded` the fix `reinstall: …`.

In every run doctor exits 1.

**Fix:**
- Choose the fix from the reasons. Use `NEITHER_FIX` only when every reason matches `/^(owns |id collides)/`. Otherwise use `fix the load error the loaded, engines and render checks report, or ${reinstallFix()}`.
- Choose the wording from the number of manifests on disk. Write "neither memanto copy" only when `hasManifest(gsdHome) && hasManifest(projectRoot)`. Otherwise write `gsd-core did not load the memanto copy at <dir>`.
- Add the `gengines` and single-copy squat cases to `test/gate-bundle.test.cjs`. Assert the wording, and assert that the fix does not contradict the `engines` record.

## Info

### IN-01: When no memanto hook renders and gsd-core gives no reason, `loaded` and `gate-bundle` disagree

**File:** `memanto.cjs:179` (`noneLoaded && (shown.length || reported)`), `:581` (`neither` also needs `failures.length`), `:505`
**Issue:** If renders succeed, no memanto hook appears and there is no `failed to load` warning, `loadedCopy` returns `null`. `loaded` then reports "gsd-core loaded neither memanto copy".

`gate-bundle`, however, gets `neither === false` and `loaded === null`. It falls through to `ok`, with the message "the discuss:pre gate runs the installed bundle gsd-core loads". That claims a load the `loaded` record has just denied.

With the current manifest, this state needs gsd-core and doctor to disagree on `memanto.enabled`, or a copy whose gate is gated off. So the evidence is judgment-based, and doctor still exits 1 through `loaded` and `render:*`.

**Fix:** Pass `rendered === false` itself as `noneLoaded` to `gateBundleCheck`, and keep `failures` only for the message text. Alternatively, make the `ok` text conditional on `loaded` being non-null.

---

_Reviewed: 2026-11-22T03:15:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
