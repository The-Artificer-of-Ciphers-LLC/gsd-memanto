---
phase: 01-walking-skeleton
plan: "04"
subsystem: testing
tags: [gsd-core, capability-loader, validateHooksWired, getWiredKinds, node-test, conformance]

requires:
  - phase: 01-01
    provides: "test/helpers/gsd-env.cjs real-host harness, staged release bundle, shipped capability.json"
provides:
  - "INST-02 zero-memanto-warning load through the real loadRegistry plus capability list status active"
  - "INST-03 per-host dispatch oracle (getWiredKinds + validateHooksWired) with negative fixtures"
  - "INST-04 five loader traps reproduced at both install and loader layers, plus static manifest assertions"
affects: [01-05, 01-06, every later plan that adds a gate, step or contribution to capability.json]

actuals:
  tokens: 4268
  tasks: 2
  commits: 2
plan_head_before: 65ed61ca0b9c9c8b6f2ac6972fd482653a889e20
plan_head_after: b64f91d06a6f2f16bf781c0048f451e6e09ed485

tech-stack:
  added: []
  patterns:
    - "Host oracle conformance: tests require gsd-core's own loader, validator and dispatch scanner from GSD_CORE_DIR and never hand-maintain a dispatch table"
    - "Two-layer trap fixture: the patched bundle is refused by capability install AND skipped by the loader when placed in the install root"
    - "Tests read capability.json at run time and iterate every declared hook, so later manifest additions stay covered"

key-files:
  created:
    - test/manifest.test.cjs
    - test/dispatch.test.cjs
    - test/traps.test.cjs
  modified: []

key-decisions:
  - "Each trap is asserted at both host layers: 1.20.1 capability install refuses every trap bundle with the reason on stderr (exit 1), and the loader skips the same manifest placed in the install root with a warning naming the trap"
  - "The reserved-prefix trap's install refusal reads 'uses the reserved namespace \"gsd-\"' while the loader reads 'reserved first-party prefix'; the install assertion matches /reserved/, the loader assertion matches /reserved first-party prefix/"
  - "The execute:pre negative fixture derives its expectation from wired.get('execute:pre')?.has('gate'), so the same test passes on the 1.20.1 floor (rejected) and on 1.22.0 (accepted)"

patterns-established:
  - "Zero-warning assertions filter _overlay.warnings by id === 'memanto' and separately allow at most one host .staging warning (F3)"

requirements-completed: [INST-02, INST-03, INST-04, TEST-01]

coverage:
  - id: D1
    description: "Installed manifest loads through the real loader with no memanto warnings and no diagnostics, and capability list shows memanto active"
    requirement: INST-02
    verification:
      - kind: integration
        ref: "test/manifest.test.cjs"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every declared hook sits at a (point, kind) pair the host under test dispatches, computed from the host's own scanner; undispatched gates at execute:wave:pre, verify:post and (per host) execute:pre are rejected"
    requirement: INST-03
    verification:
      - kind: integration
        ref: "test/dispatch.test.cjs"
        status: pass
    human_judgment: false
  - id: D3
    description: "Five loader traps are reproduced by negative fixtures at install and loader level, and the shipped manifest avoids them"
    requirement: INST-04
    verification:
      - kind: integration
        ref: "test/traps.test.cjs"
        status: pass
    human_judgment: false
  - id: D4
    description: "npm test runs the full suite including the three new files and exits 0"
    requirement: TEST-01
    verification:
      - kind: other
        ref: "npm test (52 tests, 52 pass, exit 0)"
        status: pass
    human_judgment: false

duration: 12min
completed: 2026-11-21
status: complete
---

# Phase 1 Plan 04: Manifest, Dispatch and Loader-Trap Conformance Summary

**Three real-host conformance suites: a zero-memanto-warning load through gsd-core's loadRegistry, a per-host dispatch check through getWiredKinds + validateHooksWired with negative fixtures, and five loader traps that each install refuses and the loader skips with the expected reason**

## Performance

- **Duration:** about 12 min
- **Started:** 2026-11-21T03:39Z
- **Completed:** 2026-11-21T03:51:35Z
- **Tasks:** 2
- **Files modified:** 3 (all created)

## Accomplishments

