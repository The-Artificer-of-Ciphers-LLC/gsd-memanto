---
phase: 01-walking-skeleton
reviewed: 2026-11-21T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - .github/workflows/ci.yml
  - .github/workflows/publish.yml
  - README.md
  - capability.json
  - lib/checks.cjs
  - lib/config.cjs
  - lib/gate-bundle.cjs
  - lib/gsd-host.cjs
  - lib/health.cjs
  - memanto.cjs
  - package.json
  - test/bundle.test.cjs
  - test/config.test.cjs
  - test/doctor.test.cjs
  - test/gate-bundle.test.cjs
  - test/gsd-host.test.cjs
  - test/health.test.cjs
  - test/release.test.cjs
  - test/stage-bundle.test.cjs
  - tools/stage-bundle.cjs
findings:
  critical: 2
  warning: 3
  info: 4
  total: 9
  necessity: 0
status: issues_found
---

# Phase 1: Code Review Report (re-review after fixes)

**Reviewed:** 2026-11-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 20 (the fix range `a04d2df..HEAD`)
**Status:** issues_found

## Summary

This is a re-review of the 14 fixes in `01-REVIEW-FIX.md`. `npm test` passes: 234 tests, 233 pass, 1 skipped, 0 fail. Every scratch reproduction used a temp `GSD_HOME` and a temp project, and the only network traffic went to closed local ports. The real `~/.gsd` was never touched.

### Status of the prior findings

| Prior | Verdict | Notes |
|-------|---------|-------|
| CR-01 | **Partially fixed, regression introduced** | The original scenario (a stray global `scripts/gate.cjs` next to a project install) now blocks. A real global install is still selected: the agent reproduced `[agent-id]` from the global gate. With neither scope installed the gate still blocks with `[gate-bundle]`. The new fall-through to the project scope, however, runs unconsented repo-planted code. See CR-01 below. The orchestrator's observation is confirmed: the block message prints the literal `${GSD_HOME:-$HOME}` (WR-01). |
| CR-02 | **Fixed for the reported shapes, residual leak** | `http://user:p/ss@host:8000` and `http://user:p#w@host` are now redacted. A password that begins with a port-like run of digits still parses as a valid URL and leaks through the health messages. See CR-02 below. |
| WR-01 | Fixed | Every host spawn is bounded and `ETIMEDOUT` is mapped. Tests use a stub that never exits. |
| WR-02 | Fixed | Project-local candidates are gone, `GSD_CORE_DIR` is terminal, and the runtime homes match the shim. |
| WR-03 | Fixed | `kind: 'env'` exists, and both the gate and doctor name the variable. |
| WR-04 | Fixed as specified, residual vector | `persist-credentials: false`, a step-scoped `GH_TOKEN` and an exact npm pin are all in place. Test-time code can still capture the token through `.git` (WR-02 below). |
| IN-01 to IN-07 | Fixed | IN-07 (necessity) was resolved by removing the duplicate check. `run-tests.cjs` remains the single floor, and a test pins it. |
| IN-08 | Fixed, minor residual | See IN-02 below. |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The gate falls through to a repo-planted project bundle when the global bundle has no ledger entry (unconsented code runs, gate fails open)

**File:** `capability.json:63` (`const r=[h,"."].find(ok)`), mirrored in `lib/gate-bundle.cjs:41-46`
**Issue:** gsd-core loads gates from a global bundle that has **no** ledger entry. A bundle merely dropped on disk "provides declarative surfaces" (`~/.claude/gsd-core/bin/lib/capability-loader.cjs:889-896`). Only command dispatch needs a committed entry. The new predicate rejects that global copy because it has no committed ledger entry, then tries `"."`. The project ledger and bundle are repo-plantable (gsd-core says so itself at `capability-loader.cjs:893-894`). The predicate checks no consent record, and its ledger test (`id === "memanto"`, no `_pending`) is weaker than gsd-core's `isValidLedgerEntry`.

