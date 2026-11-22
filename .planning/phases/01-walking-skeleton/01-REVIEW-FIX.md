---
phase: 01-walking-skeleton
fixed_at: 2026-11-22T05:10:00Z
review_path: .planning/phases/01-walking-skeleton/01-REVIEW.md
iteration: 8
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report (rounds 4 to 8)

The frontmatter counts are for round 8 (the current 01-REVIEW.md): 5 findings, all fixed. See "Round 8" at the end. Round 8 replaced the round-7 classifier evidence and states described in "Round 7". The round-4 report, its owner follow-ups and the round-5 and round-6 sections are kept below unchanged. Round 7 replaced the round-5 and round-6 doctor code they describe (`loadedCopy`, `notLoadedText`, `notLoadedFix`, `loadedCheck`, `gateBundleCheck`).

**Fixed at:** 2026-11-22T02:31:45Z (round 4), 2026-11-22T03:11:38Z (round 5), 2026-11-22T03:21:45Z (round 6), 2026-11-22T03:41:23Z (round 7), 2026-11-22T05:10:00Z (round 8)
**Source review:** .planning/phases/01-walking-skeleton/01-REVIEW.md, which is now round 8, the re-review of the round-7 fixes. Round 7 re-reviewed the round-6 fixes. Earlier rounds: round 4 re-reviewed the round-3 fixes, round 5 the round-4 fixes and owner follow-ups, and round 6 the round-5 fixes.
**Iteration:** 4, then 5, 6, 7 and 8

Earlier rounds:
- Round 1 (14 findings, all fixed): commits `851e2c2..d684020`.
- Round 2 (9 findings, all fixed): commits `d189838..6243b0e`.
- Round 3 (4 findings, all fixed): commits `ebb2d4c..76f329d`.

**Summary:**
- Findings in scope: 5 (owner decision: every finding, CR, WR and IN, no deferrals, no skips)
- Fixed: 5
- Skipped: 0
- Every fix was written test-first. The new or changed tests failed before the code change and passed after it.
- Verification ran in this agent worktree (`.claude/worktrees/agent-a4925451f902d53d9`), not in a separate review-fix worktree. `npm test`: 401 tests, 400 pass, 0 fail, 1 skipped. `actionlint` is clean on both workflows. Every host run used a temp `GSD_HOME`. No Memanto server was contacted. The only network traffic went to local fake servers and closed local ports. Versions stay `0.1.0`.

| Finding | Commit | Files | Status |
|---------|--------|-------|--------|
| CR-01 | `e0a18cb` | `lib/health.cjs`, `lib/checks.cjs`, `README.md`, `test/health.test.cjs`, `test/doctor.test.cjs` | fixed: requires human verification |
| IN-02 | `6620f9b` | `lib/checks.cjs`, `README.md`, `test/health.test.cjs`, `test/doctor.test.cjs` | fixed |
| WR-01 | `a66bf46` | `memanto.cjs`, `test/gate-bundle.test.cjs` | fixed: requires human verification |
| IN-01 | `4ac2a9f` | `memanto.cjs`, `test/gate-bundle.test.cjs` | fixed |
| IN-03 | `473d9e8` | `.github/workflows/publish.yml`, `test/release.test.cjs` | fixed |

## Fixed Issues

### CR-01: A credential URL whose user name holds an unencoded `\` or `/` passes the gate, is probed at the wrong host, and has its password printed verbatim

**Commit:** `e0a18cb`
**Applied fix:** The URL heuristics in `lib/health.cjs` are deleted: `splitUrl`, `classifyUrl`, `AT_LIKE`, `redactUrl` and their special cases. One strict allowlist rule replaces them. It is checked on the raw value before any WHATWG parsing: `^(https?)://` [userinfo `@`] host (`[A-Za-z0-9.-]+` or a bracketed IPv6 address) [`:port` of 1 to 5 digits] [path], with URL-safe characters only. `%XX` escapes must be valid hex and decodable. The decoded path may not hold any form of `@`. After the raw check, `new URL(value)` must agree on the scheme, host and port, and the port must be at most 65535. Otherwise the value is rejected.

An accepted value is displayed only as `scheme://host[:port]`, with `/<base path>` in place of a base path. A rejected value is displayed only as `<redacted>`. The probe target (`<origin><base path>/health`) and the Basic header (from the decoded userinfo) are built from the accepted parts. When a base path is present, the curl hint does not repeat the origin, so the line fits `LINE_MAX`.

