---
phase: 01-walking-skeleton
plan: "02"
subsystem: gate
tags: [gsd-core, command-exit-zero, node-test, fetch, health-check, fake-server]

requires:
  - phase: 01-01
    provides: "lib/config.cjs resolveConfig, lib/checks.cjs CHECK_ORDER/BREAK_GLASS/runGateChecks/renderGateFailures, scripts/gate.cjs, test/helpers/gsd-env.cjs"
provides:
  - "lib/health.cjs validateEndpointUrl, checkHealth (one GET <url>/health, 5 s, no retry, no redirects), redactUrl, cap"
  - "lib/checks.cjs mempalace, agent-id edge cases, backend-url, api-url, backend-health, api-health; renderGateFailures with a 250-character cap per line"
  - "test/helpers/fake-api.cjs child-process fake Memanto REST (ok, ok-extra, http-500, not-ok, bad-json, hang, closed) with a request log"
  - "test/helpers/fake-memanto.cjs argv-recording memanto double (FAKE_MEMANTO_LOG, FAKE_MEMANTO_EXIT)"
affects: [01-03, 01-04, 01-05, 01-06, 01-07, 01-08, 01-09]

actuals:
  tokens: 9979
  tasks: 3
  commits: 6
plan_head_before: 65ed61ca0b9c9c8b6f2ac6972fd482653a889e20
plan_head_after: 28bcc5a0fc8dcc36c59f5a8e51d1aa89253022a1

tech-stack:
  added: []
  patterns:
    - "The fake REST server runs in a child process, because checkPredicate uses spawnSync, which blocks the test process's event loop"
    - "Every value echoed into a gate line is redacted or neutralised and capped at 160 characters; every line is capped at 250; the joined text is never truncated"
    - "Each gate test runs with a fake memanto first on PATH and asserts zero invocations"

key-files:
  created:
    - lib/health.cjs
    - test/health.test.cjs
    - test/gate.test.cjs
    - test/helpers/fake-api.cjs
    - test/helpers/fake-memanto.cjs
    - .planning/phases/01-walking-skeleton/evidence/01-02-task1-red.json
    - .planning/phases/01-walking-skeleton/evidence/01-02-task2-red.json
    - .planning/phases/01-walking-skeleton/evidence/01-02-task3-red.json
  modified:
    - lib/checks.cjs
    - test/skeleton.test.cjs

key-decisions:
  - "HEALTH_TIMEOUT_MS = 5000 (D-03) kept, confirmed by the owner (\"confirm HEALTH_TIMEOUT_MS = 5000\") after the timeout-guard hook blocked the write"
  - "URL userinfo is sent as a Basic Authorization header, as curl does, because fetch refuses credentials in the URL. Userinfo never appears in output"
  - "Health probes do not follow redirects (redirect: manual), so a 3xx response reports http-3xx and no request goes to a second host"
  - "The health response body is read up to 64 KiB within the same 5 s budget; a larger body reports bad-json"
  - "memanto.agent_id null or a number gives 'must be a string'; empty after trim gives 'is empty'; padded gives 'has leading or trailing whitespace'"

patterns-established:
  - "Child-process fakes for anything the synchronous host must reach over the network"
  - "Gate tests drive the real host (install, render-hooks, check predicate) and parse BLOCKED ids from the predicate message"

requirements-completed: [GATE-03, CONF-02, CONF-03, TEST-02]

