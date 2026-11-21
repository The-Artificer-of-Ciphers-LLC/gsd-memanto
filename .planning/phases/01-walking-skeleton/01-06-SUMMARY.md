---
phase: 01-walking-skeleton
plan: "06"
subsystem: doctor
tags: [gsd-core, capability, command-family, doctor, node-test, spawnSync, zero-deps]

requires:
  - phase: 01-01
    provides: "lib/config.cjs resolveConfig, test/helpers/gsd-env.cjs, tools/stage-bundle.cjs"
  - phase: 01-02
    provides: "lib/checks.cjs runGateChecks (full gate check set), lib/health.cjs cap, test/helpers/fake-api.cjs, test/helpers/fake-memanto.cjs"
  - phase: 01-03
    provides: "resolveConfig host ladder (GSD_PROJECT / GSD_WORKSTREAM parity)"
  - phase: 01-05
    provides: "discuss:pre bypass list (F11) used by the discuss-bypass warning"
provides:
  - "capability.json commands entry: family memanto, module memanto.cjs, router route, subcommands [doctor]"
  - "memanto.cjs route(ctx): synchronous doctor with text and --raw JSON output, exit 1 on any error, direct-invocation shim"
  - "lib/gsd-host.cjs locateGsdTools, hostIdentity, capabilityList, renderHooksAt (read-only host queries)"
  - "scripts/check-probe.cjs: runGateChecks records as JSON for the synchronous doctor"
  - "Doctor check ids: gsd-core-located, enabled, loaded, consent, engines, render:<point>, duplicate-install, discuss-bypass, check-probe, capability-list, doctor-internal, plus the gate ids"
  - "test/doctor.test.cjs (15 cases) and test/bundle.test.cjs (5 cases)"
affects: [01-08, 01-09, phase-02-gates]

actuals:
  tokens: 17506
  tasks: 3
  commits: 5
plan_head_before: 225141094078422f2e8cdcd496c98f4b19c21e13
plan_head_after: 10afeb438a250fbbf36239ac7a1da8dd2f1d4241

tech-stack:
  added: []
  patterns:
    - "The synchronous router gets async health results by spawnSync of a probe script that prints the shared check records as JSON"
    - "Doctor reads host state only through read-only gsd-tools queries (runtime-identity, capability list, loop render-hooks) plus fs reads of the installed manifests"
    - "Doctor tests drive both forms against the real host; not-loaded states use the direct form because gsd-core does not route the family"

key-files:
  created:
    - memanto.cjs
    - lib/gsd-host.cjs
    - scripts/check-probe.cjs
    - test/doctor.test.cjs
    - test/bundle.test.cjs
    - .planning/phases/01-walking-skeleton/evidence/01-06-task1-red.json
    - .planning/phases/01-walking-skeleton/evidence/01-06-task2-red.json
  modified:
    - capability.json
    - test/install.test.cjs

key-decisions:
  - "Doctor's spawnSync of check-probe carries no time bound: the owner's timeout-guard hook blocked the plan's 15 s value until the owner types the hook's confirmation phrase. The probe's run time is bounded by the owner-confirmed 5 s parallel health budget"
  - "The render check reads the host's load-failure reason from the render-hooks envelope warnings[] first and from stderr second, and extracts the text inside `failed to load (...)`"
  - "When memanto.enabled is unreadable (config-unreadable), doctor treats Memanto as enabled and runs every check (fail closed); enabled is reported as warn"
  - "gsd_run memanto doctor is routed even when memanto.enabled is false (observed): commands are not gated by the activation key"
  - "Extra ids beyond the plan list, only on internal failure: capability-list (the host query failed) and doctor-internal (an exception in doctor)"

patterns-established:
  - "Host-state fixtures: project-scope install via tools/stage-bundle.cjs --scope project, then capability trust revoke; fs.cpSync hand copy; edited installed manifest for engines and invalid when"
  - "Read-only proof: snapshotTree of bundle, temp home and project before and after sequential and Promise.all-concurrent gate + doctor runs, plus zero fake-memanto calls"

requirements-completed: [GATE-06, INST-05, TEST-02]

