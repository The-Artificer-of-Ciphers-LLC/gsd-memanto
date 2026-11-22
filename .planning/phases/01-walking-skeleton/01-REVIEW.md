---
phase: 01-walking-skeleton
reviewed: 2026-11-22T02:03:03Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - .github/workflows/publish.yml
  - README.md
  - lib/checks.cjs
  - lib/health.cjs
  - memanto.cjs
  - test/doctor.test.cjs
  - test/gate-bundle.test.cjs
  - test/health.test.cjs
  - test/release.test.cjs
findings:
  critical: 1
  warning: 1
  info: 3
  total: 5
  necessity: 0
status: issues_found
---

# Phase 1: Code Review Report (round 4, re-review of the round-3 fixes)

**Reviewed:** 2026-11-22T02:03:03Z
**Depth:** standard
**Files Reviewed:** 9 (`git diff e1ebc29^1 e1ebc29 -- . ':!.planning'`)
**Status:** issues_found

## Summary

This round re-reviews the four round-3 fixes, `ebb2d4c`, `e7857a4`, `8fe7dc3` and `76f329d`. `npm test` reports 327 tests: 326 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network traffic went to closed local ports (`127.0.0.1:80`, `127.0.0.1:9`). No Memanto server was contacted. The necessity reference was not loaded for this round, so no necessity findings are recorded.

The IN-01 fix introduced a critical regression. The new "no `:` in the authority" relaxation accepts `DOMAIN\user:password@host` and `user/x:password@host`. Such a value is then probed at the wrong host, and its password is printed verbatim on the gate's stderr (CR-01). Round 2 blocked these values. The IN-02 fix is incomplete. It ignores the loader's skip reason whenever a ledgered global row exists, so doctor reports `gate-bundle ok` while the gate runs code from a global bundle that gsd-core rejected (WR-01). Three info items remain.

### Status of the round-3 findings

