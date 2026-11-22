---
phase: 01-walking-skeleton
reviewed: 2026-11-22T03:01:58Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - .github/workflows/publish.yml
  - README.md
  - lib/checks.cjs
  - lib/health.cjs
  - memanto.cjs
  - test/doctor.test.cjs
  - test/gate-bundle.test.cjs
  - test/health.test.cjs
  - test/loader-drift.test.cjs
  - test/release.test.cjs
findings:
  critical: 0
  warning: 2
  info: 1
  total: 3
  necessity: 0
status: issues_found
---

# Phase 1: Code Review Report (round 5, re-review of the round-4 fixes and owner follow-ups)

**Reviewed:** 2026-11-22T03:01:58Z
**Depth:** standard
**Files Reviewed:** 10 (`git diff 2750ff1^1 HEAD -- . ':!.planning'`)
**Status:** issues_found

## Summary

This round re-reviews the round-4 fixes (`e0a18cb`, `6620f9b`, `a66bf46`, `4ac2a9f`, `473d9e8`) and the owner follow-ups (`a16d035`, `94afcd5`). `npm test` reports 417 tests: 416 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network traffic went to the closed local port `127.0.0.1:9`. No Memanto server was contacted. The necessity reference was read, and no necessity findings apply.

All five round-4 findings are fixed. The new endpoint allowlist in `lib/health.cjs` held up under adversarial testing. Doctor, however, still misreports which copy gsd-core loads when both copies are skipped (WR-01). The new loader drift test checks only one of the three loader facts that inference relies on (WR-02). Doctor still exits 1 in the WR-01 state, so nothing fails open. The new curl hint is not safe to paste into a shell (IN-01).

### Status of the round-4 findings

| Round-4 | Verdict | Notes |
|---------|---------|-------|
| CR-01 | Fixed, complete | The regex at `lib/health.cjs:30-36` allows one `@` at most. That `@` can only end the userinfo, because the user and password classes exclude `@`, `:`, `/`, `\`, `?` and `#`, and the decoded path is checked against `AT_FORMS` (`:63`). The WHATWG cross-check (`:74-75`) rejects any rewritten host, such as `127.1`, `0x7f.1`, `[::ffff:1.2.3.4]`, `[0::1]`, `1.2.3.4.5` or `a.0x1`. A 2,000,000-input random fuzz produced 132,017 accepted values over mixed-case schemes and the characters `: / @ % [ ] \ ? # ＠`, tab, `%40`, `%3A` and `%2F`. For every one of them, the displayed host equals `new URL(value).host`, and the display holds no `@`. Hand-tested edge cases also stay on the configured host and are never echoed: `//evil.com` and `%2F%2Fevil.com` base paths, `%2e%2e` segments, `%2540`, `%00` and `%0d%0a` in the userinfo, `xn--` hosts, a trailing-dot host and leading-zero ports. The probe target and the Basic header come only from the accepted parts (`:109-115`). The display is only `scheme://host[:port]` plus `/<base path>`. A rejected value prints only `value <redacted>` (`lib/checks.cjs:121`). No other echo path exists: `v.url` reaches only `checkHealth` and `displayBase`. Both round-4 reproductions block, and nothing is probed for them. An upper-case scheme is normalised and probed in lower case. |
| WR-01 | Fixed for the reported cases; one residual (new WR-01) | The fragment mode now reports `gate-bundle` as an error that gives the loader's reason. The validation mode is reported as undetermined, which is an error. `POST_COLLISION_REASONS` matches `capability-loader.cjs` 1.20.1 `:700-853` in order. When both copies are skipped, doctor still names the project copy as loaded (WR-01 below). |
| IN-01 | Fixed, complete | The "colliding" parenthetical now requires a `COLLIDES` reason (`memanto.cjs:418-423`). |
| IN-02 | Fixed, complete | The rule appears in every rejected-value hint (`lib/checks.cjs:122-124`). The README states that `@` is not supported in the base path. |
| IN-03 | Fixed, complete | `names="$(...)"; rc=$?` inside `set +e` captures git's exit code. `set -e` is restored, and `-u` and `pipefail` stay on. Exit 0 refuses, exit 1 continues, and any other exit fails the step (`publish.yml:139-151, 287-301`). The hermetic test runs the checks as they are written in the workflow. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Doctor says gsd-core loads the project copy when gsd-core skipped both copies

