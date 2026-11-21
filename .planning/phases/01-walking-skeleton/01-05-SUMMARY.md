---
phase: 01-walking-skeleton
plan: "05"
subsystem: spike
tags: [gsd-core, capability, spike, headless, claude-p, gate, command-exit-zero, ref-command, node-test]

requires:
  - phase: 01-01
    provides: "staged bundle, scripts/gate.cjs, tools/stage-bundle.cjs, test/helpers/gsd-env.cjs"
provides:
  - "01-SPIKE.md with Q1 POSITIVE (host + live headless), Q2 POSITIVE (host), Q3 source-level POSITIVE, D-07 exception record, discuss:pre bypass list; Q3 installer section reserved for 01-07 and Acceptance section for 01-09"
  - "test/spike-regression.test.cjs: 9 D-10 regression tests (gate render/block, missing-script block, ship:pre variant block, ref.command dispatch, readInstalledCapabilitySkill, discuss-phase.md and ship.md prose guards, consent untouched)"
affects: [01-06, 01-07, 01-08, 01-09, phase-02-gates]

actuals:
  tokens: 7344
  tasks: 2
  commits: 2
plan_head_before: 65ed61ca0b9c9c8b6f2ac6972fd482653a889e20
plan_head_after: 3fb7f4d7786f153a136f5452c0a3d7ca276c78a9

tech-stack:
  added: []
  patterns:
    - "Characterization tests build throwaway capabilities (id memanto) from scratch in temp dirs and install them through the real installer into a temp GSD_HOME"
    - "Live LLM probes: claude -p with an explicit --allowedTools list, --permission-mode dontAsk, --no-session-persistence, --max-budget-usd cap, transcripts in the scratchpad"

key-files:
  created:
    - test/spike-regression.test.cjs
    - .planning/phases/01-walking-skeleton/01-SPIKE.md
  modified: []

key-decisions:
  - "Q1 answered POSITIVE from live runs: 5/5 headless discuss runs and 2/2 ship runs halted on the memanto gate, so the D-09 reinforcing contribution was not shipped and capability.json is unchanged"
  - "Added two neutral-project discuss runs (no mention of memanto or gates) because the first probe project's PROJECT.md/REQUIREMENTS.md named the gate and could prime the LLM"
  - "Added a second ship run with workflow.security_enforcement false, because the first-party security ship gate also blocked in the first run and confounded attribution"
  - "Used --no-session-persistence so no session transcript lands in the real ~/.claude; left the 7 empty ~/.claude/projects/<probe>/memory dirs in place rather than writing the real home again to delete them"

patterns-established:
  - "Every positive spike answer that runs without an LLM is pinned by a node:test case naming the spike question"
  - "Workflow prose guards read the installed gsd-core workflow text under coreDir() so a gsd-core update that drops the dispatch step fails CI"

requirements-completed: [INST-03, TEST-01]