coverage:
  - id: D1
    description: "Doctor runs through gsd_run and directly, with the D-18 text/--raw contract and D-19 exit codes, and includes the gate's checks with the gate's messages"
    requirement: GATE-06
    verification:
      - kind: integration
        ref: "test/doctor.test.cjs#gsd_run memanto doctor --raw on a healthy installed project exits 0 with ok gate checks"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#doctor exits 1 with the gate agent-id error when memanto.agent_id is empty"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#the direct form reports the same check ids as the gsd_run form"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#text output: one status line per check, fix lines under non-ok checks, summary and direct form"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#an unknown subcommand exits 1 with a usage message naming doctor"
        status: pass
    human_judgment: false
  - id: D2
    description: "The four fail-open states (not loaded, not consented under OD-3, outside engines.gsd, not rendering) are reported as errors with actionable fixes"
    requirement: GATE-06
    verification:
      - kind: integration
        ref: "test/doctor.test.cjs#enabled with no bundle installed in the temp home: loaded is an error and doctor exits 1"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#project-scope install then capability trust revoke: consent is an error naming the missing consent record"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#a hand-copied global bundle with no ledger entry: consent error naming the ledger, gsd_run answers Unknown command"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#an installed manifest edited to engines.gsd \">=9.0.0\": engines error naming the host version and the range"
        status: pass
      - kind: integration
        ref: "test/doctor.test.cjs#an installed manifest with a gate when on an undeclared key: render:discuss:pre error with the host reason"
        status: pass
    human_judgment: false
  - id: D3
    description: "Duplicate-install and discuss-bypass warnings, gsd-core-located error, disabled-project skip, warn-only exit 0"
    requirement: GATE-06
    verification:
      - kind: integration
        ref: "test/doctor.test.cjs (cases 11-15)"
        status: pass
    human_judgment: false
  - id: D4
    description: "INST-05 bundle hygiene: builtin-or-relative requires, no symlink or node_modules, synchronous router, pack list equals the whitelist"
    requirement: INST-05
    verification:
      - kind: unit
        ref: "test/bundle.test.cjs (cases 1-4)"
        status: pass
    human_judgment: false
  - id: D5
    description: "D-20 read-only doctor and stateless gate: snapshots unchanged after sequential and concurrent runs, zero memanto spawns"
    requirement: TEST-02
    verification:
      - kind: integration
        ref: "test/bundle.test.cjs#the gate and doctor (both forms), sequentially and concurrently, write nothing and spawn no memanto"
        status: pass
    human_judgment: false

duration: 10min
completed: 2026-11-21
status: complete
---

# Phase 1 Plan 06: Memanto Doctor and Bundle Hygiene Summary

**`gsd_run memanto doctor` (and `node <bundle>/memanto.cjs doctor`) reports the four fail-open states (not loaded, not consented, outside engines.gsd, not rendering) as errors, plus duplicate installs, the discuss bypass and the gate's own checks. Tests prove the bundle is zero-dependency, synchronous, whitelisted and read-only.**

## Performance

- **Duration:** about 10 min
- **Started:** 2026-11-21T04:38:52Z
- **Completed:** 2026-11-21T04:49:00Z
- **Tasks:** 3
- **Files:** 9 changed (5 created source/test files, 2 RED evidence records, capability.json and test/install.test.cjs modified)

