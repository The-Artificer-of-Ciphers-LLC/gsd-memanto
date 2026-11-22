---
phase: 01-walking-skeleton
fixed_at: 2026-11-22T01:24:13Z
review_path: .planning/phases/01-walking-skeleton/01-REVIEW.md
iteration: 2
findings_in_scope: 9
fixed: 9
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report (round 2)

**Fixed at:** 2026-11-22T01:24:13Z
**Source review:** .planning/phases/01-walking-skeleton/01-REVIEW.md (re-review after the round-1 fixes)
**Iteration:** 2

Round 1 (14 findings, all fixed) is commits `851e2c2..d684020`.

**Summary:**
- Findings in scope: 9 (owner decision: every finding, CR, WR and IN, no deferrals)
- Fixed: 9
- Skipped: 0
- Verification: run in the main checkout of this agent worktree (`.claude/worktrees/agent-ad14e8f87b9111845`), not a separate review-fix worktree. `npm test`: 273 tests, 272 pass, 0 fail, 1 skipped. `actionlint .github/workflows/publish.yml` is clean. Every host run used a temp `GSD_HOME`. No Memanto server was contacted, and the only network traffic went to local fake servers.

## Round-2 fixes

| Finding | Status | Commit | Files |
|---------|--------|--------|-------|
| CR-01 | fixed: requires human verification | `d189838` | `capability.json`, `lib/gate-bundle.cjs`, `README.md`, `test/gate-bundle.test.cjs` |
| CR-02 | fixed: requires human verification | `339e977` | `lib/health.cjs`, `lib/checks.cjs`, `README.md`, `test/health.test.cjs` |
| WR-01 | fixed | `fcb271e` | `capability.json`, `README.md`, `test/gate-bundle.test.cjs` |
| WR-02 | fixed | `bb0da46` | `.github/workflows/publish.yml`, `test/release.test.cjs` |
| WR-03 | fixed: requires human verification | `527f262` | `memanto.cjs`, `README.md`, `test/gate-bundle.test.cjs` |
| IN-01 | fixed | `7387695` | `memanto.cjs`, `test/doctor.test.cjs` |
| IN-02 | fixed | `daf5019` | `tools/stage-bundle.cjs`, `test/stage-bundle.test.cjs` |
| IN-03 | fixed | `820bbca` | `test/gate-bundle.test.cjs` |
| IN-04 | fixed | `6243b0e` | `memanto.cjs`, `lib/gsd-host.cjs`, `test/gsd-host.test.cjs`, `test/gate-bundle.test.cjs` |

## Fixed Issues

### CR-01: The gate falls through to a repo-planted project bundle when the global bundle has no ledger entry

**Commit:** `d189838`
**Applied fix:** The predicate and `resolveGateBundle` follow gsd-core's own selection. If `<GSD_HOME>/.gsd/capabilities/memanto/capability.json` exists, they run the global bundle only when it is installed and block with `[gate-bundle]` otherwise. They never fall back to the project copy in that case. The project copy is used only when no global `capability.json` exists and the project ledger holds a committed entry. The committed-entry check now also requires what gsd-core's `isValidLedgerEntry` requires: string `version`, `source` and `integrity`, `files` and `sharedEdits` arrays, and no own `_pending`. The reviewer's reproduction is now a regression test: a hand-copied global bundle, plus a planted project bundle and ledger whose `gate.cjs` writes a marker. It returns `block:true` with `[gate-bundle]`, and no marker file is created. The predicate is still POSIX sh and is now 1755 characters long.

### CR-02: Credential leak for passwords that start with port-like digits followed by `/`, `?` or `#`

**Commit:** `339e977`
**Applied fix:** `redactUrl` echoes a value that contains `@` only when it is a well-formed `user:password@host` URL: it parses with a credential scheme, carries userinfo, and no `@` remains once that userinfo is removed. Any other value with `@` is printed as `<scheme>://<redacted>`, so nothing before its last `@` is ever echoed. `validateEndpointUrl` now rejects such values with the new reason `ambiguous-userinfo`. The gate therefore blocks on `backend-url`/`api-url` and never probes the misparsed host. The old probe sent `GET /x@host:8000/health` to host `u`, so the password went over the network as well. `displayBase` makes the redaction decision on the whole URL before it drops the fragment. Tests cover `http://u:12/x@host:8000`, `http://user:123#w@host` and a `?` variant in four ways: `redactUrl`, `validateEndpointUrl`, `displayBase` (the health line and the curl hint), and end to end through the host gate. Another test uses a misparsed URL that points at a live local fake server and proves the server receives no request. The new message fits the 250-character line cap.

### WR-01: The `[gate-bundle]` block message prints the literal `${GSD_HOME:-$HOME}`

**Commit:** `fcb271e`
**Applied fix:** Both `[gate-bundle]` lines print the expanded directories they checked. These are computed in the node program from `process.env.GSD_HOME || os.homedir()` and the project cwd, and sanitized like the `[gate-internal]` branch. The no-bundle line uses doctor's `reinstallFix()` wording: `gsd-tools capability install npm:@taoc/gsd-memanto@0.1.0 --yes (add --scope project inside a project for project scope)`. A test requires every reinstall hint in the predicate to name the manifest version. The WR-02 commit extends the release bump to rewrite that pin.