**Reproduced** with a temp `GSD_HOME`:
1. The real bundle files were copied into `$GSD_HOME/.gsd/capabilities/memanto` with no ledger.
2. A project was set up with `agent_id: ""`, a planted `.gsd-capabilities.json` (`{"entries":{"memanto":{"id":"memanto"}}}`), a copied `capability.json`, and a `scripts/gate.cjs` that writes a marker file and exits 0.
3. `loop render-hooks discuss:pre` rendered one memanto gate. `check predicate` returned `{"block":false,"message":"command exited 0"}`, and the marker file existed.

The pre-fix predicate ran the global copy, which gsd-core loaded, so this scenario used to block. The fix therefore turned a fail-open into arbitrary execution of code from the repository, the exact thing project-scope consent exists to stop. No test covers "global present but unledgered, project planted". `test/gate-bundle.test.cjs:127-134` covers only the reverse case.
**Fix:** Follow gsd-core's own selection and fail closed when the choice is ambiguous. If the global directory holds a `capability.json` and has no pending entry, gsd-core's gate came from global. In that case run global only when it is installed, and block otherwise. Never fall through to the project:
```js
const gm=p.join(h,b,"capability.json");
const r = f.existsSync(gm) ? (ok(h) ? h : null) : (ok(".") ? "." : null);
```
The project branch is then reached only when the global directory has no manifest. In that case the rendered gate can only have come from the consented project bundle. Apply the same rule in `resolveGateBundle`. Add the reproduction above as a regression test that must return `block:true` and must not create the marker file.

### CR-02: Credential leak remains for passwords that start with port-like digits followed by `/`, `?` or `#`

**File:** `lib/health.cjs:47-64`, `lib/checks.cjs:120-138`
**Issue:** `http://u:12/x@host:8000` (user `u`, password `12/x`) is a VALID URL with host `u`, port `12` and path `/x@host:8000`. `validateEndpointUrl` accepts it. The `CREDENTIAL_SCHEMES` branch of `redactUrl` sees no userinfo and returns it unchanged (verified: `redactUrl("http://u:12/x@host:8000")` returns the input). The gate then probes `u:12` and prints `http://u:12/x@host:8000/health is not healthy (connection)` and the same string in the `curl` fix hint (`checks.cjs:132-137`). The whole password reaches the transcript. `http://user:123#w@host` leaks `123` in the same way after `displayBase` drops the hash. The CR-02 fix note claims "no part of the userinfo survives". That holds only for values that do not parse.
**Fix:** Do not reconstruct display URLs from a value that may be mis-parsed. If the raw configured value contains `@` after `scheme://`, display `<scheme>://<redacted>` and name the config key instead. Alternatively, have the health messages print only `memanto.<key>` and never the URL. Add both strings above to `test/health.test.cjs` and to the host-gate output test.

## Warnings

### WR-01: The `[gate-bundle]` block message prints the literal `${GSD_HOME:-$HOME}` and a weaker reinstall hint

**File:** `capability.json:63`
**Issue:** The text sits inside a single-quoted `node -e` program, so sh never expands it. gsd-core interpolates only `${PHASE_NUMBER|PHASE_DIR|PHASE_REQ_IDS}` (`gate-predicate-evaluator.cjs:45`). The agent reproduced the host message `... in ${GSD_HOME:-$HOME} or this project -> reinstall: gsd-tools capability install npm:@taoc/gsd-memanto --yes`. The user cannot tell which home was checked, and that matters most when `GSD_HOME` is set. The hint also differs from `reinstallFix()` (`memanto.cjs:57-62`). It does not pin a version and does not mention `--scope project`, so following it in a project-scope setup installs globally.
**Fix:** Print the resolved `h`, sanitized with the same control-character replacement as the `[gate-internal]` branch, for example `" in "+JSON.stringify(h).slice(0,150)+" or "+process.cwd()`. Use the same `--scope project` wording as `reinstallFix()`. Assert in `test/gate-bundle.test.cjs:149-157` that the message contains the temp home path and does not contain `${GSD_HOME`.