| Round-3 | Verdict | Notes |
|---------|---------|-------|
| WR-01 | Fixed for the reported inputs; leak reopened by IN-01 | `%40`, `＠`, `﹫`, their UTF-8 percent forms, no-slash and non-http forms all print `<scheme>://<redacted>` or `<redacted>`. Both reported values print `http://<redacted>`. A scheme-less `localhost:8000` (parsed as scheme `localhost:`) prints `memanto.backend_url is not an http(s) URL: <redacted> -> gsd_run config-set memanto.backend_url <http(s)://host:port>`. That still gives a usable fix: it names the key and the required form, and the user can read the value with `config-get`. No other echo path was found. `redactUrl` is called only from `lib/checks.cjs:118,121,131`, and doctor reuses the same records. The Basic header still goes only to the parsed host, with redirects not followed. However, the classifier change in `8fe7dc3` lets a whole new class of credential URL through as "clean", and those URLs are echoed raw (CR-01). |
| WR-02 | Fixed, complete | The refusal step comes right after the release checkout (`publish.yml:128-139`), before the main-only check, bump, stage, commit and push. It has no `if:`, so it runs in dry-run. It has no token and no step env. It uses `--name-only`. The push re-check uses the same regex and `--name-only`. Git lowercases section and key names, so `includeIf` matches `includeif`. The test pins the step order and the absence of `if:` and of a token, and it checks the planted secret values against real `git config --file` output. One residual robustness gap is listed as IN-03. |
| IN-01 | Fixed as specified, but the rule is unsound | `http://host:8000/a@b` still blocks, which is correct: `http://u:12/x@host:8000` has the same shape. The message `has an ambiguous '@' in URL: http://<redacted>` is clear for a credential URL. The fix hint misleads a credential-free URL, and a path `@` after a `host:port` cannot be written in any form (IN-02). The premise "with no `:` in the authority there is no password for the `@` to end" is false, because the `:` can follow an unencoded `/` or `\` in the user name (CR-01). |
| IN-02 | Fixed for an unledgered global copy; incomplete for a ledgered one | The hand-copied global case is right. The project copy's `id collides` reason proves that the global copy holds the id. The `engines.gsd` case is right, because `capability list` marks that row `incompatible`. The check was compared against `capability-loader.cjs` 1.20.1 (lines 610-879) and `loop-resolver.cjs:509-528`. The loader adds a copy to `acceptedIds` only after the collision check, fragment materialization and cross-capability validation (`:879`). `capability list` marks a row as anything but `active` only for `engines.gsd` or missing consent (`capability-command-router.cjs:594-599`). Render-hooks load-failure lines carry no scope and are de-duplicated by text (`memanto.cjs:288`). A ledgered global copy skipped for a validation, fragment, clash or cross-validation reason therefore still shows as `active` and is reported as loaded (WR-01). In the ambiguous validation-failure case doctor asserts one answer, and it also states a collision it never saw (IN-01). |

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: A credential URL whose user name holds an unencoded `\` or `/` passes the gate, is probed at the wrong host, and has its password printed verbatim

**File:** `lib/health.cjs:84-90` (the round-3 IN-01 rule), echoed through `lib/checks.cjs:130-145`; README claim at `README.md:80, 82`
**Issue:** The rule at `lib/health.cjs:89` treats an `@` after the authority as unambiguous whenever the authority, as `splitUrl` cuts it at the first `/`, `\`, `?` or `#`, holds no `:`. In `CORP\alice:s3cret@host` and `team/alice:s3cret@host`, the `:` comes after the first `\` or `/`. The authority is then `CORP` or `team`, the value is classified `clean`, and `validateEndpointUrl` returns `ok`. The probe goes to host `corp` (a DNS lookup of the user-name prefix, with no `Authorization` header). `displayBase` then prints `u.href` with the path, which includes `alice:s3cret@memanto.internal:8000`. `DOMAIN\user` is a common user-name form. Before `8fe7dc3`, `hasAmbiguousUserinfo` blocked every such value and printed it as `http://<redacted>`, so this is a regression. It contradicts README lines 80 ("never prints it") and 82 ("no user name, password ...").
**Reproduced** with a temp project whose `.planning/config.json` sets `backend_url` to `http://127.0.0.1\alice:s3cret@memanto.internal:8000` and `api_url` to `http://127.0.0.1/alice:s3cret@memanto.internal:8000`. Running `node scripts/gate.cjs` exited 1 and printed:
`memanto: BLOCKED [backend-health] http://127.0.0.1/alice:s3cret@memanto.internal:8000/health is not healthy (connection) -> bring the Memanto backend at http://127.0.0.1/alice:s3cret@memanto.internal:8000 up ...`
The `[api-health]` line was the same. Both probes went to `127.0.0.1:80`. A username-only token containing `/` (common in base64 tokens), such as `http://127.0.0.1/s3cretTokenTail@memanto.internal:8000`, leaks the same way. With a real token prefix such as `http://Zm9v/YmFy@host`, the prefix is also sent to DNS as a host name.
**Fix:** Bring back the round-2 rule for any value without a parsed userinfo: an `@` look-alike anywhere outside the parsed userinfo is ambiguous. Keep the round-3 IN-01 wording change, which was the low-impact part of that finding, and drop the relaxation:
```js
// lib/health.cjs, classifyUrl, replacing line 89
if (AT_LIKE.test(parts.rest)) return { kind: 'ambiguous', parts };
```
This blocks `http://host/a@b` again. That is acceptable, because a Memanto base URL has no reason to contain an `@`. Reword the README sentence on line 80 to match. Add the two reproduction values above, plus `http://tok/en@host:8000`, to `test/health.test.cjs`. Assert there that `validateEndpointUrl` is not `ok` and that the output never contains `s3cret` or `en@`. Add them also to the host-gate output test.

## Warnings

### WR-01: Doctor reports `gate-bundle ok` while the gate runs a ledgered global bundle that gsd-core skipped

**File:** `memanto.cjs:309-327` (`loadedCopy`, specifically `:321`), consumed by `gateBundleCheck` (`:336-349`), `loadedCheck` (`:163-172`) and `duplicateCheck`
**Issue:** When a global ledger row exists, `loadedCopy` decides "global skipped" only from `globalRow.status !== 'active'` (line 321). It ignores `failures` even though they hold the loader's own skip reason. `capability list` sets a row to something other than `active` only for `engines.gsd` or missing consent (`capability-command-router.cjs:594-599`). A ledgered global copy skipped for any other reason still shows as `active`. That covers `invalid hook fragment`, `cross-capability validation failed`, `owns ... already owned` and `failed validation` (`capability-loader.cjs:686-847`). gsd-core then loads the consented project copy and renders its gate. The predicate (`lib/gate-bundle.cjs:72`) runs the global `scripts/gate.cjs`, because a global manifest and ledger entry exist. That is exactly the mismatch `gate-bundle` exists to report. The comment at `memanto.cjs:358-359` says the mismatch branch handles "failed validation". With this logic, that branch can only fire for `engines.gsd`.
**Reproduced** (temp `GSD_HOME`; script at `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/repro-in02.cjs`). The setup was a global `capability install` plus a consented project install. The global `capability.json` then got a contribution with the missing fragment `missing-fragment.md`, and a marker write was added to the global `scripts/gate.cjs`. Results:
- render-hooks `discuss:pre` returned 1 memanto hook and the warning `capability "memanto" failed to load (invalid hook fragment: ...)`.
- `_overlay.warnings` named scope `global`.
- Doctor `--raw` said `loaded`: "memanto 0.1.0 is active in global scope", `gate-bundle`: ok ("runs the installed bundle gsd-core loads"), and `duplicate-install`: "gsd-core keeps the global one".
- The predicate ran the global gate (the marker was created).