### WR-02: Release push credential reachable by code that ran during `npm test`

**Commit:** `bb0da46`
**Applied fix:**
- `publish.yml` now has a `test` job that holds `contents: read` only, with no id-token and no environment. It runs the host install, `npm test` and `npm pack --dry-run --ignore-scripts`.
- The `release` job (`needs: test`, environment `npm-publish`, file name unchanged) starts on a fresh runner and runs no repo code. `npm version` and `npm stage publish` use `--ignore-scripts`.
- Commit and tag run with `core.hooksPath=/dev/null` and `--no-verify`, in a step with no `GH_TOKEN`.
- A separate push step holds the token. It sets `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1`, refuses when the local config has `url`, `http`, `credential` or `include*` keys, and pushes with `--no-verify` to `https://github.com/${GITHUB_REPOSITORY}.git` instead of `origin`.
- The bump also rewrites the gate's version-pinned reinstall hint.

Tests in `test/release.test.cjs`:
- They read the refusal regex from the workflow and prove it hermetically. `git config --file` runs over plain fixture files in an `os.tmpdir()` directory. A clean config exits 1. Each planted `insteadOf`, `pushInsteadOf`, `http.extraheader`, `http.proxy`, `credential.helper`, `include.path` and `includeIf` key exits 0.
- They run the bump heredoc on a temp copy of `capability.json`.
- They pin the job split, the `--ignore-scripts` flags and the three steps allowed to hold `GH_TOKEN`.

No repository `.git/config` was written.

### WR-03: The doctor `gate-bundle` mismatch fix tells the user to remove the wrong copy

**Commit:** `527f262`
**Applied fix:** No fix hint tells the user to remove an installed bundle or the installed copy gsd-core loaded. When no installed bundle can run, doctor names the copy that has no committed ledger entry. It says to delete that copy by hand (`capability remove` cannot remove an unledgered copy) and to keep the installed bundle, naming its path. When gsd-core skipped an installed global bundle and loaded the project one, the hint points at the load error, or at reinstalling that bundle. New doctor test: a project install next to a hand-copied global bundle. The hint names the global directory, keeps the project install, and contains no `capability remove memanto --scope project`.

### IN-01: Probe `fix` strings bypass `clean()`

**Commit:** `7387695`
**Applied fix:** `probeRecord` passes `fix` through `clean(c.fix, REASON_MAX)`. The test feeds fixes containing CR/LF, U+2028 and a 5000-character string, and checks that they come back neutralized and capped at 300 characters.

### IN-02: `stage-bundle` leaks temp directories on its failure paths

**Commit:** `daf5019`
**Applied fix:** Failures throw `StageError`. `stage()` removes its staging root before it rethrows, `install()` removes a fresh temp home before it fails, and `main()` prints the error and exits 1. `main()` runs only when the script is executed directly. Tests:
- A failed install (an empty `GSD_CORE_DIR`) run with a private `TMPDIR` leaves no `memanto-*` entry.
- In-process `stage()` calls over a temp fake repo with a symlink, and with a non-regular file, leave the injected `tmpRoot` empty.

### IN-03: The "global preferred" test cannot tell the global gate from a `[gate-bundle]` block

**Commit:** `820bbca`
**Applied fix:** The test now requires `memanto: BLOCKED [agent-id]` and no `[gate-bundle]`. Only a test was changed; there was no behaviour change and so no failing test first.

### IN-04: The predicate duplicates `lib/gate-bundle.cjs`, and `locateGsdTools` keeps a dead parameter

**Commit:** `6243b0e`
**Applied fix:** A 12-case table-driven test runs the real predicate command (`sh -c`, temp `GSD_HOME`, fixture `gate.cjs` files that print their bundle directory) and `resolveGateBundle` over the same fixtures. Both must pick the expected scope or block. The cases:
- global valid
- global and project both installed
- global unledgered
- planted project ledger with an unledgered global
- global absent with the project ledgered
- a stray global `gate.cjs` only
- project unledgered
- neither scope
- a pending global entry
- a global entry with no `version`
- a global manifest with another id
- a project entry with no `files`

The unused `projectRoot` was dropped from `memanto.cjs` and from the `lib/gsd-host.cjs` comment, and a test pins that no call passes it.

## Notes

- Test-first: every behaviour change got its failing test first (CR-01, CR-02, WR-01, WR-03, IN-01, IN-02, and the WR-02 push/commit assertions). The WR-02 job-split and bump tests were written after the workflow edit, but both fail against the pre-fix workflow, which had one job and did not rewrite the pin. IN-03 and IN-04 add or strengthen tests only.
- WR-03 follows the hosts' own `capability list` report. With a hand-copied global bundle next to a consented project install, the list marks the project row active, and doctor reports from that.
- `package.json` and `capability.json` stay at version 0.1.0.

---

_Fixed: 2026-11-22T01:24:13Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
