---
phase: 01-walking-skeleton
plan: "01"
subsystem: capability-bundle
tags: [gsd-core, capability, node-test, command-exit-zero, cjs, zero-deps]

requires: []
provides:
  - "capability.json phase-1 manifest (id memanto, four memanto.* keys, activationKey memanto.enabled, one blocking discuss:pre command-exit-zero gate)"
  - "lib/config.cjs resolveConfig/loadManifestDefaults (fail-closed on unreadable config)"
  - "lib/checks.cjs runGateChecks/renderGateFailures/BREAK_GLASS/CHECK_ORDER (config-unreadable, agent-id)"
  - "scripts/gate.cjs fail-closed gate entrypoint"
  - "tools/stage-bundle.cjs npm-pack file-set staging + real-host install (temp GSD_HOME default, --real opt-in)"
  - "tools/run-tests.cjs npm test runner asserting more than one test ran"
  - "test/helpers/gsd-env.cjs hermetic real-host harness"
affects: [01-02, 01-03, 01-04, 01-05, 01-06, 01-07, 01-08, 01-09]

actuals:
  tokens: 9318
  tasks: 2
  commits: 3
plan_head_before: 0543ed2a547080db400e78807c6841b3b41668a0
plan_head_after: 6d2230bac96e20645969836e1e366b6dc7e1a2a0

tech-stack:
  added: []
  patterns:
    - "Gate command is a static sh string resolving ${GSD_HOME:-$HOME}; config is read in-process, never interpolated"
    - "Every test installs the npm pack file set through gsd-core's real installer into a temp GSD_HOME"
    - "Check records {id,status,message,fix} ordered by CHECK_ORDER, rendered as D-04 lines plus break-glass last"

key-files:
  created:
    - package.json
    - capability.json
    - lib/config.cjs
    - lib/checks.cjs
    - scripts/gate.cjs
    - tools/stage-bundle.cjs
    - tools/run-tests.cjs
    - test/helpers/gsd-env.cjs
    - test/skeleton.test.cjs
    - test/install.test.cjs
    - test/activation.test.cjs
    - .planning/phases/01-walking-skeleton/evidence/01-01-task1-red.json
  modified: []

key-decisions:
  - "Install-abort test runs on a copy of the staged bundle with a commands entry and stub memanto.cjs added (owner decision): gsd-core's capability-trust hasExecutable counts hooks, commands, mcpServers and reviewer lanes only, so the gate-only manifest installs without --yes"
  - "A config.json that exists but cannot be read (EACCES, EISDIR) blocks as config-unreadable with a 'cannot be read' message, in addition to the planned malformed-JSON case"

patterns-established:
  - "Harness gsd() refuses to spawn without an explicit temp GSD_HOME"
  - "Characterization tests of host behavior pin facts the capability relies on (gate-only bundle needs no consent)"

requirements-completed: [INST-01, INST-05, CONF-01, CONF-02, TEST-01]

coverage:
  - id: D1
    description: "Staged release file set installs globally; discuss:pre gate blocks on empty memanto.agent_id with the D-04 agent-id line and break-glass, and passes once set"
    requirement: CONF-02
    verification:
      - kind: integration
        ref: "test/skeleton.test.cjs#gate blocks with the agent-id line and break-glass when memanto.agent_id is empty"
        status: pass
      - kind: integration
        ref: "test/skeleton.test.cjs#gate passes once memanto.agent_id is set"
        status: pass
    human_judgment: false
  - id: D2
    description: "Install contract: file set only, ledger entry, abort without --yes leaves nothing, reinstall and remove, gsd-core bin/workflows byte-identical"
    requirement: INST-01
    verification:
      - kind: integration
        ref: "test/install.test.cjs#fresh install reports installed and places the release file set only"
        status: pass
      - kind: integration
        ref: "test/install.test.cjs#install, render-hooks and check predicate leave gsd-core bin and workflows unchanged"
        status: pass
      - kind: integration
        ref: "test/install.test.cjs#install without --yes of a bundle with an executable surface reports aborted and leaves nothing behind"
        status: pass
      - kind: integration
        ref: "test/install.test.cjs#re-install reports installed and remove leaves no bundle and no ledger entry"
        status: pass
    human_judgment: false
  - id: D3
    description: "Only the literal boolean true in memanto.enabled renders a memanto hook (false, absent, \"false\", \"true\", 1, null render none; plan:pre empty when false)"
    requirement: CONF-01
    verification:
      - kind: integration
        ref: "test/activation.test.cjs (8 tests)"
        status: pass
    human_judgment: false
  - id: D4
    description: "npm test runs test/**/*.test.cjs via tap and fails on a failed run or one test or fewer"
    requirement: TEST-01
    verification:
      - kind: other
        ref: "npm test (20 tests, exit 0); scratch probe with a single test exits 1 and prints 'expected more than one test, got 1'"
        status: pass
    human_judgment: false
  - id: D5
    description: "Zero-dependency CJS release file set (INST-05): package.json has no dependencies/devDependencies; staged set contains capability.json, lib/, scripts/, package.json only"
    requirement: INST-05
    verification:
      - kind: other
        ref: "node tools/stage-bundle.cjs --stage-only --json (staged tree inspected: no tools/, test/)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-11-21