The `failed validation` variant (global `title: ""`) gave the same doctor output.
**Fix:** Treat any failure reason that a project copy cannot get while the global copy holds the id as proof that the global copy was skipped, whether or not a global row exists. Only `PRE_COLLISION` reasons are ambiguous:
```js
// memanto.cjs, loadedCopy
if (collided) globalSkipped = false;
else if (other.some((r) => !PRE_COLLISION.test(r))) globalSkipped = true; // post-collision reason: only the global copy can get it while a project copy exists
else if (globalRow && globalRow.status !== 'active') globalSkipped = true;
else if (other.length > 0 && gateBundle.hasManifest(roots.projectRoot)) return { scope: 'unknown', dir: null }; // PRE_COLLISION only: either copy
else globalSkipped = !globalRow && other.length > 0;
```
In `gateBundleCheck` and `loadedCheck`, report the `unknown` case as an `error` that names both directories. An example message: "gsd-core skipped one memanto copy (failed validation); doctor cannot tell which, and the gate runs <resolved>". Add the fragment repro, with a ledgered global and a project install, to `test/gate-bundle.test.cjs`, and assert that `gate-bundle` is `error`.

## Info

### IN-01: The `gate-bundle` message asserts a collision that doctor never observed

**File:** `memanto.cjs:369-372`, `:322-325`
**Issue:** The text `(a global capability.json exists, so gsd-core skips the project copy with the same id as colliding)` is added whenever `loaded.scope === 'global'` and a project manifest exists. It does not depend on `collided`. Take an unledgered global copy that fails validation, next to a consented project install. The loader reports one `failed validation` reason. Lines 322-325 resolve that to "global loaded". The message then claims the project copy collided, although gsd-core actually loaded the project copy. `loaded` also says "gsd-core loads the global copy". The fix hint is still correct, because it deletes the global copy and keeps the project install.
**Fix:** Add the parenthetical only when `COLLIDES` was seen. Report the PRE_COLLISION-only case as undetermined (see the WR-01 fix) instead of asserting global.

### IN-02: A credential-free URL with an `@` after a `host:port` cannot be written in any form, and the hint points at credentials

**File:** `lib/health.cjs:42, 89`; `lib/checks.cjs:116-119`
**Issue:** `http://host:8000/a@b` blocks, which is correct. Because `AT_LIKE` also matches `%40`, the encoded form `http://host:8000/a%40b` blocks as well, and so does `http://u:p@host:8000/x%40y`. The fix hint `<http(s)://[user:password@]host:port> (a literal '@' before the host; %40 inside the password)` tells a user with no credentials to change their credentials, not to remove the `@` from the path. The impact is low, because a Memanto base URL should not need one.
**Fix:** Add this clause to the hint: "or remove the '@' (and %40) from the path, query and fragment". If CR-01's fix is applied, say this in the message for every value.

### IN-03: The git-config refusal fails open when `git config` exits with an error other than "no match"

**File:** `.github/workflows/publish.yml:136, 276`
**Issue:** `if git config ... --get-regexp ...; then` treats every non-zero exit as "no matching key". An unparseable `.git/config` makes `git config` exit 128 (`fatal: bad config line 1`; reproduced with `git config --file <corrupt> --name-only --get-regexp ...`). The check then passes, the release goes on to `npm stage publish`, and only `git commit` fails afterwards. That leaves a staged version to reject by hand, which is the exact outcome WR-02 set out to prevent.
**Fix:** Check the exit code explicitly:
```bash
set +e; names="$(git config --local --name-only --get-regexp '^(url|http|credential|include|includeif)\.')"; rc=$?; set -e
if [ "$rc" -eq 0 ]; then printf '%s\n' "$names"; echo "refusing ..." >&2; exit 1; fi
if [ "$rc" -ne 1 ]; then echo "git config failed (exit $rc); refusing to release" >&2; exit 1; fi
```

---

_Reviewed: 2026-11-22T02:03:03Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
