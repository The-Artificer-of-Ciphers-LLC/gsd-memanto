---
phase: 01-walking-skeleton
reviewed: 2026-11-21T00:00:00Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - .github/workflows/ci.yml
  - .github/workflows/publish.yml
  - .gitignore
  - .npmrc
  - capability.json
  - lib/checks.cjs
  - lib/config.cjs
  - lib/gsd-host.cjs
  - lib/health.cjs
  - memanto.cjs
  - package.json
  - scripts/check-probe.cjs
  - scripts/gate.cjs
  - test/activation.test.cjs
  - test/bundle.test.cjs
  - test/config-contract.test.cjs
  - test/config.test.cjs
  - test/dispatch.test.cjs
  - test/doctor.test.cjs
  - test/gate.test.cjs
  - test/health.test.cjs
  - test/helpers/fake-api.cjs
  - test/helpers/fake-memanto.cjs
  - test/helpers/gsd-env.cjs
  - test/install.test.cjs
  - test/manifest.test.cjs
  - test/release.test.cjs
  - test/skeleton.test.cjs
  - test/spike-installer.test.cjs
  - test/spike-regression.test.cjs
  - test/traps.test.cjs
  - tools/run-tests.cjs
  - tools/stage-bundle.cjs
findings:
  critical: 2
  warning: 4
  info: 8
  total: 14
  necessity: 1
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-11-21T00:00:00Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

The review covered the capability manifest, the gate and doctor code paths (`lib/*.cjs`, `scripts/*.cjs`, `memanto.cjs`), the dev tooling, both GitHub workflows and the test helpers. `npm test` passes (188 tests, 187 pass, 1 skipped, 0 fail). The agent also ran scratch probes against a temporary `GSD_HOME` and never touched the real `~/.gsd`. Those probes reproduced two blocking defects:

1. The discuss:pre gate predicate does not run the bundle that gsd-core loaded and consented. It runs whichever `scripts/gate.cjs` exists under `$GSD_HOME/.gsd/capabilities/memanto`. In the reproduction, a stray file there made a project-scope install pass its gate with an empty `agent_id`, so the gate failed open.
2. `redactUrl` leaks endpoint credentials when the configured URL does not parse. The most likely reason for a URL not to parse is a password containing unescaped reserved characters, so the leak hits exactly the common mistake.

The warnings cover doctor host spawns that have no timeout (doctor can hang), doctor running project-planted code as an "identity check", a misleading fix hint for an invalid `GSD_PROJECT`/`GSD_WORKSTREAM`, and release-job credential exposure.

The gate never calls the `memanto` CLI. Its only network request is `GET <base>/health`. Both properties were confirmed in `lib/checks.cjs:120-145` and `lib/health.cjs:95-128`.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: The gate runs a `gate.cjs` taken from the global directory, not from the consented bundle. Project scope fails open.

**File:** `capability.json:63`
**Issue:** The predicate command `d="${GSD_HOME:-$HOME}/.gsd/capabilities/memanto"; [ -f "$d/scripts/gate.cjs" ] || d=".gsd/capabilities/memanto"; exec node "$d/scripts/gate.cjs"` picks the global directory whenever a `scripts/gate.cjs` file exists there. It does not check that this directory is the bundle gsd-core actually loaded, the one bound to the ledger and the consent hash. Possible sources of that file:
- a hand-copied bundle
- a leftover directory
- an older version of the capability
- any planted file

**Reproduced (temp `GSD_HOME`):**
1. `memanto` was installed at project scope with `memanto.agent_id: ""`.
2. A file `$GSD_HOME/.gsd/capabilities/memanto/scripts/gate.cjs` was written containing `process.exit(0)`.
3. `loop render-hooks discuss:pre` rendered the project gate.
4. `check predicate` returned `{"block":false,"message":"command exited 0"}`, where a block was expected.

This defeats the core "fail closed" value. The code that decides the verdict is not covered by the consent hash of the bundle that rendered the gate. No test plants a global gate next to a project install. `test/gate.test.cjs` installs globally only.
**Fix:** The selected directory must be the one gsd-core loaded, and the selection must fail closed when it is ambiguous. The host offers no bundle-path placeholder (only `${PHASE_*}`), so one option is to resolve inside node instead of in sh:

```sh
exec node -e 'const p=require("path"),fs=require("fs");const g=p.join(process.env.GSD_HOME||require("os").homedir(),".gsd/capabilities/memanto"),l=".gsd/capabilities/memanto";const c=[g,l].filter(d=>fs.existsSync(p.join(d,"capability.json")));if(c.length===0){console.error("memanto: BLOCKED [gate-internal] no installed bundle");process.exit(1)}require(p.resolve(c[0],"scripts/gate.cjs"))'
```