coverage:
  - id: D1
    description: "Q1 host layer: discuss:pre gate renders blocking and blocks on empty agent_id; missing gate script blocks; ship:pre variant renders and blocks"
    requirement: INST-03
    verification:
      - kind: integration
        ref: "test/spike-regression.test.cjs#Q1 host: discuss:pre renders the memanto gate with blocking true"
        status: pass
      - kind: integration
        ref: "test/spike-regression.test.cjs#Q1 host: check predicate blocks with exit 0 and the BLOCKED message for an empty agent_id"
        status: pass
      - kind: integration
        ref: "test/spike-regression.test.cjs#Q1 host: a bundle whose gate script is missing still blocks (fail closed)"
        status: pass
      - kind: integration
        ref: "test/spike-regression.test.cjs#Q1 host: a ship:pre variant of the gate renders and blocks"
        status: pass
    human_judgment: false
  - id: D2
    description: "Q2: a ref.command step `memanto probe` renders at discuss:pre and gsd_run memanto probe --phase 1 --raw dispatches the third-party family with args [memanto, probe, --phase, 1] and raw true"
    requirement: TEST-01
    verification:
      - kind: integration
        ref: "test/spike-regression.test.cjs#Q2: a ref.command step renders and gsd_run dispatches the third-party memanto family"
        status: pass
    human_judgment: false
  - id: D3
    description: "Q3 source level: readInstalledCapabilitySkill returns capId memanto and the SKILL.md content for a global-scope skill"
    requirement: TEST-01
    verification:
      - kind: integration
        ref: "test/spike-regression.test.cjs#Q3 source level: readInstalledCapabilitySkill reads a skill shipped in a global install"
        status: pass
    human_judgment: false
  - id: D4
    description: "Prose guards: installed discuss-phase.md keeps dispatch_discuss_pre_hooks and render-hooks discuss:pre; ship.md keeps 'Ship blocked by capability gate'"
    requirement: TEST-01
    verification:
      - kind: unit
        ref: "test/spike-regression.test.cjs#prose guard: installed discuss-phase.md still dispatches discuss:pre hooks"
        status: pass
      - kind: unit
        ref: "test/spike-regression.test.cjs#prose guard: installed ship.md still halts on a blocking capability gate"
        status: pass
    human_judgment: false
  - id: D5
    description: "Q1 live layer: real headless /gsd-discuss-phase 1 and --auto runs and /gsd-ship 1 runs halt on the memanto gate (LLM behaviour, recorded in 01-SPIKE.md)"
    requirement: INST-03
    verification:
      - kind: manual_procedural
        ref: "claude -p runs a1, a2, a3, n1, n2, s1, s2 (transcripts in the session scratchpad; per-run table in 01-SPIKE.md ## Q1)"
        status: pass
    human_judgment: true
    rationale: "LLM obedience to dispatch prose is non-deterministic and cannot run in CI; the 01-09 acceptance run on the real home re-observes it"

duration: 13min
completed: 2026-11-21
status: complete
---

# Phase 1 Plan 05: Spike Q1-Q3 Summary

**Live headless `claude -p` runs on gsd-core 1.20.1 show the shipped memanto `discuss:pre` gate halting 5/5 discuss runs (plain, `--auto`, primed and neutral projects) and a `ship:pre` variant halting 2/2 ship runs before any push; Q2 `ref.command` dispatch and Q3 global-skill reading are proven at host level and pinned by 9 regression tests.**

## Performance

- **Duration:** about 13 min from the recorded start (context loading before that)
- **Started:** 2026-11-21T03:49:46Z
- **Completed:** 2026-11-21T04:02:11Z
- **Tasks:** 2
- **Files created:** 2

## Accomplishments
- Q1 POSITIVE. Host layer: the gate renders with `blocking: true`, `check predicate` returns `block: true` with exit 0, a missing gate script also blocks, and a `ship:pre` copy blocks. Live layer: every headless discuss run stopped before `analyze_phase` with no `*-CONTEXT.md` and no commits. Both ship runs stopped before push, and the bare origin kept only `main`.
- Q2 POSITIVE at host level: `gsd_run memanto probe --phase 1 --raw` returned `{"probe":"ok","args":["memanto","probe","--phase","1"],"raw":true}`.
- Q3 source level POSITIVE: `readInstalledCapabilitySkill('memanto-probe', registry)` returned `{capId: "memanto", content: "---\nname: memanto-probe..."}` for a global install. The installer run is left to 01-07 (OD-2).
- discuss:pre bypass paths recorded: `--power`, `--assumptions` and `discuss_mode: "assumptions"`. Each has a `render-hooks` count of 0.
- D-07 exception recorded. `~/.gsd/consent.json` mtime and sha256 were identical before and after the runs. The real `~/.claude` got only 7 empty `projects/<probe>/memory` directories, because `--no-session-persistence` was set.

## Task Commits

1. **Task 1: deterministic spike evidence + regression tests** - `cea02e7` (test)
2. **Task 2: live headless discuss and ship probes, D-07 exception** - `3fb7f4d` (docs)

## Files Created/Modified
- `test/spike-regression.test.cjs` - 9 D-10 regression tests against the installed host
- `.planning/phases/01-walking-skeleton/01-SPIKE.md` - Q1-Q3 answers with evidence, D-07 exception, bypass list. Contains the reserved sections `### Q3 installer run (plan 01-07)` and `## Acceptance run (D-08)`.

