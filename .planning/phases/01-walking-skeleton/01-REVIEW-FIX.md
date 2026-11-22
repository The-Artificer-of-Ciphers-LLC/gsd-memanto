---
phase: 01-walking-skeleton
fixed_at: 2026-11-22T01:55:49Z
review_path: .planning/phases/01-walking-skeleton/01-REVIEW.md
iteration: 3
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 1: Code Review Fix Report (round 3)

**Fixed at:** 2026-11-22T01:55:49Z
**Source review:** .planning/phases/01-walking-skeleton/01-REVIEW.md (round 3, re-review of the round-2 fixes)
**Iteration:** 3

Earlier rounds:
- Round 1 (14 findings, all fixed): commits `851e2c2..d684020`.
- Round 2 (9 findings, all fixed): commits `d189838..6243b0e`.

**Summary:**
- Findings in scope: 4 (owner decision: every finding, WR and IN, no deferrals, no skips)
- Fixed: 4
- Skipped: 0
- Every fix was written test-first: the new or changed tests failed before the code change and passed after it.
- Verification: run in this agent worktree (`.claude/worktrees/agent-a1170882395c3330a`), not a separate review-fix worktree. `npm test`: 327 tests, 326 pass, 0 fail, 1 skipped. `actionlint .github/workflows/publish.yml` is clean. Every host run used a temp `GSD_HOME`. No Memanto server was contacted, and the only network traffic went to local fake servers and closed local ports. Versions stay `0.1.0`.

## Round-3 fixes

| Finding | Status | Commit | Files |
|---------|--------|--------|-------|
| WR-01 | fixed: requires human verification | `ebb2d4c` | `lib/health.cjs`, `lib/checks.cjs`, `README.md`, `test/health.test.cjs`, `test/doctor.test.cjs` |
| WR-02 | fixed | `e7857a4` | `.github/workflows/publish.yml`, `test/release.test.cjs` |
| IN-01 | fixed: requires human verification | `8fe7dc3` | `lib/health.cjs`, `lib/checks.cjs`, `README.md`, `test/health.test.cjs` |
| IN-02 | fixed: requires human verification | `76f329d` | `memanto.cjs`, `README.md`, `test/gate-bundle.test.cjs` |

## Fixed Issues

### WR-01: A credential URL without an ASCII `@` is echoed verbatim, password included

**Commit:** `ebb2d4c`
**Applied fix:** One classifier, `classifyUrl` in `lib/health.cjs`, now drives both validation and display. It splits the value the way the WHATWG parser does: tabs and newlines are removed, slashes and backslashes after `scheme:` are skipped, and the authority ends at the first `/`, `\`, `?` or `#`. It then checks that split against `new URL`. Only a cleanly parsed `http`/`https` URL is echoed. A URL with userinfo is printed as `scheme://host:port/path`, with no userinfo, query or fragment. Any other value is printed as `<scheme>://<redacted>`, or `<redacted>` when it has no scheme. This covers `%40`, a full-width `＠` (U+FF20), a small `﹫` (U+FE6B) and their UTF-8 percent forms, no-slash `http:` forms, non-http schemes and scheme-less values. `displayBase` (the health line and the curl hint) calls the same function with `base: true`. The reviewer's reproduction is now a test in two places: through the real host gate for both `backend_url` and `api_url`, and through doctor text and `--raw` in both the `gsd_run` and the direct forms. README now says that the password-to-host separator must be a literal `@`, and that a literal `@` inside the password is written `%40`. It no longer tells users to percent-encode the separator. Behaviour change: an invalid value such as `localhost:8000` is now shown as `<redacted>`, and the scheme-less test was updated to match.

### WR-02: The release's git-config refusal check runs only after npm staging and never in dry-run

**Commit:** `e7857a4`
**Applied fix:** `Refuse a git config that could redirect or capture the push credential` is now its own step, right after the release job's checkout. It has no `if:`, so it also runs in dry-run, and it holds no token. It sets `GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1` and runs `git config --local --name-only --get-regexp '^(url|http|credential|include|includeif)\.'`, which prints key names only. The push step keeps a `--name-only` re-check. In `test/release.test.cjs`, the regex is read from the new step. The test asserts that the step comes right after checkout and before bump, stage, commit and push. It also asserts that the step has no `if:` and no token, that both checks use `--name-only`, that the regex matches the push re-check, and that no `--get-regexp` without `--name-only` remains. The hermetic run now plants a secret in every config value and asserts that the refusal names the key but never prints the value. The workflow name `publish.yml` and the `npm-publish` environment are unchanged. `actionlint` is clean.

### IN-01: `ambiguous-userinfo` blocks credential-free URLs that contain `@`, and its message says "malformed credentials"

**Commit:** `8fe7dc3`
**Applied fix:** An `@` (or an `@` look-alike) after the authority is ambiguous only when the authority contains a `:`, because only then can a password run past an unencoded `/`, `\`, `?` or `#`. `http://host/a@b`, `http://host/?x=a@b`, `https://host/api#a@b` and `http://u@host/x@y` are accepted. `http://@host` is treated as an empty userinfo: it is accepted, shown as `http://host/`, and probed with no `Authorization` header (an end-to-end test checks this). These still block and are never probed: `http://u:12/x@host:8000`, the backslash form, `http://u:pw@host:8000/x@y`, and `http://u:12/x%40host:8000`. The message is now `<key> has an ambiguous '@' in URL: <scheme>://<redacted>`, with the fix hint `gsd_run config-set <key> <http(s)://[user:password@]host:port> (a literal '@' before the host; %40 inside the password)`. A test pins the full line and checks that it fits the 250-character cap. The reason id stays `ambiguous-userinfo`. README documents the rule and the new fix text.

### IN-02: The doctor `gate-bundle` message names the project copy as loaded when gsd-core loaded the hand-copied global copy

**Commit:** `76f329d`
**Applied fix:** A new `loadedCopy` in `memanto.cjs` follows the loader's precedence. When a global `capability.json` exists, the global copy wins unless gsd-core reports it skipped. Skipped means a ledgered global row that is not active, or a render-hooks load-failure reason that only the first-scanned copy can get. An `id collides` reason proves that the global copy holds the id. With no global `capability.json`, the active project row decides. Doctor gets the evidence only from the host CLI: render-hooks is now run before the `loaded` check, and its `failed to load (<reason>)` warnings are reused. No gsd-core internals are required, so the bundle's builtin-only require rule still holds. A child-process `loadRegistry` variant was tried first and dropped because it broke that rule.

The `gate-bundle` message now reads `gsd-core loads memanto from <global dir> (a global capability.json exists, so gsd-core skips the project copy with the same id as colliding), ...`. Its fix still deletes the stray global copy and keeps the project install. The `loaded` line notes when `capability list` disagrees with the copy gsd-core loads. In the same case the `duplicate-install` hint no longer suggests `capability remove --scope project`: it names the unledgered copy to delete by hand. README agrees with all of this.

Tests:
- A hand-copied global next to a consented project install (temp `GSD_HOME`).
- A global install skipped for `engines.gsd` next to a project install, which names the project copy as loaded.
- A `loadedCopy` unit matrix.

---

_Fixed: 2026-11-22T01:55:49Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