Then add a self-check in `scripts/gate.cjs`. The check blocks when its own bundle directory is not the committed ledger entry for the scope it represents. It also blocks when both scope directories exist and their `scripts/gate.cjs` and `lib/` contents differ. Add a regression test: project install plus a planted global `scripts/gate.cjs` must still block.

### CR-02: `redactUrl` leaks userinfo for unparseable URLs whose password holds `/`, `?` or `#`

**File:** `lib/health.cjs:48` (used by `lib/checks.cjs:106`)
**Issue:** When `new URL()` fails, the fallback regex `^([A-Za-z][A-Za-z0-9+.-]*:\/\/)?[^/?#@\s]*@` only strips userinfo that contains none of `/ ? # @`. A password with an unescaped `/` or `#` is the typical reason a URL is invalid. Those values reach the `invalid-url` branch, and the gate then prints them verbatim in `memanto.<key> is not an http(s) URL: ...`. Reproduced:
- `redactUrl('http://user:p/ss@host:8000')` returned `http://user:p/ss@host:8000`
- `redactUrl('http://user:p#w@host')` returned `http://user:p#w@host`

The gate stderr goes into the agent transcript and the host message. `test/gate.test.cjs:152-163` asserts that no userinfo leaks, but only with parseable URLs.
**Fix:** For a value that does not parse, strip everything from just after `://` up to the last `@` before any whitespace, or redact the whole value:

```js
s = s.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)?[^\s]*@/, '$1'); // greedy to the LAST '@'
```

If that is still too loose, print only the scheme and host (`<scheme>://<redacted>`) for invalid URLs. Add the two strings above to `test/health.test.cjs`.

## Warnings

### WR-01: Doctor host spawns have no timeout, so doctor can hang despite PROBE_TIMEOUT_MS

**File:** `lib/gsd-host.cjs:22-28`
**Issue:** `runTools` calls `spawnSync` without `timeout`. It serves `runtime-identity`, `capability list` and `loop render-hooks`. The owner fix in `memanto.cjs:63-80` bounds only the check probe, and its stated reason is a config file that blocks on read (a FIFO). The host commands read the same `.planning/config.json` and run before the probe (`memanto.cjs:265-286`). A blocking config, or a hung host, therefore hangs `memanto doctor` forever before the bounded probe is reached.
**Fix:** Pass `timeout` (for example 15000 ms) and `killSignal` to `spawnSync` in `runTools`. Map `res.error.code === 'ETIMEDOUT'` to a `{ ok:false, reason:'timed out' }` result in `hostIdentity`, `capabilityList` and `renderHooksAt`. Add a test that uses a fake `gsd-tools.cjs` that never exits.

### WR-02: The doctor "identity check" executes a project-planted `gsd-tools.cjs`, and the GSD_CORE_DIR comment is wrong

**File:** `lib/gsd-host.cjs:60-79, 81-93`
**Issue:** To verify identity, `hostIdentity` runs the candidate file with `process.execPath`. Running the file is the attack, so the identity check gives no protection against a cloned repo that plants `<project>/gsd-core/bin/gsd-tools.cjs`. The candidate list omits every runtime home except `~/.claude` and opencode (no `~/.codex`, `~/.gemini/...`, `~/.cursor`, and so on). When a user of those runtimes runs the direct form (`node .../memanto.cjs doctor`), the project-local file is reached and executed.

The comment at line 60 says GSD_CORE_DIR "wins outright". The loop actually falls through to later candidates when that file fails identity.
**Fix:** Do not execute project-local candidates. Either drop them, or require an explicit opt-in such as `GSD_CORE_DIR`. Add the other runtime config homes that the gsd-core shim searches. Make an identity failure of `GSD_CORE_DIR` terminal, or correct the comment.

### WR-03: An invalid GSD_PROJECT/GSD_WORKSTREAM produces a "make GSD_PROJECT readable" fix

**File:** `lib/config.cjs:105`, `lib/checks.cjs:47-56`
**Issue:** `resolveConfig` reports an invalid planning name as `{ kind: 'read', path: e.variable }`. `configUnreadable` then renders `GSD_PROJECT cannot be read (...) -> make GSD_PROJECT readable` (reproduced). The gate blocks correctly, but the fix hint points at a non-existent file. The `doctor` `enabled` record (`memanto.cjs:98`) repeats the same misdirection.
**Fix:** Return a distinct `kind: 'env'`, and render `${variable} is invalid (...) -> unset ${variable} or set it to a name without '/', '\\' or '..'`.