## Decisions Made
- No D-09 fallback: variant A halted in every run, so `capability.json` and `fragments/` are untouched.
- Added extra runs to remove confounds: two neutral-project discuss runs (the first probe project's text named the gate) and one ship run with `workflow.security_enforcement: false` (the first-party security gate also blocked in run s1).
- Used `--max-budget-usd 5` as the run cap, because `claude --help` (2.1.330) lists no turn-count flag. The ship runs also denied `gh pr create|merge`, `gh repo` and `gh api`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Excluded hook-created `.memdb/`/`.memtrace/` in the ship probe repo**
- **Found during:** Task 2 (ship probe setup)
- **Issue:** The owner's memtrace SessionStart hook creates `.memdb/` in every project. That would dirty `git status` and stop ship at preflight step 2, before the capability gates.
- **Fix:** Added both directories to the throwaway repo's `.git/info/exclude`.
- **Files modified:** none in the repo (scratchpad only)
- **Verification:** the read-only preflight dry check showed an empty `git status --short`

**2. [Rule 2 - Correctness] Extra runs to remove probe confounds**
- **Found during:** Task 2
- **Issue:** The planned single discuss project named the gate in PROJECT.md and REQUIREMENTS.md, which could prime the LLM. The first ship run was also blocked by the first-party `security` gate.
- **Fix:** Added neutral-project runs n1 (`/gsd-discuss-phase 1`) and n2 (`--auto`), a repeat run a3, and ship run s2 with security enforcement off.
- **Files modified:** `.planning/phases/01-walking-skeleton/01-SPIKE.md`
- **Committed in:** `3fb7f4d`

**3. [Prompt detail] Ship prompt was `/gsd-ship 1`, not `/gsd-ship`**
- The phase argument was passed explicitly so `init.phase-op` resolves the probe phase. Recorded verbatim in 01-SPIKE.md.

---

**Total deviations:** 3 (1 blocking, 1 correctness, 1 prompt detail)
**Impact on plan:** These changes strengthen the Q1 evidence. No scope was added to the shipped bundle.

## Issues Encountered
- **F10 caveat, carried forward.** In all 5 discuss runs the LLM ran the gate's predicate command itself (`timeout 20 node .../gate.cjs` or `sh -c`) instead of `gsd_run check predicate`. In both ship runs it used the verb that `ship.md` names. The run still halted because the command's exit code was surfaced. In every run the LLM first read `scripts/gate.cjs`, and in one run it also grepped `lib/` for network and spawn calls. When 01-02 adds network health checks, the 01-09 acceptance run should re-observe that the LLM still runs the gate rather than refusing it.
- The worktree had no `.codegraph/` index, so `codegraph init -y` was run per the global CLAUDE.md. The resulting `.codegraph/` is untracked and was not committed.

## Known Stubs
None. The reserved 01-SPIKE.md sections `### Q3 installer run (plan 01-07)` ("Pending: plan 01-07") and `## Acceptance run (D-08)` ("pending — plan 01-09") are planned placeholders. Plans 01-07 and 01-09 own them.

## User Setup Required
None. Optional cleanup of the real home: `rm -r ~/.claude/projects/*scratchpad-live*` removes the 7 empty probe directories.

## Next Phase Readiness
- 01-06 (doctor `discuss-bypass` warning) and 01-08 (README) can cite the bypass section of 01-SPIKE.md.
- 01-07 fills `### Q3 installer run (plan 01-07)`. 01-09 fills `## Acceptance run (D-08)` and should re-check the F10 caveat once the URL and health checks from 01-02 are merged.

## Self-Check: PASSED
- FOUND: test/spike-regression.test.cjs
- FOUND: .planning/phases/01-walking-skeleton/01-SPIKE.md
- FOUND: cea02e7 (ancestor of HEAD)
- FOUND: 3fb7f4d (ancestor of HEAD)
- `node --test --test-reporter=tap test/spike-regression.test.cjs`: # pass 9, # fail 0
- Q1 verify one-liner: exit 0
- `npm test`: exit 0 (29 tests, 0 fail)

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-21*