### WR-02: Release push credential is still reachable by code that ran during `npm test` (git hooks and the `origin` URL)

**File:** `.github/workflows/publish.yml:203-222`
**Issue:** The Test step (`:183-188`) runs gsd-core fetched from npm and the repo's own tests, which can write anywhere in the workspace. That includes `.git/hooks/pre-commit` and `pre-push`, and `remote.origin.url` in `.git/config`. The commit-and-tag step then runs `git commit` and `push origin` with `GH_TOKEN` in the step environment, which hooks inherit. The basic-auth header goes to whatever host `origin` names. This defeats the purpose of `persist-credentials: false`, the reason WR-04 was raised.
**Fix:** In that step, run git with `-c core.hooksPath=/dev/null`. Pass `--no-verify` to `commit` and `push`. Push to an explicit URL instead of `origin`: `git -c core.hooksPath=/dev/null -c "http.extraheader=..." push "https://github.com/${GITHUB_REPOSITORY}.git" "$1"`. Add a `test/release.test.cjs` assertion for both.

### WR-03: The doctor `gate-bundle` mismatch fix tells the user to remove the wrong copy

**File:** `memanto.cjs:276-282`
**Issue:** The hint always says to remove the scope that gsd-core did NOT load. Take the case of a hand-copied global bundle (loaded by gsd-core, not in the ledger) next to a legitimate project install. Doctor then says `gsd-tools capability remove memanto --scope project`. That deletes the consented install and keeps the copy that has no ledger entry. `capability remove --scope global` cannot clean up an unledgered directory either.
**Fix:** Name the specific bad copy. If the loaded scope is not `isInstalledBundle`, tell the user to delete that directory by hand and then reinstall. Only when both copies are installed should the hint use `capability remove --scope <other>`. Add a doctor test for the hand-copied-global case.

## Info

### IN-01: Probe `fix` strings bypass `clean()`

**File:** `memanto.cjs:75-87`
**Issue:** `probeRecord` sanitizes `id` and `message` but copies `fix` verbatim. That is the one field IN-06 meant to normalize, and it is printed by `renderText`.
**Fix:** `const fix = typeof c.fix === 'string' ? clean(c.fix, REASON_MAX) : '';`

### IN-02: `stage-bundle` still leaks temp directories on its failure paths

**File:** `tools/stage-bundle.cjs:77-94, 110, 124-130`
**Issue:** A `fail()` inside `stage()` (symlink or non-regular file) exits after `mkdtemp` and leaves `memanto-stage-*` behind. If `install()` fails with `res.error` or non-JSON output, it exits before `cleanup` is printed, so a fresh `memanto-home-*` is left without being named.
**Fix:** Remove the staging root before calling `fail` in `stage()`. Print or remove the fresh home on the failure paths of `install()`.

### IN-03: The "global preferred" test cannot tell the global gate from a `[gate-bundle]` block

**File:** `test/gate-bundle.test.cjs:159-167`
**Issue:** The test asserts only `block === true`. A regression that rejected both scopes would also pass. The agent confirmed separately that the global gate runs (`[agent-id]`), but the test does not pin that.
**Fix:** Add `assert.match(verdict.message, /BLOCKED \[agent-id\]/)`.

### IN-04: The predicate duplicates `lib/gate-bundle.cjs` by hand, and `locateGsdTools` keeps a dead parameter

**File:** `capability.json:63`, `lib/gate-bundle.cjs:1-6`, `lib/gsd-host.cjs:123-124`
**Issue:** Two copies of the selection rule are kept in step only by a comment. The CR-01 fix must change both. Nothing checks mechanically that the inline rule and the module agree outside the scenario tests. `locateGsdTools` documents `projectRoot` as "accepted ... and deliberately unused" while `memanto.cjs` still passes it.
**Fix:** Add a table-driven test that runs `resolveGateBundle` and the inline predicate over the same fixture matrix. Drop the unused argument at the call site.

---

_Reviewed: 2026-11-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