The tests are table-driven. They cover every input from review rounds 1 to 4, including both round-4 reproductions, `http://tok/en@host`, `http://u:12/x@host`, `http://user:123#w@host`, `%40`, the U+FF20 and U+FE6B variants and their UTF-8 percent forms, `http://host:8000/a@b`, `http://host/?x=a@b`, `http://@host`, scheme-less `localhost:8000`, and `http://user:p@ss@host:8000/` (accepted before round 4, now rejected because it holds two `@`). They also cover the valid values `http://localhost:8000`, `https://u:p%40ss@h:1/base` and `http://[::1]:8000`. For each input they assert accept or reject, `displayBase`, a gate run for both keys with no probe and no secret in the stderr, doctor text and `--raw` in both forms, and the health line plus curl hint for an accepted URL with userinfo and a base path.

**Human check:** this is the security rule. Confirm that the strict form (lower-case scheme; `:` inside a password must be written `%3A`; hosts that WHATWG rewrites, such as `0x7f.1` or `127.1`, are rejected) is acceptable for real deployments.

### IN-02: A credential-free URL with an `@` after a `host:port` cannot be written in any form, and the hint points at credentials

**Commit:** `6620f9b`
**Applied fix:** Every rejected endpoint now prints the problem `value <redacted>` and then the rule as the fix: `memanto.<key> must be http(s)://[user[:password]@]host[:port][/path] using URL-safe characters; '@' is allowed only as the user:password separator (write '@' inside a password as %40)`. So a credential-free URL with an `@` in its path is told what is wrong. The key name is in the check id and in the rule, not repeated in the problem text, which keeps the line at 240 characters (232 for `api_url`), inside `LINE_MAX` (250), untruncated. A test pins this. The README states the rule, says that `@` in the base path is not supported (encoded or not), and documents the new hint.

### WR-01: Doctor reports `gate-bundle ok` while the gate runs a ledgered global bundle that gsd-core skipped

**Commit:** `a66bf46`
**Applied fix:** `loop render-hooks` load-failure warnings carry no scope. The JSON, the stderr line and the loader's `blockedGates` entries were all checked. The loader's `_overlay.warnings` do name the scope, but reading them would mean running gsd-core's internal loader module. That breaks the bundle's builtin-only `require()` contract (INST-05, `test/bundle.test.cjs`), so the scope is derived from the loader's own order instead. A reason the loader gives only after its id-collision check names the global copy. The list is in `POST_COLLISION`, taken from `capability-loader.cjs` 1.20.1: owned skill, agent, config key or command family, `engines.gsd`, hook fragment, cross-capability validation, configHome confinement. While the global copy holds the id, a project copy is skipped as colliding before it can get any of these. When such a reason appears, `loadedCopy` treats the global copy as not loaded, even when `capability list` shows a ledgered global row as active. `gate-bundle` then reports that the predicate runs the rejected global bundle as an error, with the loader's reason. A reason either copy can get (failed validation, a manifest read error, a reserved prefix, or any unknown reason) is reported as undetermined, never guessed. In that case `loaded` and `gate-bundle` are errors that name both directories. `duplicate-install` now says which copy gsd-core keeps only when doctor knows it.

Tests: both reviewer repro modes (`fragment` and `validation`), with a global install plus a consented project install, a marker proving the predicate runs the global `gate.cjs`, and a unit table over every loader reason.

**Human check:** the `POST_COLLISION` list is tied to the 1.20.1 loader's check order. A gsd-core release that reorders those checks needs the list rechecked. Unknown reasons fail closed (undetermined, error).

### IN-01: The `gate-bundle` message asserts a collision that doctor never observed

**Commit:** `4ac2a9f`
**Applied fix:** The `skips the project copy with the same id as colliding` parenthetical now requires the host's `id collides` warning. Without it, the message states only what is known: `a global capability.json exists, and gsd-core scans the global copy first`. WR-01 already reports the PRE_COLLISION-only case as undetermined. Test: a hand-copied global copy next to a project install with memanto disabled (no render, so no collision evidence).

### IN-03: The git-config refusal fails open when `git config` exits with an error other than "no match"