**File:** `memanto.cjs:299-307` (`loadFailureReasons` de-duplicates by text), `:358` (a `POST_COLLISION` reason sets `globalSkipped`), `:363` (returns `projectCopy`), consumed by `loadedCheck` (`:179-180`), `duplicateCheck` (`:287`) and `gateBundleCheck` (`:393-408`)
**Issue:** A `POST_COLLISION` reason proves only that the global copy did not claim the id. It does not prove that the project copy loaded. Both copies can fail the same post-collision check. For example, another capability can own a `memanto.*` config key, or both installs can come from one broken release. Render-hooks then prints one identical warning per copy. `loadFailureReasons` collapses the two warnings into one, and `loadedCopy` returns the project copy as loaded. The same happens when the global copy fails a pre-collision check and the project copy fails a post-collision one. In both cases `loadedCopy` never checks whether any memanto hook was rendered.
**Reproduced** with `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r5/both-skipped.cjs`. The setup was a temp `GSD_HOME` with a global install and a consented project install. A hand-copied global capability `aaa-squat` declared the config key `memanto.enabled`. Results:
- Render-hooks `discuss:pre` printed the `owns config key "memanto.enabled"` warning twice and rendered 0 memanto hooks. The loader's `_overlay.warnings` named both scopes.
- Doctor `--raw` reported `loaded` as **ok**, with the message "gsd-core loads the project copy at …".
- `duplicate-install` said "gsd-core skipped the global one and loads the project one".
- `gate-bundle` said "gsd-core loads the bundle at <project>". It blamed only the global copy, and its fix was to reinstall the global copy and keep the project one. That fix cannot clear the squat.

Doctor still exits 1, because `render:discuss:pre` is an error. Nothing fails open, but three records state a load that never happened and give a fix that does not work.
**Fix:** Pass the render evidence into `loadedCopy`. When at least one render succeeded and none of them holds a memanto hook, no copy is loaded:
```js
// collectChecks
const rendered = renders.length ? renders.some((rh) => rh.hooks.some((h) => h && h.capId === 'memanto')) : null;
// loadedCopy({ ..., rendered })
if (rendered === false) return null; // gsd-core loaded no copy
```
In `loadedCheck`, report `loaded === null` with active rows as an `error`, for example: "capability list shows memanto active but gsd-core loaded no copy (see render checks)". Keep counting duplicates within one render: two `failed to load` lines in one render-hooks call mean that both copies were skipped. Add the squat repro to `test/gate-bundle.test.cjs`, and assert that `loaded` is `error` and that no record claims a loaded copy.

### WR-02: The loader drift test does not check two of the three loader facts that `POST_COLLISION` depends on

**File:** `test/loader-drift.test.cjs:25-66`. The inference is stated at `memanto.cjs:311-318, 335-345`. The loader facts are at `capability-loader.cjs:289-291` (global root added before project), `:690` (collision check on `acceptedIds`) and `:879` (`acceptedIds.add(id)` only on acceptance).
**Issue:** The test checks only the text order of the `skip('…')` literals. The inference that "a post-collision reason names the global copy" and the round-3 `COLLIDES` rule ("the global copy holds the id") also depend on two more facts: `overlayRoots` scans the global root first, and the id is claimed only after the last listed check. If a release breaks either fact, the test still passes and doctor reports the opposite copy. With a project-first scan, a project copy that gsd-core loaded makes the global copy collide. Doctor would then report the global copy as loaded, and with an installed global bundle, `gate-bundle` would be `ok` while the gate runs the global `gate.cjs` and gsd-core runs the project manifest.
**Reproduced** with a copy of the 1.20.1 loader at `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r5/core/bin/lib/capability-loader.cjs`. The copy has two mutations: `add(globalDir, …)` moved after `add(projectDir, …)`, and `acceptedIds.add(id)` inserted right after the collision check. `GSD_CORE_DIR=<that dir> node --test test/loader-drift.test.cjs` gave 2 pass, 0 fail.
**Fix:** Add two assertions to the same source scan:
1. In `function overlayRoots`, the first `add(globalDir` line comes before the first `add(projectDir` line.
2. The collision check reads `acceptedIds.has(id)`, and the only `acceptedIds.add(` line comes after the line of the last listed reason.

Each assertion should fail with a message that names `memanto.cjs` `loadedCopy`. Add the two mutations above to the mutation set the fix report already uses.

## Info

### IN-01: Pasting the new curl hint into a shell runs a different command

**File:** `lib/checks.cjs:143-148`, `lib/health.cjs:41`
**Issue:** For a URL with a base path, the hint prints `curl -fsS http://127.0.0.1:9/<base path>/health` (reproduced). A shell reads `<base` as a stdin redirect and `path>/health` as the argument `path` plus a stdout redirect to `/health`. If a file named `base` exists in the current directory, the pasted hint runs curl against `http://127.0.0.1:9/` and the host `path`, and it truncates or creates `/health`. If no such file exists, the shell refuses with an error.
**Fix:** Use a placeholder that is inert in a shell, for example `curl -fsS 'http://127.0.0.1:9/BASE_PATH/health'` (quoted, with no `<` or `>`), or put the placeholder outside the command: `curl -fsS <url>/health (url: http://127.0.0.1:9 plus your base path)`. Update the README row and the line-length test to match.

---

_Reviewed: 2026-11-22T03:01:58Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