status: complete
---

# Phase 1 Plan 01: Walking Skeleton Tracer Summary

**Zero-dependency `memanto` capability whose staged npm file set installs through gsd-core 1.20.1's real installer into a temp GSD_HOME and renders one blocking `discuss:pre` command-exit-zero gate that halts on an empty `memanto.agent_id` and passes once it is set, with a hermetic real-host test harness.**

## Performance

- **Duration:** about 6 min
- **Started:** 2026-11-21T03:31:42Z
- **Completed:** 2026-11-21T03:37:07Z
- **Tasks:** 2
- **Files created:** 12 (11 planned + RED evidence record)

## Accomplishments
- Tracer path proven end to end on gsd-core 1.20.1: stage, global install, enable, `loop render-hooks discuss:pre`, `check predicate` returns `block:true` with `command exited 1: memanto: BLOCKED [agent-id] ...` plus the break-glass line, then `block:false` once agent_id is set.
- Fail-closed gate: malformed or unreadable config blocks as `config-unreadable`; any internal error blocks as `gate-internal`; a missing gate script makes node exit non-zero (blocks).
- Install contract (INST-01) and activation switch (CONF-01) regression-tested against the real host; gsd-core `bin/` and `workflows/` snapshot (size, mtime, sha256) identical before and after install, render and predicate.
- Harness `test/helpers/gsd-env.cjs` exports every interface name in the plan (`coreDir`, `gsd`, `tmpDir`, `makeProject`, `stageBundle`, `installBundle`, `renderHooks`, `memantoHooks`, `checkPredicate`, `loadRegistry`, `snapshotTree`, `realConsentStamp`, `cleanup`), plus `writeConfig`, `installArgs`, `REPO_ROOT`.

## Task Commits

1. **Task 1 (tracer) RED: failing tracer test + test infrastructure** - `61eb6ee` (test)
2. **Task 1 (tracer) GREEN: manifest, config, checks, gate** - `eb81b7e` (feat)
3. **Task 2: install/activation characterization tests + npm test runner** - `6d2230b` (test)

No REFACTOR commit (no cleanup needed).

## TDD Gate Compliance

- **RED** (`61eb6ee`): `node --test --test-reporter=tap test/skeleton.test.cjs` exit 1; target test `discuss:pre renders one blocking memanto gate` failed on its planned assertion (`0 !== 1` memanto hooks). Classifier `gsd-tools check tdd-red-evidence` returned `RED_EVIDENCE_OK` (reason `target_test_failed`, format tap). Semantic assessment: the target executed and failed for the intended reason (no capability.json, so the staged package.json-only set is refused by `capability install` and nothing renders); no syntax, load or fixture fault, and the harness consent test passed. Record: `.planning/phases/01-walking-skeleton/evidence/01-01-task1-red.json`.
- **GREEN** (`eb81b7e`): same command, 5/5 pass.
- Task 2 is characterization of host behavior over the Task 1 manifest (plan-declared TDD exception); its tests passed on first run, and the activation cases discriminate (boolean true yields 1 hook, all others 0).
- Tracer feedback gate: not auto mode, `human_verify_mode` end-of-phase, `<verify>` automated-only, so verify was re-run (pass) and expansion continued.

## Files Created/Modified
- `package.json` - `@taoc/gsd-memanto` 0.0.0, files whitelist, `npm test` -> `node tools/run-tests.cjs`, no dependencies
- `capability.json` - phase-1 manifest; gate command `d="${GSD_HOME:-$HOME}/.gsd/capabilities/memanto"; [ -f "$d/scripts/gate.cjs" ] || d=".gsd/capabilities/memanto"; exec node "$d/scripts/gate.cjs"`, timeout 20
- `lib/config.cjs` - `resolveConfig({cwd, env})`, `loadManifestDefaults()`; `configDirs()` is the single seam for plan 01-03's workstream/project directories
- `lib/checks.cjs` - `runGateChecks`, `renderGateFailures`, `BREAK_GLASS`, `CHECK_ORDER`
- `scripts/gate.cjs` - gate entrypoint; requires checks inside the try so a broken require also blocks
- `tools/stage-bundle.cjs` - stage-only, temp home default, `--home`, `--real` (refuses `--home`), `--scope project --project`, `--json`; aborts on symlinks, non-regular files and paths outside the repo
- `tools/run-tests.cjs` - tap runner with the more-than-one-test assertion
- `test/helpers/gsd-env.cjs`, `test/skeleton.test.cjs`, `test/install.test.cjs`, `test/activation.test.cjs`