**Commit:** `473d9e8`
**Applied fix:** Both checks in `.github/workflows/publish.yml` (the refusal step and the push re-check) capture the `git config --local --name-only --get-regexp` exit code. Exit 0 prints the key names and refuses. Exit 1 continues. Any other code fails the step with `git config failed (exit <rc>) ...`. The push re-check also names the staged version to reject. The hermetic test extracts each check from the workflow up to a `# End of the git config refusal.` marker. It runs the check with bash against plain fixture files under `os.tmpdir()`, replacing `--local` with `git config --file`: a clean file continues, a planted `insteadOf` refuses without printing its value, and an unparseable file (git exits 128) fails. No repository's `.git/config` is read or written. `actionlint` is clean.

## Owner follow-ups

The owner answered the two human checks above after round 4 was merged into main (`2750ff1`). Both answers were implemented test-first, one commit each, on top of the round-4 branch. `npm test`: 417 tests, 416 pass, 0 fail, 1 skipped.

### Follow-up 1 (CR-01): accept an upper-case scheme only

**Commit:** `a16d035`
**Files:** `lib/health.cjs`, `README.md`, `test/health.test.cjs`
**Applied change:** The scheme alone is matched case-insensitively (`HTTP://`, `Https://`), and it is shown and probed in lower case. Everything else in the rule is unchanged: a `:` inside a password must still be written `%3A`, and hosts that Node rewrites (`0x7f.1`) are still rejected. New accepted rows: `HTTP://localhost:8000`, `HTTPS://u:p%40ss@h:1/base` and `Https://h:1`, each shown in lower case with no userinfo or base path. New rejected rows: `HTTP://0x7f.1:8000`, `HTTPS://alice:s3c:ret@...`, `Http://alice:s3cret%40...` and `FTP://...`. A gate run with an upper-case scheme, userinfo and a base path never prints the secrets in the health line or the curl hint. A `checkHealth` case confirms the decoded Basic header and the base path. The README scheme bullet is updated.

### Follow-up 2 (WR-01): CI drift test for the loader's skip order

**Commit:** `94afcd5`
**Files:** `memanto.cjs`, `test/loader-drift.test.cjs` (new)
**Applied change:** `POST_COLLISION` is now built from an exported, ordered `POST_COLLISION_REASONS` list. `test/loader-drift.test.cjs` reads `<GSD_CORE_DIR or ~/.claude/gsd-core>/bin/lib/capability-loader.cjs` as text, so the builtin-only `require()` test stays green. It collects every `skip('...')` reason in source order. It fails with a named message in three cases: a listed reason now comes before the `id collides` check; the loader has a new reason after that check; or the order no longer matches the list. `overlay processing error` is allowed only while it sits in the per-candidate `catch` block, because that block can run at any stage. The test passes against the local 1.20.1 loader and against the 1.22.0 loader read from `npm pack @opengsd/gsd-core@1.22.0`. The two loaders give the same skip reasons in the same order, at the same lines (680 to 906). Three mutated copies of the loader all fail with the expected message: a reason moved early, two reasons swapped, and a new reason. The CI matrix (`gsd: ["1.20.1", "1.22.0"]`) runs the test against both releases through `GSD_CORE_DIR`.

## Round 5

**Source review:** `01-REVIEW.md` round 5 (WR-01, WR-02, IN-01; no criticals). The branch was first fast-forwarded to main (`75fe09f`). Owner rule: fix every finding, no deferrals. Each fix was written test-first: the new or changed tests failed before the code change and passed after it.

**Summary:** 3 in scope, 3 fixed, 0 skipped. Verification ran in this agent worktree (`.claude/worktrees/agent-a4925451f902d53d9`). `npm test`: 422 tests, 421 pass, 0 fail, 1 skipped. Every host run used a temp `GSD_HOME`. No Memanto server was contacted. Versions stay `0.1.0`.

| Finding | Commit | Files | Status |
|---------|--------|-------|--------|
| WR-01 | `11c9189` | `memanto.cjs`, `test/gate-bundle.test.cjs` | fixed: requires human verification (logic) |
| WR-02 | `9e8465c` | `test/loader-drift.test.cjs` | fixed |
| IN-01 | `66755b1` | `lib/health.cjs`, `lib/checks.cjs`, `README.md`, `test/health.test.cjs`, `test/doctor.test.cjs` | fixed |

### WR-01: doctor said gsd-core loads the project copy when gsd-core skipped both copies

