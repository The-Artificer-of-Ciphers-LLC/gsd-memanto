---
phase: 01-walking-skeleton
fixed_at: 2026-11-22T00:51:15Z
review_path: .planning/phases/01-walking-skeleton/01-REVIEW.md
iteration: 1
findings_in_scope: 14
fixed: 14
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report

**Fixed at:** 2026-11-22T00:51:15Z
**Source review:** .planning/phases/01-walking-skeleton/01-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 14 (the owner decided to fix every finding: CR, WR and IN, including the IN-07 necessity finding)
- Fixed: 14
- Skipped: 0

Every behaviour change was written test-first: the failing test was run and seen to fail, then the fix was applied. One commit per finding.

| Finding | Status | Commit |
|---------|--------|--------|
| CR-01 | fixed: requires human verification | 851e2c2 |
| CR-02 | fixed | 7ca5c6d |
| WR-01 | fixed | 226d7cb |
| WR-02 | fixed | 4155647 |
| WR-03 | fixed | 92647ac |
| WR-04 | fixed | 695df2d |
| IN-01 | fixed | 173df08 |
| IN-02 | fixed | c101fb2 |
| IN-03 | fixed | 4d5e861 |
| IN-04 | fixed | 8c52145 |
| IN-05 | fixed | ca7a95f |
| IN-06 | fixed | 2e344c8 |
| IN-07 | fixed: requires human verification | 8025854 |
| IN-08 | fixed | d684020 |

## Fixed Issues

### CR-01: The gate runs a gate.cjs taken from the global directory, not from the consented bundle

**Files modified:** `capability.json`, `lib/gate-bundle.cjs` (new), `memanto.cjs`, `README.md`, `test/gate-bundle.test.cjs` (new), `test/doctor.test.cjs`, `test/bundle.test.cjs`
**Commit:** 851e2c2
**Applied fix:** The predicate is now `exec node -e '...'`: POSIX sh, 1072 characters. It decides which bundle to run before it runs any bundle code. It tries the global root first, because gsd-core keeps the global copy, and then the project root. A root is used only when `<root>/.gsd/capabilities/memanto/capability.json` has id `memanto` AND `<root>/.gsd-capabilities.json` holds a committed `entries.memanto`, meaning no `_pending` and an `id` of `memanto`. Both files must be regular files. If neither root qualifies, the predicate exits 1 with `memanto: BLOCKED [gate-bundle]` plus the break-glass line. A failure inside `require` blocks with `[gate-internal]`.

Doctor has a new check, `gate-bundle`, backed by `lib/gate-bundle.cjs`, which applies the same rule. It reports an error in three cases:
- the resolved bundle differs from the bundle gsd-core loaded
- a bundle is loaded but none resolves
- a scope directory holds a `scripts/gate.cjs` that is not part of an installed bundle

Tests reproduce the verifier's scenario: a project-scope install, an empty agent_id, and a planted global `gate.cjs` that runs `process.exit(0)`. The gate returns `block:true` and doctor reports `gate-bundle` as an error. Further tests cover:
- a planted global manifest with no ledger entry
- a healthy project install that passes
- no installed bundle, which blocks with `[gate-bundle]`
- global preferred over project
- the 4096-character limit and `sh -n`

The status is "requires human verification" because this changes the gate's selection logic.

### CR-02: redactUrl leaks userinfo for unparseable URLs

**Files modified:** `lib/health.cjs`, `test/health.test.cjs`
**Commit:** 7ca5c6d
**Applied fix:** Parsed http(s), ws(s) and ftp URLs still have their userinfo cleared through `URL`. Any other value, including one that does not parse, loses everything from after `scheme://` up to its last `@`. This is tested two ways for passwords holding `/`, `#`, `?`, `@` and a space: on the function, and through the real host gate output, which must contain neither the password nor any `@`.

### WR-01: Doctor host spawns have no timeout

**Files modified:** `lib/gsd-host.cjs`, `memanto.cjs`, `test/gsd-host.test.cjs`
**Commit:** 226d7cb
**Applied fix:** The existing `PROBE_TIMEOUT_MS` (15000) now lives in `lib/gsd-host.cjs`. `memanto.cjs` imports it and re-exports it, and no new numeric timeout was added. `runTools` passes `timeout` and `killSignal: 'SIGKILL'`. `ETIMEDOUT` maps to `timed out after N ms and was stopped` in `hostIdentity`, `capabilityList` and `renderHooksAt`. Before the fix, the new tests hung the test file on a `gsd-tools.cjs` stub that never exits. Now they pass in under a second, using an injected 300 ms timeout. No timeout-guard hook rejected the edit.

### WR-02: Doctor executes a project-planted gsd-tools.cjs; GSD_CORE_DIR comment wrong

**Files modified:** `lib/gsd-host.cjs`, `test/gsd-host.test.cjs`, `README.md`
**Commit:** 4155647
**Applied fix:**
- Project-local candidates are removed, so a project-local `gsd-tools.cjs` is never executed.
- `GSD_CORE_DIR`, when set, is the only candidate, which matches the "wins outright" comment. An identity failure there is terminal.
- The runtime config homes that the gsd-core shim searches are added after `~/.claude`, including the codex, antigravity, cursor and copilot homes.