coverage:
  - id: D1
    description: "The MemPalace exclusion blocks only when mempalace.enabled is the boolean true, and the message names Memanto and MemPalace"
    requirement: GATE-03
    verification:
      - kind: integration
        ref: "test/gate.test.cjs#mempalace.enabled boolean true blocks with a [mempalace] line naming Memanto and MemPalace"
        status: pass
      - kind: integration
        ref: "test/gate.test.cjs#mempalace.enabled as ... produces no [mempalace] line (7 cases) and the absent-key case"
        status: pass
    human_judgment: false
  - id: D2
    description: "agent_id edge cases (empty, whitespace, U+00A0/U+2003, absent, null, 42, padded) each block with an [agent-id] line that never echoes the value"
    requirement: CONF-02
    verification:
      - kind: integration
        ref: "test/gate.test.cjs#memanto.agent_id as ... blocks with an [agent-id] line (6 cases) and the padded case"
        status: pass
    human_judgment: false
  - id: D3
    description: "Both endpoint URLs are validated (empty, non-string, invalid, bad scheme). Each is probed once at GET <url>/health within 5 s. ok and ok-extra pass; http-500, not-ok, bad-json, closed and hang each block with their own id"
    requirement: CONF-03
    verification:
      - kind: unit
        ref: "test/health.test.cjs (validateEndpointUrl, redactUrl, checkHealth cases)"
        status: pass
      - kind: integration
        ref: "test/health.test.cjs (gate cases through check predicate, 16 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "Worst-case output fits the host's 2000-character head clip with the break-glass line last, and no userinfo or health body leaks"
    requirement: CONF-03
    verification:
      - kind: integration
        ref: "test/gate.test.cjs#every check failing with 5000-character userinfo URLs fits the 2000-character clip, break-glass last"
        status: pass
      - kind: unit
        ref: "test/gate.test.cjs#renderGateFailures keeps every line at most 250 characters and the total at most 1900"
        status: pass
      - kind: integration
        ref: "test/gate.test.cjs#health response bodies never reach the gate message"
        status: pass
    human_judgment: false
  - id: D5
    description: "A hanging endpoint returns a verdict in under 8 s with one request per server, and the gate spawns the memanto CLI zero times"
    requirement: TEST-02
    verification:
      - kind: integration
        ref: "test/gate.test.cjs#a hanging backend costs one 5 s probe: verdict in under 8 s, only [backend-health], one request each"
        status: pass
      - kind: integration
        ref: "test/gate.test.cjs#no gate run in this file spawned the memanto CLI"
        status: pass
    human_judgment: false

duration: 45min
completed: 2026-11-21
status: complete
---

# Phase 1 Plan 02: Full Phase-1 Gate Check Set Summary

**The discuss:pre gate now enforces the MemPalace exclusion, the agent_id edge cases, and validation plus a single 5 s `GET /health` for both endpoint URLs. It always prints its break-glass line inside the host's 2000-character clip, and every case is proven through gsd-core's real `check predicate`, using a child-process fake REST and a fake memanto that records zero calls.**

## Performance

- **Duration:** about 45 min, including a checkpoint wait for the owner to confirm the timeout
- **Started:** 2026-11-21T03:49:09Z
- **Completed:** 2026-11-21T04:34:03Z
- **Tasks:** 3
- **Files:** 10 created or modified (7 planned, plus 3 RED evidence records)

## Accomplishments
- The check set runs in CHECK_ORDER: mempalace, agent-id, backend-url, api-url, backend-health, api-health. Every check is evaluated, and each failure prints its own actionable line.
- The health probe makes one GET to `<url>/health`. It uses AbortSignal.timeout(5000), does not follow redirects, and reads at most 64 KiB of body. It is ok only for a 2xx response whose JSON body has `status` equal to "ok". The body is never returned or printed.
- Output budget: echoed values are capped at 160 characters, with userinfo and control characters removed. Each line is capped at 250 characters. The worst case measured through the real host keeps the break-glass line last.
- Test doubles: a fake REST running in a child process (seven modes, with a request log) and a fake `memanto` that records argv.

## Task Commits

1. **Task 1 RED:** `d3cfa66` (test)
2. **Task 1 GREEN:** `7e6a48c` (feat)
3. **Task 2 RED:** `145dacc` (test)
4. **Task 2 GREEN:** `ea5ad31` (feat)
5. **Task 3 RED:** `2b157b7` (test)
6. **Task 3 GREEN:** `28bcc5a` (feat)

There was no REFACTOR commit.

## TDD Gate Compliance

- **Task 1 RED** (`d3cfa66`): the target `mempalace.enabled boolean true blocks with a [mempalace] line naming Memanto and MemPalace` failed on its assertion (only the [agent-id] line printed). The classifier returned RED_EVIDENCE_OK. 5/17 tests failed, all on their planned message assertions. Evidence: `evidence/01-02-task1-red.json`. GREEN: 17/17.
- **Task 2 RED** (`145dacc`): the target `empty backend_url blocks with [backend-url] and the config-set fix` failed on a deepEqual of the BLOCKED ids (`[]`). The classifier returned RED_EVIDENCE_OK. The lib/health.cjs unit cases failed with MODULE_NOT_FOUND, because the module did not exist yet; it is loaded per test by design. The passing-gate and skeleton cases passed, which proves the fakes work. GREEN: 34/34.
- **Task 3 RED** (`2b157b7`): the target `renderGateFailures keeps every line at most 250 characters and the total at most 1900` failed with line length 10041. The real-host worst case also failed, with a 649-character line. The classifier returned RED_EVIDENCE_OK. The hang, body-leak and zero-spawn cases already passed after Task 2. GREEN: 58/58 across the three files, and `npm test` passes 73/73 with exit 0.