**Commit:** `11c9189`
**Applied fix:** `collectChecks` now records whether any memanto hook rendered (`null` when no render succeeded) and passes it to `loadedCopy`. `loadedCopy` returns `null` when renders succeeded and none held a memanto hook. A post-collision reason now only shows that the global copy did not claim the id. When gsd-core skipped every copy and printed reasons:
- `loaded` is an error: "capability list shows memanto active in ... scope, but gsd-core loaded neither memanto copy (<reasons>); no memanto hook renders, so its gate does not run (fails open)".
- `gate-bundle` is an error with the same text.
- `duplicate-install` says "gsd-core loaded neither of them (see loaded)".

Every fix points at the load error first, for example another capability that owns a memanto config key. None of them suggests a reinstall as the cure. `loadFailureReasons` no longer merges identical warnings from one render-hooks call, because two warnings in one call mean both copies were skipped. Repeats across render points are still counted once. Messages show such a reason once, marked "(reported for both copies)".

The reviewer's squat repro (`aaa-squat` owns `memanto.enabled`) is now a test in `test/gate-bundle.test.cjs`. It asserts that `loaded` and `gate-bundle` are errors, that no record claims a loaded copy, and that no fix offers a reinstall without the load error. `loadedCopy` unit cases cover `rendered: false` (one or two post-collision reasons, a mixed pre/post pair, or no reasons) and `rendered: true`. The reviewer's script run against this worktree gives the same results, and doctor exits 1.

### WR-02: the loader drift test checked only the skip order

**Commit:** `9e8465c`
**Applied fix:** `test/loader-drift.test.cjs` adds a test that reads the loader source and checks two more facts:
1. In `function overlayRoots`, `add(globalDir, ...)` comes before `add(projectDir, ...)`.
2. The collision check reads `acceptedIds.has(id)`, and there is exactly one `acceptedIds.add(`, placed after the last listed `POST_COLLISION` reason.

Each failure message names `memanto.cjs loadedCopy`. Results:
- Passes on `~/.claude/gsd-core` (1.20.1) and on the 1.22.0 loader. Both have the global add at line 290, the project add at 292, the collision check at 690 and `acceptedIds.add` at 879.
- Fails on the reviewer's two-mutation loader (`scratchpad/r5/core`) with the root-order message.
- Fails on each single mutation:
  - the root order swapped;
  - an extra `acceptedIds.add` right after the collision check (found 2);
  - the only `acceptedIds.add` moved before the last post-collision check.

### IN-01: the curl hint ran a different command when pasted into a shell

**Commit:** `66755b1`
**Applied fix:**
- The base-path placeholder is now the plain word `BASE_PATH` (it was `<base path>`, which a shell reads as redirects).
- The curl hint single-quotes the URL: `curl -fsS 'http://host:port/BASE_PATH/health'`. The quotes also stop the brackets of an IPv6 host from globbing.
- A new test extracts the hint from the gate line for a URL with a base path and userinfo, for a URL with no base path, and for an IPv6 host. It asserts that the hint has balanced single quotes, no shell metacharacter outside them, and the exact shape `curl -fsS '<...>/health'`.
- Existing display, health-line and doctor tests expect `BASE_PATH`.
- The README `backend-health` and `api-health` rows and the sample BLOCKED line show the quoted form.
- The longest gate line still fits `LINE_MAX`.

## Round 6

**Source review:** `01-REVIEW.md` round 6 (WR-01, IN-01; no criticals). The branch was first fast-forwarded to main (`415a92e`). Owner rule: fix every finding. Each fix was written test-first: the new tests failed before the code change and passed after it.

**Summary:** 2 in scope, 2 fixed, 0 skipped. Verification ran in this agent worktree (`.claude/worktrees/agent-a4925451f902d53d9`). `npm test`: 426 tests, 425 pass, 0 fail, 1 skipped. Every host run used a temp `GSD_HOME`. No Memanto server was contacted. Versions stay `0.1.0`.

| Finding | Commit | Files | Status |
|---------|--------|-------|--------|
| WR-01 | `130d4fd` | `memanto.cjs`, `test/gate-bundle.test.cjs` | fixed: requires human verification (logic) |
| IN-01 | `8b1ccc7` | `memanto.cjs`, `test/gate-bundle.test.cjs` | fixed |

### WR-01: one skipped copy was reported as "neither", with a fix that contradicted the engines record

**Commit:** `130d4fd`
**Applied fix:** `neitherLoadedText` and `NEITHER_FIX` are replaced by `notLoadedText(failures, scopeDirs, roots)` and `notLoadedFix(failures)`, which `loaded` and `gate-bundle` both use.