The tests prove three things: a planted stub that records its own execution never runs, `GSD_CORE_DIR` is terminal, and the runtime homes are found.

### WR-03: An invalid GSD_PROJECT/GSD_WORKSTREAM produces a "make GSD_PROJECT readable" fix

**Files modified:** `lib/config.cjs`, `lib/checks.cjs`, `memanto.cjs`, `README.md`, `test/config.test.cjs`, `test/doctor.test.cjs`
**Commit:** 92647ac
**Applied fix:** The resolver now returns `kind: 'env'` together with `variable`. The gate's `config-unreadable` line reads `<VAR> is invalid (...) -> unset <VAR> or set it to a name without '/', '\' or '..'`. Doctor's `enabled` record names the variable instead of a config file.

### WR-04: Release job leaves a write-scoped token on disk and installs a floating npm

**Files modified:** `.github/workflows/publish.yml`, `test/release.test.cjs`
**Commit:** 695df2d
**Applied fix:**
- The checkout step sets `persist-credentials: false`.
- `GH_TOKEN` moves from the job env to the three steps that call GitHub. The npm and test steps no longer see it.
- The commit and tag step pushes with a masked, per-command `http.extraheader`.
- npm is pinned to `npm@11.21.3`, the latest 11.x, which keeps the >=11.15 requirement.

The file name `publish.yml` and the `npm-publish` environment are unchanged. actionlint passes on both workflows.

### IN-01: package.json files lists a directory that does not exist

**Files modified:** `package.json`, `test/bundle.test.cjs`, `test/release.test.cjs`
**Commit:** 173df08
**Applied fix:** `fragments` is removed from `files` and from the pack whitelist. A test fails when any `files` entry does not exist. The version stays 0.1.0.

### IN-02: The DRY_RUN env variable is never read

**Files modified:** `.github/workflows/publish.yml`, `test/release.test.cjs`
**Commit:** c101fb2
**Applied fix:** `DRY_RUN` is removed. A test fails on any job-level env variable that no step reads.

### IN-03: Doctor's control-character filter omits U+2028/U+2029

**Files modified:** `lib/health.cjs`, `lib/checks.cjs`, `memanto.cjs`, `test/doctor.test.cjs`
**Commit:** 4d5e861
**Applied fix:** `lib/health.cjs` exports a single `CONTROL_CHARS` regex. `checks.cjs` and `memanto.cjs` use it instead of their own copies. A test passes a `GSD_CORE_DIR` that contains U+2028 and U+2029 and checks both the raw and text output.

### IN-04: enginesCheck falls back to capability.json in the process cwd

**Files modified:** `memanto.cjs`, `test/doctor.test.cjs`
**Commit:** 8c52145
**Applied fix:** For an unknown scope there is no read, and the output says `(unknown range)`. `enginesCheck` is exported for the test.

### IN-05: Endpoint URLs trimmed silently while agent_id whitespace blocks

**Files modified:** `lib/health.cjs`, `lib/checks.cjs`, `README.md`, `test/health.test.cjs`
**Commit:** ca7a95f
**Applied fix:** The agent chose blocking for both, which is the reviewer's preferred option (the brief allowed either). A value that is only whitespace counts as empty. Leading or trailing whitespace on a URL blocks with `memanto.<key> has leading or trailing whitespace`, and no probe is sent. README documents the single rule.

### IN-06: Doctor trusts probe records; renderText runs outside the try

**Files modified:** `memanto.cjs`, `test/doctor.test.cjs`
**Commit:** 2e344c8
**Applied fix:** `probeRecord` turns a record that is not an object, or one whose status is not ok/warn/error, into an error with a fix hint. All four fields are now strings. Rendering moved inside the try/catch.

### IN-07: CI repeats the "more than one test" assertion (necessity)

**Files modified:** `.github/workflows/ci.yml`, `.github/workflows/publish.yml`, `test/release.test.cjs`
**Commit:** 8025854
**Applied fix:** The awk re-checks are removed, along with the `tee test.log` they needed. `tools/run-tests.cjs` remains the single check. A test pins this in place. The status is "requires human verification" because this is a necessity finding that removes code.

### IN-08: tools/stage-bundle.cjs leaves temp directories behind

**Files modified:** `tools/stage-bundle.cjs`, `README.md`, `test/stage-bundle.test.cjs` (new)
**Commit:** d684020
**Applied fix:** The staging root is deleted after an install. The directories the caller still owns are listed in `cleanup` (in `--json` output) or on a `cleanup:` line: the staged root for `--stage-only`, and a fresh temp `GSD_HOME`.

## Verification

- `npm test`: 234 tests, 233 pass, 0 fail, 1 skipped (the env-gated Q3 installer test). The baseline before the fixes was 188 tests, 187 pass, 1 skipped.
- Where the gates ran: all tests and actionlint ran in the agent worktree `.claude/worktrees/agent-a02337de7c9d729d3`, which is based on main at a04d2df. The repo has no dependencies and gsd-core is the installed `~/.claude/gsd-core` 1.20.1, so the numbers can be reproduced from the main checkout after a merge.
- Every host install used a temp `GSD_HOME`. The only network traffic was to local fake `/health` servers, plus one read-only `npm view npm versions` call to choose the npm pin. No push, publish or merge.

---

_Fixed: 2026-11-22T00:51:15Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
