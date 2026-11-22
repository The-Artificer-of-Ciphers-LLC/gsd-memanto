---
phase: 01-walking-skeleton
reviewed: 2026-11-22T01:33:28Z
depth: standard
files_reviewed: 15
files_reviewed_list:
  - .github/workflows/publish.yml
  - README.md
  - capability.json
  - lib/checks.cjs
  - lib/gate-bundle.cjs
  - lib/gsd-host.cjs
  - lib/health.cjs
  - memanto.cjs
  - test/doctor.test.cjs
  - test/gate-bundle.test.cjs
  - test/gsd-host.test.cjs
  - test/health.test.cjs
  - test/release.test.cjs
  - test/stage-bundle.test.cjs
  - tools/stage-bundle.cjs
findings:
  critical: 0
  warning: 2
  info: 2
  total: 4
  necessity: 0
status: issues_found
---

# Phase 1: Code Review Report (round 3, re-review of the round-2 fixes)

**Reviewed:** 2026-11-22T01:33:28Z
**Depth:** standard
**Files Reviewed:** 15 (`git diff 38a9ccf^1 HEAD -- . ':!.planning'`)
**Status:** issues_found

## Summary

This round re-reviews the nine round-2 fixes, `22e0589..38a9ccf`. `npm test` reports 273 tests: 272 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network traffic went to the test helper's local fake API and to closed local ports. The real `~/.gsd` was not touched. The necessity reference was not loaded for this round. No reachable guard was found whose guarded state cannot occur, so the review records 0 necessity findings.

Both critical findings are closed. The gate-bundle selection now matches gsd-core 1.20.1. It was checked against `capability-loader.cjs` (`overlayRoots`, the per-candidate loop, `ledgerOverlayIds`, the project consent check) and against `check predicate` (cwd is `findProjectRoot` after the worktree remap, the same root the loader uses). It was also checked end to end with the real host:

- A global-only install renders the gate and passes with healthy config. It blocks with `[agent-id]` when the agent id is empty.
- A project-only install passes, including from a project subdirectory.
- A planted nested `.gsd/capabilities/memanto` plus ledger in a subdirectory never runs (its marker file was never created).
- With a hand-copied global bundle next to a consented project install, the loader keeps the global copy and records the project copy as `id collides`. The predicate blocks.

The agent found no layout in which project-tree code runs unless gsd-core rendered the gate from a consented bundle in that same scope.

Two warnings and two info items remain. One warning is a pre-existing credential echo that the CR-02 rework did not cover. The other warning and both info items were introduced by the round-2 fixes.

### Status of the round-2 findings

| Round-2 | Verdict | Notes |
|---------|---------|-------|
| CR-01 | Fixed, complete | When a global `capability.json` exists, the predicate and `resolveGateBundle` (`lib/gate-bundle.cjs:71-74`) run global or block, and never fall back to the project copy. They run the project copy only when no global manifest exists, and gsd-core can then only have loaded the consented project copy. The committed-entry shape matches `isValidLedgerEntry` (`capability-ledger.cjs:289-319`). The checks below agree with gsd-core or fail closed: a pending global entry (gsd-core defers it and loads the project copy, so the predicate blocks), a global dir without a manifest, a symlinked or non-regular manifest, and `GSD_HOME` aliasing the project root (gsd-core demotes that to consent-required). The 12-case matrix and the reviewer reproduction are regression tests. |
| CR-02 | Fixed for every value containing `@`, residual for values without one | Values with `@` are either cleanly stripped or shown as `<scheme>://<redacted>`, and an ambiguous `@` is never probed. The Basic header goes only to the configured host, with redirects not followed. Both effects of the new rejection are covered under the new findings: a residual leak for values without an `@` (WR-01) and legitimate URLs that are now blocked (IN-01). |
| WR-01 | Fixed | Both `[gate-bundle]` lines print the expanded, sanitized paths and a version-pinned hint. A test pins the version against the manifest. |
| WR-02 | Fixed, one new robustness gap | The `test` job holds `contents: read` only, with no id-token and no environment. The `release` job has `needs: test`, runs on a fresh runner, and runs no repo code (`--ignore-scripts` everywhere; the repo `.npmrc` holds only `save-exact=true`). No artifact or cache moves between the jobs. Commit and tag hold no token. The push step has hooks off, `--no-verify`, global and system config off, and an explicit URL. The bump pin rewrite is correct: the regex stops at the space before `--yes`, both pins in `capability.json` are rewritten, and the heredoc re-verifies every gate pin. The config refusal check is placed after npm staging and never runs in dry-run (WR-02 below). |
| WR-03 | Fixed (hint correct), message inaccurate | The fix names the stray copy and never removes an installed bundle. The accompanying message names the wrong loaded copy (IN-02 below). |
| IN-01 | Fixed | `probeRecord` cleans `fix` (`memanto.cjs:81-82`). |
| IN-02 | Fixed | `stage()` removes its root on any throw. `install()` removes a fresh home on start or JSON failure. A non-`installed` status prints the `cleanup:` line before failing. |
| IN-03 | Fixed | `test/gate-bundle.test.cjs:241-242`. |
| IN-04 | Fixed | The table-driven matrix is at `test/gate-bundle.test.cjs:264-303`. The dead `projectRoot` was dropped from `memanto.cjs:366`. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: A credential URL without an ASCII `@` is echoed verbatim, password included