### WR-04: The release job leaves a write-scoped token on disk during tests and installs a floating npm

**File:** `.github/workflows/publish.yml:72-74, 108-111, 176-183`
**Issue:** `actions/checkout` runs with the default `persist-credentials: true`, so the `contents: write` GITHUB_TOKEN sits in `.git/config` while `npm test` runs code from gsd-core fetched from npm and the repo's own tests. `npm install -g npm@^11.15.0` takes whatever 11.x is latest at run time, in a job that also holds `id-token: write`. A compromised gsd-core release or npm 11.x could push to `main` or tags.
**Fix:** Set `persist-credentials: false` on checkout. In the commit/tag step only, push with `git -c http.extraheader="AUTHORIZATION: basic $(printf 'x-access-token:%s' "$GH_TOKEN" | base64)" push ...`. Pin npm to an exact version (`npm@11.15.0`).

## Info

### IN-01: `package.json` `files` lists a directory that does not exist

**File:** `package.json:13`
**Issue:** `"fragments"` does not exist in the repo. npm ignores it silently today. If someone later creates `fragments/` for another purpose, it will ship and change the bundle hash.
**Fix:** Remove the entry until Phase 2 adds fragments.

### IN-02: The `DRY_RUN` env variable is never read

**File:** `.github/workflows/publish.yml:70`
**Issue:** Every step gates on `inputs.dry-run` directly, so `DRY_RUN` is dead configuration.
**Fix:** Remove the variable, or use it consistently.

### IN-03: Doctor's control-character filter omits U+2028/U+2029

**File:** `memanto.cjs:23`
**Issue:** `CONTROL` is `/[\x00-\x1f\x7f-\x9f]/g`. `lib/health.cjs:12` and `lib/checks.cjs:40` also neutralise `\p{Zl}\p{Zp}`. As a result, host reasons and paths echoed by doctor (`memanto.cjs:117,123,215`) can still carry line separators.
**Fix:** Reuse one shared regex (export it from `lib/health.cjs`).

### IN-04: `enginesCheck` falls back to `capability.json` in the process cwd

**File:** `memanto.cjs:169`
**Issue:** `path.join(scopeDirs[bad.scope] || '', 'capability.json')` reads a relative `capability.json` when the row's scope is neither global nor project. The engines range printed then comes from an unrelated manifest.
**Fix:** If the scope is unknown, skip the read and print `(unknown range)`.

### IN-05: Endpoint URLs are trimmed silently while `agent_id` whitespace blocks

**File:** `lib/health.cjs:22-30`, `lib/checks.cjs:91-93`
**Issue:** `" http://host:8000 "` passes, but `" dev-agent "` blocks. The rules are inconsistent and the trim is undocumented.
**Fix:** Apply one rule to both (preferably reject surrounding whitespace in both).

### IN-06: Doctor trusts probe records without validating them, and `renderText` runs outside the try

**File:** `memanto.cjs:87, 298, 311-317`
**Issue:** `gateChecks` copies `c.status` as is. A status outside `ok|warn|error` does not count as an error, so doctor exits 0. A non-string status makes `c.status.padEnd` throw after the try/catch, and the host then reports "router threw".
**Fix:** Coerce unknown statuses to `error` in `gateChecks`, and move rendering inside the guarded block.

### IN-07: Already defended elsewhere: CI repeats the "more than one test" assertion

**File:** `.github/workflows/ci.yml:50-53`, `.github/workflows/publish.yml:183`
**Category:** necessity
**Issue:** `npm test` already runs `tools/run-tests.cjs:38-41`, which exits 1 when one test or fewer ran. The awk steps re-check the same TAP line after that exit code has already failed the step (`set -o pipefail`).
**Fix:** Keep only one of the two checks, or record that the duplication is a deliberate belt-and-braces check.

### IN-08: `tools/stage-bundle.cjs` leaves temp directories behind

**File:** `tools/stage-bundle.cjs:73, 102`
**Issue:** Every non-test invocation creates `memanto-stage-*` and `memanto-home-*` under the OS temp directory and never removes them. The test harness cleans up only the directories it registers.
**Fix:** Print the paths and document that they need cleanup, or add a `--cleanup` flag or an exit handler for `--stage-only`.

---

_Reviewed: 2026-11-21T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