## Accomplishments
- The manifest declares the `memanto` command family. `route(ctx)` is synchronous and prints one `<status> <id>  <message>` line per check, with a `fix:` line under each non-ok check, a summary line and the direct-form line. `--raw` prints `{checks:[{id,status,message,fix}]}`. Doctor exits 1 on any error and 0 when the worst result is a warning.
- Doctor runs these checks in order: `gsd-core-located` (locate, then a runtime-identity check), `enabled`, `loaded`, `consent` (both OD-3 cases), `engines` (host version plus manifest range), `render:<point>` for every declared point (with the host's own load-failure reason), `duplicate-install`, `discuss-bypass`, and then the gate checks from `scripts/check-probe.cjs`.
- Not-loaded fix hints say to reinstall with `gsd-tools capability install npm:@taoc/gsd-memanto@<version> --yes` or `node tools/stage-bundle.cjs`. They never suggest `gsd_run config-set`.
- `test/bundle.test.cjs` checks that the gate and both doctor forms, run in sequence and concurrently, leave the installed bundle, the temp GSD_HOME and the project byte-identical with zero memanto spawns. No host cache exclusion was needed.

## Task Commits

1. **Task 1 RED: failing doctor tests (both forms, output contract)** - `224766f` (test)
2. **Task 1 GREEN: commands entry, memanto.cjs, check-probe** - `b4711b1` (feat)
3. **Task 2 RED: failing fail-open/duplicate/bypass tests** - `2208234` (test)
4. **Task 2 GREEN: lib/gsd-host.cjs and the host-state checks** - `708917c` (feat)
5. **Task 3: bundle hygiene and read-only characterization** - `10afeb4` (test)

No REFACTOR commits.

## TDD Gate Compliance

- **Task 1 RED** (`224766f`): `node --test --test-reporter=tap test/doctor.test.cjs` exit 1. Target `gsd_run memanto doctor --raw on a healthy installed project exits 0 with ok gate checks` failed on its exit-code assertion (`Error: Unknown command: memanto`). The classifier returned `RED_EVIDENCE_OK` (target_test_failed, tap). Semantic assessment: the target ran against the real host and failed for the intended reason (no commands entry yet). There was no load or fixture fault. Record: `evidence/01-06-task1-red.json`.
- **Task 1 GREEN** (`b4711b1`): 5/5 pass.
- **Task 2 RED** (`2208234`): the same command exited 1. Target `an installed manifest edited to engines.gsd ">=9.0.0": engines error naming the host version and the range` failed on its exit-code assertion: doctor exited 0 with only the gate checks. The classifier returned `RED_EVIDENCE_OK`. Semantic assessment: all 10 new cases fail on assertions because the host-state checks are missing. Three `TypeError`s on missing records were turned into explicit `assert.ok` guards before the RED commit. Record: `evidence/01-06-task2-red.json`.
- **Task 2 GREEN** (`708917c`): 15/15 pass.
- Task 3 is characterization of existing artifacts (a TDD exception declared in the plan). It passed on its first run. A scan sanity check printed the real require targets of every shipped file.

## Files Created/Modified
- `memanto.cjs` - command module: `route`, doctor checks, text and JSON renderers, direct shim
- `lib/gsd-host.cjs` - `locateGsdTools`, `hostIdentity`, `capabilityList`, `renderHooksAt`
- `scripts/check-probe.cjs` - prints `runGateChecks` records as JSON and always exits 0
- `capability.json` - `commands` entry for the memanto family (`subcommands: ["doctor"]`)
- `test/doctor.test.cjs` - 15 real-host cases covering both forms and every fail-open state
- `test/bundle.test.cjs` - INST-05 static, router, pack-list and D-20 read-only cases
- `test/install.test.cjs` - updated for the new executable surface (see Deviations)

## Decisions Made
See `key-decisions` in the frontmatter. The most important one is that the check-probe spawn has no time bound, pending an owner decision (see Deviations 2).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug caused by this plan] install.test's gate-only host fact broke once the release bundle gained a command family**
- **Found during:** Task 1 GREEN (full suite)
- **Issue:** `host behavior: the gate-only manifest installs without --yes` staged the real bundle. With the `commands` entry, the host counts an executable surface, so the install reports `aborted`. 01-01 predicted this change.
- **Fix:** That test now strips `commands` and `memanto.cjs` from a staged copy, so the host fact (gate predicates are not consent-gated) stays pinned. A new test asserts that the release bundle without `--yes` reports `aborted` and leaves no ledger entry or bundle. This file is outside the plan's `files_modified`, and no sibling plan in the wave touches it.
- **Files modified:** test/install.test.cjs
- **Verification:** test/install.test.cjs 7/7 pass; npm test 172/172
- **Committed in:** `b4711b1`

**2. [Hook-blocked plan detail] No 15 s time bound on the check-probe spawn**
- **Found during:** Task 1 GREEN
- **Issue:** The plan asks for a 15-second bound on `spawnSync(check-probe)`. The owner's timeout-guard hook blocked the write. The hook lets the value through only after the owner (not the agent) types the hook's confirmation phrase for the probe-timeout constant.
- **Fix:** No time-bound value was written. The probe's run time is bounded by the gate's own owner-confirmed 5 s parallel health budget (`lib/health.cjs`). A hang outside the health calls, such as a FIFO config file, would hang doctor until the owner interrupts it. The gate itself is still bounded by the host's 20 s predicate timeout.
- **Follow-up:** If the owner wants the bound, the owner confirms the hook phrase and then adds the 15 s option to the spawn in `memanto.cjs` `gateChecks`.
- **Committed in:** `b4711b1`

---

