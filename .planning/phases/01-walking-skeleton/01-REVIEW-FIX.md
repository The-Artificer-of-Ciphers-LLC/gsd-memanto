---
phase: 01-walking-skeleton
fixed_at: 2026-11-22T02:31:45Z
review_path: .planning/phases/01-walking-skeleton/01-REVIEW.md
iteration: 4
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report (round 4)

**Fixed at:** 2026-11-22T02:31:45Z
**Source review:** .planning/phases/01-walking-skeleton/01-REVIEW.md (round 4, re-review of the round-3 fixes)
**Iteration:** 4

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

---

_Fixed: 2026-11-22T02:31:45Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 4_