The wording follows the manifests on disk:
- Both a global and a project `capability.json`: "gsd-core loaded neither memanto copy (<reasons>)".
- One manifest: "gsd-core did not load the <scope> memanto copy at <dir> (<reasons>)".
- No reason printed: the text ends "and printed no load error".

The fix follows the reasons:
- Every reason matches `^(owns |id collides)` (an ownership clash): the clash fix, "reinstalling or removing a memanto copy does not clear it".
- No reason, or any `engines.gsd`, validation, manifest or fragment failure: "fix the load error the loaded, engines and render checks report, or reinstall: gsd-tools capability install ...". That is the cure the `engines` and `render:*` records give.
- A mix of a clash and another reason: the reinstall fix, plus a note that a reinstall does not clear the clash.

The reviewer's `single.cjs` modes `gengines`, `gsquat` and `psquat` are now tests in `test/gate-bundle.test.cjs`. They assert:
- the single-copy wording, and that no record says "neither";
- the clash fix for the two squats;
- for `gengines`, a reinstall fix that points at the engines check and never says "does not clear", next to the engines record's "install a memanto release" fix.

The two-copy squat test is kept, and it now also asserts the clash fix. The reviewer's script run against this worktree gives the expected text for all four modes (including `pengines`), and doctor exits 1 in every run.

### IN-01: loaded and gate-bundle disagreed when no hook rendered and no reason was printed

**Commit:** `8b1ccc7`
**Applied fix:** `gateBundleCheck` now takes the render evidence itself (`rendered`: true, false or null) instead of a flag that `collectChecks` had already filtered on the presence of reasons. `rendered === false` is an error, whether or not gsd-core printed a reason, and `failures` only feed the message. `collectChecks` passes `rendered`, and `duplicate-install` gets `rendered === false`. The `ok` record "the discuss:pre gate runs the installed bundle gsd-core loads" is now reachable only when a memanto hook rendered or no render ran. `loadedCheck` and `gateBundleCheck` are exported for a new unit test. With renders succeeding, no hook and no reason, that test asserts that both records are errors, that neither claims a load, and that both name "gsd-core did not load the global memanto copy at <dir> and printed no load error". It also asserts that `rendered: true` and `null` still give `ok`.

## Round 7

**Source review:** `01-REVIEW.md` round 7 (WR-01, WR-02, IN-01, IN-02; no criticals). The branch was first fast-forwarded to main (`8106fe3`).

**Approach (coordinator direction for this round):** fix all four findings by restructuring, not by patching. Since round 4, every round found a new contradiction between `loaded`, `gate-bundle`, `duplicate-install` and `consent`, because each of those records derived the install and load state on its own. There is now one classifier, and all four records are built from its result. The coordinator allowed a single commit for this round.

**Summary:** 4 in scope, 4 fixed, 0 skipped. Verification ran in this agent worktree (`.claude/worktrees/agent-a4925451f902d53d9`). `npm test`: 464 tests, 463 pass, 0 fail, 1 skipped. Every host run used a temp `GSD_HOME`. No Memanto server was contacted. Versions stay `0.1.0`.

| Finding | Commit | Files | Status |
|---------|--------|-------|--------|
| WR-01, WR-02, IN-01, IN-02 | `4f88076` | `lib/install-state.cjs` (new), `memanto.cjs`, `README.md`, `test/install-state.test.cjs` (new), `test/helpers/install-invariants.cjs` (new), `test/gate-bundle.test.cjs`, `test/loader-drift.test.cjs`, `test/bundle.test.cjs` | fixed: requires human verification (logic) |

### The classifier

**Evidence.** `memanto.cjs gatherEvidence` reads every input once:
- for both scope directories: whether each holds `capability.json` and `scripts/gate.cjs`, and whether each is an installed bundle;
- the bundle the gate runs (`resolveGateBundle`);
- the `capability list` rows (`null` when the list is unreadable);
- the render outcome: whether a render ran and whether any memanto hook rendered;
- the loader's load-failure reasons, with repeats kept per render-hooks call;
- `memanto.enabled`.

**States.** `lib/install-state.cjs classifyInstall` is pure. It returns one state from a closed enum:
- `none-installed`
- `global-loaded`, `project-loaded`
- `undetermined`
- `global-skipped`, `project-skipped`, `both-skipped`
- `global-accepted-no-hooks`
- `project-not-activated`
- `no-hooks-unexplained`