## Files Created/Modified
- `lib/health.cjs`: URL validation, redaction, the bounded single-attempt health probe
- `lib/checks.cjs`: the mempalace, agent-id, endpoint URL and health checks; the budgeted renderer
- `test/gate.test.cjs`: GATE-03, CONF-02, D-04 budget, hang and zero-spawn tests through the real host
- `test/health.test.cjs`: CONF-03 unit tests and gate tests
- `test/helpers/fake-api.cjs`, `test/helpers/fake-memanto.cjs`: the TEST-02 doubles
- `test/skeleton.test.cjs`: the passing case now points both URLs at healthy fakes

## Decisions Made
See key-decisions above. The main ones: the owner confirmed the 5 s budget, userinfo is sent as Basic auth, redirects are not followed, and the body read is capped at 64 KiB.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fake REST runs in a child process**
- **Found during:** Task 2
- **Issue:** `checkPredicate` uses spawnSync, which blocks the test process's event loop, so a `node:http` server inside the test process could never answer the gate.
- **Fix:** fake-api.cjs starts the server as a child process. Requests are logged to a JSON-lines file before any response is sent. The child exits when its stdin closes.
- **Files modified:** test/helpers/fake-api.cjs
- **Commit:** 145dacc

**2. [Rule 1 - Bug] fetch rejects URLs that carry userinfo**
- **Found during:** Task 2
- **Issue:** Node fetch throws on credentials in the URL, so a valid `https://u:p@h/` URL would always report `connection`.
- **Fix:** userinfo is removed from the request URL and sent as a Basic Authorization header. It never appears in output.
- **Files modified:** lib/health.cjs
- **Commit:** ea5ad31

**3. [Rule 2 - Security] Control characters neutralised in echoed values**
- **Found during:** Task 2 and Task 3
- **Issue:** a config value containing a newline could forge extra `memanto: BLOCKED` lines.
- **Fix:** C0/C1 control characters and U+2028/U+2029 are replaced with `?` in redactUrl and in the config-unreadable echo. The regex is written ASCII-only, because the Write tool had turned the U+2028 escape into a literal line separator.
- **Files modified:** lib/health.cjs, lib/checks.cjs
- **Commit:** ea5ad31, 28bcc5a

**4. [Rule 3 - Blocking] gate.test.cjs gained fake servers in Task 3**
- **Issue:** the exact two-line ordering case needs healthy URLs, which only exist after Task 2.
- **Fix:** the case asserts exactly `[mempalace, agent-id]` plus the break-glass line, with both URLs pointing at an `ok` fake.
- **Commit:** 2b157b7

---

**Total deviations:** 4 auto-fixed (2 blocking, 1 bug, 1 security). **Impact:** all were needed for correctness or for the tests to run at all. No scope creep.

## Issues Encountered
- A timeout-guard hook blocked writing `HEALTH_TIMEOUT_MS = 5000`. The agent returned a blocking-human checkpoint, the owner typed the confirmation, and the unchanged write then succeeded. The same hook also blocked a 10 s start-up timer in fake-api.cjs. That timer was dropped; start-up failure is now caught only when the child exits early.
- The plan commit ledger under the `.git` dir could not be written, because worktree isolation refused the command. The base was taken from the dispatch's branch check instead: `65ed61c`.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: credential-egress | lib/health.cjs | URL userinfo from repo-controlled config is sent as a Basic Authorization header to the configured health endpoint. Plain http sends it unencrypted. It is never printed. |

## User Setup Required
None.

## Next Phase Readiness
- Plan 01-03 and later plans can reuse `startFakeApi` and `installFakeMemanto`.
- An untracked `.codegraph/` index exists in this worktree. It is not committed and is not part of the npm file set.

## Self-Check: PASSED
- All 10 created and modified files are present. All 6 task commits are ancestors of HEAD (`git rev-list --count 65ed61c..HEAD` = 6).
- The plan verification ran: `node --test --test-reporter=tap test/gate.test.cjs test/health.test.cjs test/skeleton.test.cjs` gave 58 pass, 0 fail, and `npm test` exited 0.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-21*