**File:** `lib/health.cjs:79` (`if (!s.includes('@')) return cap(s);`), reached from `lib/checks.cjs:118`
**Issue:** `redactUrl` redacts only values that contain `@`. A value that carries a password but has no literal `@` fails to parse, gets reason `invalid-url`, and is printed whole on the gate's stderr and in doctor output. The README (`README.md:80`) now tells users to "percent-encode ... the at sign as `%40`". That makes over-encoding the separator itself a likely mistake. An IME full-width `＠` causes the same leak.

**Reproduced** with a temp project whose `.planning/config.json` sets `backend_url` to `http://alice:s3cret%40memanto.internal:8000` and `api_url` to `http://alice:s3cret＠memanto.internal:8000`. Running `node scripts/gate.cjs` printed:
`memanto: BLOCKED [backend-url] memanto.backend_url is not an http(s) URL: http://alice:s3cret%40memanto.internal:8000 -> ...`
The `api-url` line showed the full-width value the same way. Exit code was 1. No probe was sent. The README's claim that "no part of the password reaches the transcript" is therefore false for these inputs.
**Fix:** Never echo the authority of a value that fails validation. In `redactUrl`, take the text after `scheme://` up to the first `/`, `?` or `#`. If it contains `:`, `%40`, `@` or `＠`, print `<scheme>://<redacted>` plus the rest. A simpler option is to print only the key name for `invalid-url`:
```js
// lib/health.cjs, redactUrl
const m = SCHEME_PREFIX.exec(s);
if (!s.includes('@')) {
  const auth = m ? s.slice(m[0].length).split(/[/?#]/)[0] : s;
  if (/[:＠]|%40/i.test(auth) && withoutUserinfo(s) === null && !isPlainHostPort(auth)) return cap(`${m ? m[0] : ''}${REDACTED}`);
  return cap(s);
}
```
`isPlainHostPort` returns true for `host` or `host:digits`. Add both strings above to `test/health.test.cjs` and to the host-gate output test.

### WR-02: The release's git-config refusal check runs only after npm staging and never in dry-run

**File:** `.github/workflows/publish.yml:223-229, 247-262`
**Issue:** The check `git config --local --get-regexp '^(url|http|credential|include|includeif)\.'` runs inside the push step. That step comes after `npm stage publish` and is skipped when `dry-run` is true. The check reads only the checkout's local config, and no step between checkout and push writes a matching key. Nothing on the runner was verified. The test (`test/release.test.cjs`) uses synthetic config files only. Suppose `actions/checkout@v7` (or a later bump) leaves any `includeIf.*`/`http.*` entry in `.git/config`, for example from its separate-credentials-file mechanism. Then every real release stages a version on npm and only then refuses to push, and that has to be undone by hand with `npm stage reject`. A dry run cannot reveal the problem. Separately, `--get-regexp` prints each matching key's value to the job log, so a planted `http.extraheader` value would be printed there (it is masked only if GitHub recognizes it).
**Fix:** Move the refusal check into its own step right after checkout. It needs no token and must run on every run, including dry-run. Keep the re-check in the push step as well. Print key names only:
```yaml
- name: Refuse a git config that could redirect or capture the push credential
  shell: bash
  run: |
    set -euo pipefail
    export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
    if git config --local --name-only --get-regexp '^(url|http|credential|include|includeif)\.'; then
      echo "refusing: the checkout's git config holds url/http/credential/include keys (names above)" >&2
      exit 1
    fi
```
Use `--name-only` in the push step as well. Add a `test/release.test.cjs` assertion that this step has no `if: !inputs.dry-run` and comes before `Stage the release on npm`.

## Info

### IN-01: `ambiguous-userinfo` blocks credential-free URLs that contain `@`, and its message says "malformed credentials"

**File:** `lib/health.cjs:58-60, 66-69`; `lib/checks.cjs:115-116`
**Issue:** `withoutUserinfo` returns null whenever there is no userinfo. So `http://host:8000/a@b`, `http://host/?x=a@b` and `http://@host` all fail with `ambiguous-userinfo`. The message then says the key "has malformed credentials", but these URLs carry none. A Memanto base URL is unlikely to need an `@` in its path or query, so the impact is low.
**Fix:** When the parsed URL has no `username` and no `password`, and its `host` is non-empty, accept it as unambiguous. A misparse can only move a password into the host:port or path when userinfo was intended. For example, flag the value only when the text between `://` and the first `@` contains `:`, or when there is no userinfo while the authority as typed contains `@`. Otherwise use the wording "contains an '@' outside user:password@".

### IN-02: The doctor `gate-bundle` message names the project copy as loaded when gsd-core loaded the hand-copied global copy

**File:** `memanto.cjs:278-279, 309-311`
**Issue:** `loaded` comes from the first `active` row of `capability list`. That list is built from the ledger, so an unledgered global bundle has no row. The agent reproduced a hand-copied global bundle next to a consented project install. The list showed only `[project, active]`. The loader's `_overlay.warnings` recorded the project copy as skipped (`id collides with an already-registered capability`), which means gsd-core loaded the global copy. Doctor still says "gsd-core loaded memanto from <project dir>". That contradicts `README.md` ("gsd-core loads that global copy, even when no ledger lists it") and the predicate's own `[gate-bundle]` text. The fix hint is right: it deletes the global copy and keeps the project install. The comment at `memanto.cjs:287-288` repeats the same assumption.
**Fix:** If `hasManifest(gsdHome)` is true and the global copy is not installed, report the loaded copy as the global directory, whatever the list's active row says. Better still, take the loaded scope from `loadRegistry`'s `_overlay.warnings`/accepted set rather than from `capability list`. Extend the doctor test at `test/gate-bundle.test.cjs:216-228` to assert that the message names the global directory as the loaded copy.

---

_Reviewed: 2026-11-22T01:33:28Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