It also returns the loaded copy, any stray gate code, and the reason classes. The reason classes are:
- `ownership-clash`: `owns ` only.
- `collision-with-accepted-global`: `id collides`.
- `engines`.
- `invalid`: validation, manifest, fragment, cross-capability and configHome failures.
- `unknown`.

Copies are counted by distinct directory. A project root equal to `GSD_HOME` is one copy.

**Records.** `installRecords` builds all four records from that result through one message/fix table. The fixes come from four builders:
- `primaryFix`
- `deleteFix`, which never deletes a bundle that has a committed ledger entry; it reinstalls that copy in place instead
- `consentFix`
- the clash note

`render:<point>` uses the same clash rule. The per-record helpers (`loadedCopy`, `loadedCheck`, `gateBundleCheck`) are gone. `memanto.cjs` exports only `gatherEvidence`, `classifyInstall`, `installRecords` and `STATES` for tests.

### WR-01: stray gate code was masked when no hook rendered

`gate-bundle` now reports stray or planted `scripts/gate.cjs` in every state, naming the directory. Its fix puts `delete <dir> by hand` first. This holds when nothing renders and when a reason is printed. For a hand-copied project bundle (`strayproj`), the classifier gives `project-not-activated`. The text is "gsd-core does not activate the project memanto copy at <dir> (no project capability ledger lists it; copied by hand?)", and it no longer implies a failed load. For `globalplusstray`, the stray project gate is named next to the engines skip.

### WR-02: `id collides` was treated as an ownership clash

`id collides` now has its own class, `collision-with-accepted-global`, because that reason means gsd-core accepted the global copy. When the accepted global copy renders no hook (`collide`), the state is `global-accepted-no-hooks`. `loaded` and `gate-bundle` then say "gsd-core loaded the global memanto copy at <dir>, but it renders no memanto hook (it holds the id, so gsd-core skipped the project copy ...)". The fix is the same in all four records:
- For a hand-copied global copy: "delete <global dir> by hand ...; keep the installed project bundle at <dir>".
- For an installed global copy: check `memanto.enabled`, or reinstall the global copy.

The clash fix ("reinstalling or removing a memanto copy does not clear it") is now used only when every reason starts with `owns `.

### IN-01: "neither" counted manifests

"Neither" and "both" now count distinct directories, so `homeproj` reports "gsd-core did not load the global memanto copy at <dir>", and `duplicate-install` is ok.

### IN-02: the mixed-reason fix was untested and the exported helpers threw

A table row now covers the mixed case: a validation failure plus a squat. It asserts the reinstall fix together with "a reinstall does not clear the ownership clash", and that the clash-only text is absent. `classifyInstall(undefined)` and `installRecords(cls)` without options are tested and do not throw. The old helpers are no longer exported.

### Tests

- **Table test.** `test/install-state.test.cjs` has 30 cases that cover every enum value; a guard test fails if a state has no case. Each case checks the shared rules in `test/helpers/install-invariants.cjs`:
  - every non-ok record has a fix;
  - no record offers a reinstall while another says a reinstall or removal does not help, unless it names the ownership clash;
  - "neither" and "both" appear only with two distinct copies;
  - no fix deletes an installed bundle;
  - stray gate code is always named by `gate-bundle`, with a delete fix;
  - no record claims a load when no copy loaded;
  - when `loaded` is an error, `gate-bundle` is an error too;
  - `gate-bundle` is ok only when the gate runs the loaded copy and there is no stray code.
- **Doctor repros.** In `test/gate-bundle.test.cjs`, each of these runs doctor end to end and applies the same rules, with the facts read from disk:
  - the reviewer's r7 modes `strayproj`, `strayglobal`, `nothing`, `globalplusstray` and `collide`, and `homeproj` as its own test;
  - the r6 modes `gengines`, `gsquat` and `psquat`;
  - the r5 two-copy squat.

  The reviewer's `r7.cjs` and `collide.cjs`, run against this worktree, give the same records, and doctor exits 1 in every mode.
- **Drift test.** `test/loader-drift.test.cjs` now names `lib/install-state.cjs classifyInstall`. It also checks that the classifier applies the loader facts: with two copies and a hook rendered, each `POST_COLLISION` reason gives `project-loaded`, `id collides` gives `global-loaded`, and pre-collision reasons give `undetermined`. It passes on gsd-core 1.20.1 and 1.22.0. It fails on all six mutated loaders: early, swap, newreason, rootorder, earlyadd and moveadd.