- `test/manifest.test.cjs` (8 tests): installs the staged bundle into a temp GSD_HOME, then asserts `registry.capabilities.memanto` exists, `_overlay.warnings` filtered by `id === 'memanto'` is `[]`, `_overlay.diagnostics` is `[]`, at most the host `.staging` warning remains, `capability list --raw` reports memanto `active`, and the static manifest shape (role, tier, engines, runtimeCompat, no skills/agents/hooks/mcpServers, the four config defaults, activationKey).
- `test/dispatch.test.cjs` (9 tests): `validateHooksWired(cap, getWiredKinds(dirname(GSD_CORE_DIR)))` is `[]` for the shipped manifest and for an emptied copy. Guards: nothing at execute:pre, no gate at verify:post, ship:post or execute:wave:pre. Negative fixtures: a gate at execute:wave:pre and at verify:post are both rejected, and a gate at execute:pre is rejected exactly when the host does not dispatch gates there. Two consecutive `render-hooks discuss:pre` calls return identical `activeHooks`.
- `test/traps.test.cjs` (15 tests): five traps, each shown twice. `capability install` refuses the patched bundle and names the reason, and the loader skips the same manifest placed in the install root and records a warning with the reason (texts `duplicate-producer`, `never produced by any host artifact`, `is not in the step's agentRoles`, `is not defined in capability config keys`, reserved prefix). Then static INST-04 assertions on the shipped manifest, plus a check that the shipped bundle installs with zero memanto warnings.
- Mutation check: after a verify:post gate was added to capability.json, `validateHooksWired accepts the shipped manifest` and the verify:post guard both failed. capability.json was then restored.

## Task Commits

1. **Task 1: Installed manifest loads clean and every hook is at a dispatched pair** - `ca94185` (test)
2. **Task 2: Every loader trap reproduced and absent from the shipped manifest** - `b64f91d` (test)

## Files Created/Modified

- `test/manifest.test.cjs` - INST-02 real-loader zero-warning load and manifest shape
- `test/dispatch.test.cjs` - INST-03 per-host dispatch oracle and negative fixtures
- `test/traps.test.cjs` - INST-04 two-layer trap fixtures and static manifest assertions

## Decisions Made

- Each trap is asserted at both host layers, not just one. On the 1.20.1 host, `capability install` already refuses every trap bundle. A loader-only fixture could only be built by placing a manifest by hand, and an install-only fixture would miss a manifest that changes after install. Testing both covers both ways a trap can reach a project.
- The execute:pre expectation is computed from the host's wired kinds, not from a version string.

## Deviations from Plan

None that change scope. Two notes:

- The plan's `installBundle tolerates a non-installed status` wording does not match the 01-01 helper, which asserts `installed`. The trap tests therefore call `env.gsd(installArgs(...))` directly for the refusal path. They use `env.installBundle` only for the clean install that comes before placing the trap manifest. The helper was not modified.
- The per-plan commit ledger file (`<git-dir>/gsd-plan-head-before-01-04`) could not be written: the isolated-agent sandbox refuses writes to the shared `.git/worktrees/` path. `plan_head_before` is the base SHA the orchestrator's worktree_branch_check verified (65ed61c), and `commits` was measured with `git rev-list --count 65ed61c..HEAD`.

## TDD Gate Compliance

workflow.tdd_mode is on, but this is a `type: execute` plan whose tasks are `type="auto"` with no `tdd="true"`. The plan declares a TDD exception: these are characterization tests of artifacts that already exist, with no production code. They were expected to pass on first run, and they did. Two checks took the place of a RED step: the verify:post mutation check above, and the negative fixtures inside each suite. There are no `feat(01-04)` commits.

## Issues Encountered

- A CodeGraph index (`.codegraph/`) was built in the worktree, as the owner's worktree instructions require. It is untracked and was not committed.

## User Setup Required

None.

## Next Phase Readiness

- Plans 01-05 (discuss:pre contribution) and 01-06 (commands array) are covered automatically. All three suites read capability.json at run time, so an invalid into, a non-host consumes or an undispatched pair added there fails `npm test`.
- CI should run these suites on both the 1.20.1 floor and the latest gsd-core (T-01-13). Only the floor leg was exercised here (installed host 1.20.1).

## Self-Check: PASSED

- FOUND: test/manifest.test.cjs, test/dispatch.test.cjs, test/traps.test.cjs
- FOUND commits: ca94185, b64f91d (ancestors of HEAD)
- `node --test --test-reporter=tap test/manifest.test.cjs test/dispatch.test.cjs test/traps.test.cjs`: 32 pass, 0 fail
- `npm test`: exit 0, 52 tests, 52 pass

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-21*