**Total deviations:** 2 (1 test fix caused by the plan's own change, 1 plan detail blocked by a hook and left for the owner to decide)
**Impact on plan:** All truths hold. The read-only and concurrency truths are proven. The only gap is the missing doctor-side bound on a probe hang.

## Issues Encountered
- CodeGraph has no index in this worktree, and the dispatch forbids `codegraph init`. The CodeGraph-first read guard was satisfied by running the sanctioned `codegraph node -f` call (it reports no index) before each Read.
- The per-plan commit ledger under the shared `.git/worktrees/` directory was not written, as in 01-02 and 01-04. `plan_head_before` is the base the worktree_branch_check verified (`2251410`). `commits: 5` was measured with `git rev-list --count 2251410..HEAD` before the SUMMARY commit.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: repo-planted-host-binary | lib/gsd-host.cjs | In the direct form, with GSD_CORE_DIR unset, doctor looks for `<project>/gsd-core/bin/gsd-tools.cjs` and `<project>/.claude/gsd-core/bin/gsd-tools.cjs` before `~/.claude`. It then executes the first one found to ask its runtime identity. A cloned repo could plant a script that answers `@opengsd/gsd-core`, so the T-01-23 identity check stops accidental mismatches but not a hostile binary. Under `gsd_run` this cannot happen, because the running gsd-tools is found first. The plan specified this order (RESEARCH Pattern 5). The gate command also falls back to the repo-local `.gsd/capabilities/memanto`, so the trust posture is unchanged. The owner may want config homes searched before the project root. |

## Known Stubs
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 01-08 README can cite the doctor forms, the check ids above, and the reinstall fix text.
- 01-09 acceptance can run `gsd_run memanto doctor` against the live endpoints.
- Open owner decisions: confirm or decline the 15 s probe bound (Deviation 2), and the locate order (Threat Flags).

## Self-Check: PASSED
- FOUND: memanto.cjs, lib/gsd-host.cjs, scripts/check-probe.cjs, test/doctor.test.cjs, test/bundle.test.cjs, evidence/01-06-task1-red.json, evidence/01-06-task2-red.json
- FOUND commits (ancestors of HEAD): 224766f, b4711b1, 2208234, 708917c, 10afeb4
- Plan verification: `node --test --test-reporter=tap test/doctor.test.cjs test/bundle.test.cjs` exit 0 (20/20). `npm test` exit 0 (172 tests, 0 fail).
- Acceptance: commands-entry check exit 0, `route` export check exit 0, gsd-host exports check exit 0. doctor.test.cjs runs `capability trust revoke` and edits engines to `>=9.0.0`. bundle.test.cjs uses `Promise.all` for the concurrent run.

## Post-merge owner fixes

Applied after the 01-06 merge as an orchestrator-dispatched gap fix (no PLAN.md). Both decisions were made by the owner in the orchestrator session on 2026-11-20. The work was done test-first (`workflow.tdd_mode=true`). Base `28c37fe`. Four commits: `09ba994`, `377ae49`, `a62992b`, `6d5946c`.

**1. Resolves Deviation 2: the check-probe spawn is now time-bounded.**
- The owner typed the hook's confirmation phrase for `PROBE_TIMEOUT_MS = 15000`. The timeout-guard hook allowed the write, so no bypass was needed and the constant was written as named.
- `memanto.cjs` `gateChecks(cwd, { probe, timeoutMs })` passes `timeout: PROBE_TIMEOUT_MS` (15000 ms) to the check-probe `spawnSync`. On `ETIMEDOUT` it returns one `check-probe` error, "check probe timed out after <ms> ms and was stopped (<signal>)...", with a fix line saying the config files must be regular readable files. A hang, such as a FIFO config file, now ends in a reported error, not a hung doctor. `probe` and `timeoutMs` can be injected only so tests run fast. `gateChecks` and `PROBE_TIMEOUT_MS` are exported next to `route`.
- RED `09ba994`: two new cases in `test/doctor.test.cjs` failed on their own assertions (`PROBE_TIMEOUT_MS` was undefined, and `gateChecks` was not exported). The other 15 cases passed. The classifier returned `RED_EVIDENCE_OK` (target_test_failed, tap). Record: `evidence/01-06-fix1-red.json`. GREEN `377ae49`: doctor and bundle tests pass 22/22. The never-exiting probe stand-in returns in about 300 ms.

**2. Resolves the `repo-planted-host-binary` threat flag: user config homes are searched before the project.**
- New `lib/gsd-host.cjs` `candidates` order: `GSD_CORE_DIR` (still wins outright when set), then the running gsd-tools under `gsd_run`, then `${CLAUDE_CONFIG_DIR:-~/.claude}/gsd-core/bin`, then `${OPENCODE_CONFIG_DIR:-~/.config/opencode}/gsd-core/bin`, and only then `<project>/gsd-core/bin` and `<project>/.claude/gsd-core/bin`.
- **This deliberately departs from RESEARCH Pattern 5 and from gsd-core's own `gsd_run` resolver order**, both of which search the project first. The owner chose this so that a cloned repo cannot plant a `gsd-tools.cjs` that doctor would run ahead of the user's own install. Project-local candidates are still used as a fallback when no config home has gsd-core. The running gsd-tools keeps second place because, under `gsd_run`, it is the host that is already executing.
- RED `a62992b`: new `test/gsd-host.test.cjs` has 4 cases. Each runs `locateGsdTools` in a child process with a temp HOME, and the temp HOME and project dirs each hold a `gsd-tools.cjs` identity stub. The target case and the opencode case failed on the version assertion: the stub at `<project>/gsd-core` (`project-root`) was chosen first. The `GSD_CORE_DIR`-wins case and the fallback case passed. The classifier returned `RED_EVIDENCE_OK`. Record: `evidence/01-06-fix2-red.json`. GREEN `6d5946c`: 4/4 pass.

**Verification:** `npm test` passes 188 tests: 187 pass, 0 fail, 1 skipped (182 before the fixes, plus 2 doctor cases and 4 gsd-host cases). STATE.md and ROADMAP.md were not changed, as the dispatch required. The README has no locate-order or probe-bound text to update.

**Open owner decisions from this plan:** none remain.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-21*