## Decisions Made
- See `key-decisions` in frontmatter (abort test on a commands-bearing copy; unreadable config also fails closed).
- Descriptions in the manifest name no host and no agent id; no default agent id ships.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, plan defect; owner decision] Abort-without-`--yes` test cannot pass on the Task 1 manifest**
- **Found during:** Task 2 (install contract)
- **Issue:** The plan's truth "an install run without --yes reports status aborted" is false for the gate-only manifest: gsd-core `capability-trust.cjs` `discloseExecutableSurfaces` (`hasExecutable`, about line 635) counts hooks, command modules, mcpServers and reviewer lanes only. A gate `command-exit-zero` predicate is not an executable surface, so the install succeeds without consent (observed disclosure: "This capability ships no executable surfaces (declarative only)").
- **Fix:** Per the owner decision, the abort test builds a copy of the staged bundle with `commands: [{family:"memanto", module:"memanto.cjs", router:"route"}]` and a stub `memanto.cjs`, asserts `aborted`, non-zero exit, no ledger entry and no bundle dir, then re-runs with `--yes` and asserts `installed`. A separate characterization test pins the host fact that the gate-only manifest installs without `--yes`. The abort truth will apply to the real bundle once plan 01-06 adds the doctor command family.
- **Files modified:** test/install.test.cjs
- **Verification:** test/install.test.cjs 6/6 pass
- **Committed in:** `6d2230b`

**2. [Rule 2 - Missing critical] Unreadable (not only malformed) config.json fails closed**
- **Found during:** Task 1 (lib/config.cjs)
- **Issue:** The plan specified only the JSON-parse failure. A config.json that exists but cannot be read (EACCES, EISDIR) would otherwise throw or be mistaken for absent.
- **Fix:** `resolveConfig` returns `{ok:false, path, error, kind:'read'|'parse'}`; `config-unreadable` uses `<path> cannot be read (<error>)` / `make <path> readable` for read errors and the planned message for parse errors. The added `kind` field is additive to the interface.
- **Files modified:** lib/config.cjs, lib/checks.cjs
- **Committed in:** `eb81b7e`

**3. [Rule 3 - Blocking] Harness reports a refused install as an assertion, not a JSON parse crash**
- **Found during:** Task 1 RED
- **Issue:** A refused `capability install` prints its reason on stderr with empty stdout, so `installBundle` threw a parse error instead of a clean assertion failure.
- **Fix:** `installBundle` parses stdout best-effort and asserts `status === 'installed'` with stdout and stderr in the message.
- **Files modified:** test/helpers/gsd-env.cjs
- **Committed in:** `61eb6ee`

---

**Total deviations:** 3 auto-fixed (1 owner-decided plan defect, 1 missing critical, 1 blocking)
**Impact on plan:** No scope creep; all interface names unchanged; additions are additive.

## Issues Encountered
- None beyond the deviations above.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: consent-disclosure-gap | capability.json | Host behavior (gsd-core 1.20.1): a gate `command-exit-zero` predicate runs `sh -c` at the project root, yet `capability install` reports "ships no executable surfaces (declarative only)" and installs without `--yes`. Consent disclosure does not mention the gate command. Not fixable inside the capability; pinned by test/install.test.cjs "host behavior: the gate-only manifest installs without --yes". |

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plans 01-02 to 01-09 can build on `lib/config.cjs`, `lib/checks.cjs` and `test/helpers/gsd-env.cjs` unchanged.
- 01-02 adds mempalace, backend/api url and health checks in `CHECK_ORDER` order and the output budget cap (no per-message cap exists yet).
- 01-03 adds workstream/project directories in `configDirs()`.

## Self-Check: PASSED

All 11 planned files exist; commits 61eb6ee, eb81b7e and 6d2230b are on the branch; plan verification (`node --test` on the three files: 20/20; `npm test`: 20 tests, exit 0; `node tools/stage-bundle.cjs --json`: status installed) re-run green.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-21*