## Round 8

Round 8 fixes the five findings of the round-8 re-review (CR-01, WR-01, WR-02, WR-03, IN-01). The four code findings had one cause: `gatherEvidence` did not collect facts the loader acts on, so they are fixed in one change to the evidence and the classifier. The tests came first.

| Commit | What |
|--------|------|
| `3d28aa3` | test(01): the WR-03 invariants and the r8 repros. Against the round-7 code these tests fail 55 times. |
| `e5ed361` | fix(01): CR-01, WR-01, WR-02 and IN-01 in `lib/install-state.cjs`, `lib/gate-bundle.cjs`, `memanto.cjs` and `README.md`. |

`npm test`: 488 tests, 487 pass, 0 fail, 1 skipped. The gates ran in the harness worktree `.claude/worktrees/agent-a4925451f902d53d9` (not the main checkout), with a temp `GSD_HOME` per test.

### CR-01: doctor said loaded ok and gate-bundle ok when no memanto gate rendered

- `declaredPoints` now renders `discuss:pre`, every point the doctor's own shipped `capability.json` declares, and the points the installed manifests declare. An installed manifest with `gates: []` can no longer hide the gate point.
- `render:discuss:pre` is ok only when a memanto hook of kind `gate` renders there.
- The evidence has `render.gate`. `loaded` and `gate-bundle` are ok only with it. A copy gsd-core accepted that renders no gate is `global-loaded-no-gate` or `project-loaded-no-gate` (error).
- With memanto enabled and no successful render, the state is `no-render-evidence`, an error that only hedges which copy the loader would pick.
- The impossible state at round-7 `:135`: an activated project copy that declares the gate, a rendered hook and no `id collides` is `project-loaded` (the accepted global copy would have made the project copy print `id collides`). When the project copy declares no gate, the state is `undetermined`.
- Repros: `gnogate` now gives `loaded`, `render:discuss:pre` and `gate-bundle` errors with "its capability.json declares no discuss:pre gate" and a reinstall-in-place fix. `twonogate` gives `global-loaded-no-gate`. `twoinvalid` gives `loaded` ok (the project copy loaded and its gate renders) and `gate-bundle` error: "the discuss:pre gate would run <global>/scripts/gate.cjs, but gsd-core loads the bundle at <project>".

### WR-01: a ledgered install with an unreadable manifest was called loaded, stray, and deleted by hand

- `lib/gate-bundle.cjs` adds `ledgerState(root)` (`committed`, `pending` or `none`) and `readManifest(root)`. The gate's own selection rule, `resolveGateBundle`, is unchanged and stays fail-closed for both cases.
- New states: `broken-install` (committed ledger entry, unreadable manifest; fix: "reinstall the <scope> copy in place ... [--scope project]") and `install-pending` (an `_pending` entry; fix: "finish or roll back the interrupted <scope> install of memanto").
- Stray detection, the "no ledger entry" text and `deleteFix` use the ledger: a ledgered copy is never stray and is reinstalled in place, never deleted by hand. `consent` reports a ledgered copy that `capability list` does not show.
- A silent skip (no reason, no hook) uses the unexplained wording for either scope, never "loaded".
- Repros: `gcorrupt` and `gpending` give `loaded` and `gate-bundle` errors with those fixes, no "stray" and no delete.

### WR-02: GSD_HOME at the project root was modelled as a trusted global copy; symlink aliases were two copies

- `memanto.cjs rootsAlias` mirrors `overlayRoots` (`capability-loader.cjs` 1.20.1 `:259-290`). It compares the two `.gsd/capabilities` roots by `fs.realpathSync`, treats a realpath failure as an alias, and demotes the global root to project scope when the project root has `.planning` or `.git`, unless the roots are provably distinct.
- The classifier models that one directory as a single project-scope copy, so `project-not-activated` and the re-consent fix apply in `loaded`, `gate-bundle` and `consent` alike. The capability-list "active in global scope" prefix is dropped for one physical directory.
- Repros: `homeplain` and `homesym` give one copy, `duplicate-install` ok, and "re-consent by reinstalling in the project: ... --scope project" in all three records. `homeproj` now names the project copy.
- `test/loader-drift.test.cjs` pins the demotion: realpath canonicalization, `hasGenuineProjectMarker(projectRoot)` with `.planning` and `.git`, `provablyDistinct = !globalCanon.realpathFailed && ...`, and `if (!provablyDistinct) globalScope = 'project'`. It passes on gsd-core 1.20.1 and 1.22.0 and fails on a 1.20.1 copy whose overlayRoots no longer demotes.

### WR-03: the invariants checked the classifier against itself

- The table derives every fact from the raw case (`factsOf`) and from a new `loaded` column in each case definition. The doctor tests derive them from the disk, from a `render-hooks` call of their own, and from the case (`loadedScope`). `assertDoctorConsistent` now passes `loadedScope` and `gateRendered` and requires `render:discuss:pre` to agree with the host.
- New shared rules in `test/helpers/install-invariants.cjs`:
  - positive evidence: without the memanto gate at `discuss:pre`, `loaded` and `gate-bundle` are never ok, and are errors when memanto is enabled;
  - cross-record: every record names the same loaded copy ("loads/loaded/keeps the <scope> ...", "loads memanto from <dir>", "loaded neither"), and it matches the case's loaded copy; hedged predictions are not claims;
  - `gate-bundle` ok only when the predicate runs the loaded copy, and ok in `gate-bundle` implies ok in `loaded`;
  - re-consent in `consent` implies re-consent in a not-ok `loaded` (the code now appends re-consent to every not-loaded fix when `capability list` reports a missing consent record);
  - an unledgered copy is never `consent` ok; a ledgered directory is never deleted or called stray; with one copy, no record names a copy in the other scope.
- `MD` is kept as a regression test: the cross-record rule rejects `duplicate-install` saying "neither" while `loaded` names the global copy.
- Mutation run (`scratchpad/r8/mutate8.cjs`, temp copies of the working tree). Each mutant runs the table with every per-case assertion stripped (only the shared rules can fail; the stripped unmutated table fails 0), then the full table plus the doctor repros (unmutated: 0 failures). All 15 mutants are caught:

| Mutant | What it breaks | Shared-rules table failures | Full run failures |
|--------|----------------|-----------------------------|-------------------|
| MD | duplicate-install says "neither" for global-loaded-no-gate | 3 | 5 |
| ME | gate-bundle mismatch downgraded to warn | 4 | 7 |
| MG | loaded and gate-bundle not-loaded errors downgraded to warn | 26 | 41 |
| MH | consent ok for a copy with no ledger row | 5 | 5 |
| MI | loaded fix for an unconsented copy is a global reinstall | 4 | 6 |
| MJ | CR-01 `:135` reverted (project copy assumed global) | 1 | 2 |
| MK | loaded without the gate rendering | 1 | 1 |
| MN | no render evidence classified as loaded from the ledger | 1 | 1 |
| MO | gate-bundle ok for a copy that renders no gate | 5 | 7 |
| ML | a broken or pending install treated as stray | 4 | 6 |
| MR | a ledgered copy deleted by hand | 1 | 1 |
| MM | the GSD_HOME-is-project copy modelled as global | 4 | 7 |
| MS | IN-01 hedge removed | 1 | 2 |
| MQ | `memanto.cjs` sameDir by path.resolve, not realpath | 0 (not in the table) | 1, the doctor shared rule "says both with one copy" (homesym) |
| MP | `memanto.cjs` renders only the installed manifest's points | 0 (not in the table) | 3, the doctor shared rule "doctor did not render discuss:pre" |

### IN-01: gate-bundle claimed a load without render evidence

`gate-bundle` now uses the hedge whenever no copy is known to have loaded: "by the loader's precedence gsd-core would load memanto from <dir>". With memanto enabled that state is an error (`no-render-evidence`, or `install-pending` for `gpending`). With memanto disabled `gate-bundle` is a warn, never ok. `loaded` is now printed whenever gsd-core is located and memanto is enabled, also when `capability list` fails, and render-hooks still runs in that case.

### Not changed

The reviewer's `r8.cjs` also has a `gtamper` mode (the global `scripts/gate.cjs` replaced after install). It is not one of the five findings: global bundles are not hash-bound by gsd-core, and doctor reports the gate as rendering and running the installed bundle. It is left as it is.

---

_Fixed: 2026-11-22T02:31:45Z (round 4), 2026-11-22T03:11:38Z (round 5), 2026-11-22T03:21:45Z (round 6), 2026-11-22T03:41:23Z (round 7), 2026-11-22T05:10:00Z (round 8)_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 8_
