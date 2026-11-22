---
phase: 01-walking-skeleton
plan: "09"
subsystem: acceptance
tags: [acceptance, headless, claude-p, real-home, npm, trusted-publishing, integrity-pin, doctor]

requires:
  - phase: 01-05
    provides: "Q1 headless command shape and the F10 caveat"
  - phase: 01-06
    provides: "memanto doctor (both forms) and the read-only guarantees"
  - phase: 01-08
    provides: "README, ci.yml, publish.yml (OIDC staged release), npm-installed gsd-core 1.22.0 layout"
provides:
  - "01-SPIKE.md ## Acceptance run (D-08): SC1-SC3 observed on the owner's real home, for the dev bundle and the published 0.1.0"
  - "README prerequisite: the gsd-tools in use must be >=1.20.1 (checked with query runtime-identity), otherwise use gsd_run"
  - "publish.yml header: how to re-create the stage-only trusted publisher with npm trust"
  - "External: @taoc/gsd-memanto@0.1.0 (owner-published), installed globally in the real home from npm with an integrity pin"
affects: [phase-02-gates, verify-work]

actuals:
  tokens: 5579
  tasks: 3
  commits: 3
plan_head_before: 19494b8566b6c3eb23c412657fdddf4addc8d01b
plan_head_after: 6ec93c89f1acac1c3f66de1ae277c7d0f07ffc70

tech-stack:
  added: []
  patterns:
    - "Bounded headless acceptance: a stream-json watcher stops the claude -p session once the first tool call after the gate has returned"
    - "Owner-approved guards on headless runs: --disallowedTools for MemPalace commands and git commit"

key-files:
  created: []
  modified:
    - .planning/phases/01-walking-skeleton/01-SPIKE.md
    - README.md
    - .github/workflows/publish.yml

key-decisions:
  - "The owner chose a guarded rerun after the auto-mode classifier denied runs c and d: c with mempalace.recall_on_discuss false and --disallowedTools Bash(mempalace:*), d bounded with --disallowedTools Bash(git commit:*)"
  - "A global install writes no consent record. D-08's expectation that the acceptance run writes ~/.gsd/consent.json was wrong (F2; consistent with doctor's 'global scope needs no consent record')"
  - "The README version check uses `gsd-tools query runtime-identity --raw`, because gsd-tools rejects --version"
  - "The trusted publisher is stage-only (npm trust ... --allow-stage-publish, no --allow-publish), so the owner keeps the 2FA staged approval"

patterns-established:
  - "Acceptance evidence lives in 01-SPIKE.md. Transcripts and snapshots stay in the session scratchpad and never enter the repo"

requirements-completed: [INST-01, INST-02, CONF-01, CONF-02, CONF-03, GATE-03, GATE-06]

coverage:
  - id: D1
    description: "Real-home global install from the staged release file set; the gsd-core tree is unchanged before and after (SC1, INST-01, INST-02)"
    requirement: INST-01
    verification:
      - kind: manual_procedural
        ref: "node tools/stage-bundle.cjs --real --json -> installed, global; capability list active; gsd-core 627-file sha256 snapshot cmp identical (01-SPIKE.md Acceptance run)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Headless /gsd-discuss-phase 1 --auto halts on [agent-id], [api-health] and [mempalace] and passes when healthy; disabled renders no memanto hook (SC2, CONF-01..03, GATE-03)"
    requirement: CONF-02
    verification:
      - kind: e2e
        ref: "01-SPIKE.md Acceptance run verdict table, runs a-e (claude -p transcripts in the session scratchpad)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Doctor, both forms, on the real install: exit 0 healthy, exit 1 naming agent-id (SC3, GATE-06)"
    requirement: GATE-06
    verification:
      - kind: e2e
        ref: "gsd_run memanto doctor and node $HOME/.gsd/capabilities/memanto/memanto.cjs doctor [--raw], projects d and a, dev bundle and 0.1.0"
        status: pass
    human_judgment: false
  - id: D4
    description: "The published 0.1.0 installs through gsd-core's npm source with an integrity pin, equals the tarball, and behaves like the dev bundle"
    requirement: INST-01
    verification:
      - kind: e2e
        ref: "gsd_run capability install npm:@taoc/gsd-memanto@0.1.0 --integrity sha512-VZ5c...NJvoQ== --yes; file list diff vs npm pack --dry-run; post-publish verdict table"
        status: pass
    human_judgment: false

duration: about 25 min of agent time over two checkpoints (2026-11-21T05:07Z to 2026-11-22T00:11Z wall clock)
completed: 2026-11-22
status: complete
---

# Phase 1 Plan 09: Real-Home Acceptance and First Release Summary

**On the owner's real home, a headless `/gsd-discuss-phase 1 --auto` halts on `[agent-id]`, `[api-health]` and `[mempalace]`, passes and continues when Memanto is healthy, and shows no memanto hook when disabled. Doctor's exit codes match in both forms. The owner-published `@taoc/gsd-memanto@0.1.0`, installed through `npm:` with an integrity pin, matches its tarball and behaves the same way.**

## Performance

- **Duration:** about 25 min of agent time. Wall clock ran from 2026-11-21T05:07:26Z to 2026-11-22T00:10:49Z and includes two owner checkpoints (the classifier decision and the publish).
- **Tasks:** 3 of 3. Task 2 was the owner-only release.
- **Files modified:** 3

## Accomplishments
- Suite gates: `npm test` on 1.20.1 had 187 pass and 1 skipped; on npm-installed 1.22.0 it had 188 pass.
- Real-home install with `stage-bundle --real`: memanto active, global. The ledger is `~/.gsd-capabilities.json`.
- Discuss runs (a) to (e) all passed. Runs (c), (d) and (e) used the owner-approved guards.
- Doctor, both forms: exit 0 with the healthy config, exit 1 naming `agent-id` with the empty agent id.
- The gsd-core tree (627 files) was byte-identical through every step. No `memanto` CLI call ran, and real Memanto received only `GET /health`.
- Post-publish: remove, then `npm:` install with `--integrity` (pin verified). The installed 11 files equal the tarball. Run (a) halted, run (d) passed, and doctor gave the same results in both forms.

## Task Commits

1. **Task 1 (partial, classifier checkpoint):** `2171432` (docs)
2. **Task 1 (guarded reruns, README prerequisite, consent finding):** `8e40508` (docs)
3. **Task 2:** done by the owner, no agent commit. The release commit `3dc63bc` (`chore(release): 0.1.0`) and tag `v0.1.0` are on origin/main.
4. **Task 3 (post-publish acceptance, publishing findings):** `6ec93c8` (docs)

All three are acceptance tasks with no production code (TDD exception declared in the plan).

## Files Created/Modified
- `.planning/phases/01-walking-skeleton/01-SPIKE.md`: the `## Acceptance run (D-08)` section
- `README.md`: the gsd-tools version prerequisite
- `.github/workflows/publish.yml`: header comment on re-creating the stage-only trusted publisher

## Decisions Made
See `key-decisions` in the frontmatter.

## Deviations from Plan

**1. [Owner decision] Guarded reruns for (c), (d) and (e).** The auto-mode classifier denied the first attempts at (c) and (d), and also a host-layer predicate. The agent stopped and returned a checkpoint. The owner chose option B. Run (c) used `mempalace.recall_on_discuss: false` and `--disallowedTools "Bash(mempalace:*)"`, because enabling MemPalace injects a first-party `discuss:pre` contribution that tells the agent to run `mempalace wake-up` and `mempalace search`. Runs (d) and (e) were bounded and used `--disallowedTools "Bash(git commit:*)"`. Run (e) is anchored on the session's own `render-hooks` call, because it has no gate. None of the reruns was denied. Commit `8e40508`.

**2. [Owner direction, adjusted] README version check.** The owner asked for "`gsd-tools --version` must be >=1.20.1". gsd-tools rejects `--version` ("does not accept version flags"), so the README uses `gsd-tools query runtime-identity --raw`, verified on 1.17.0 and 1.20.1. Commit `8e40508`.

**3. [Rule 2 - Missing critical docs] publish.yml comment.** The comment said re-creating the trusted publisher happens "on npmjs.com". The web form cannot make a stage-only publisher, so the comment now gives the exact `npm trust github ... --allow-stage-publish` command and the placeholder-version caveat. actionlint exits 0. Commit `6ec93c8`.

**4. [Plan assumption wrong] The npm pending trusted-publisher flow does not exist for new names.** The owner hand-published a two-file placeholder `0.0.0`, and the registry also shows `0.0.0-stage`. This is recorded in 01-SPIKE.md.

**Total deviations:** 4 (1 owner decision, 1 adjusted owner direction, 1 docs fix, 1 recorded plan-assumption error). **Impact:** every truth in the plan was observed. There was no scope creep.

## Issues Encountered
- The read guard blocked `tools/stage-bundle.cjs`, and there is no CodeGraph index. The agent used the interface documented in the README and earlier summaries.
- The worktree-isolation check refuses compound commands containing the `.github` substring, so commands were split (as in 01-08).
- The `gsd-tools` on PATH is gsd-core 1.17.0 (Homebrew global npm). Every host command used `gsd_run` (1.20.1). The owner's PATH and the Homebrew install were not changed.
- The real-home bundle's README predates the README edit only during Task 1. Task 3 replaced that bundle with the published 0.1.0.
- The plan commit ledger file was not written. `plan_head_before` is the base the branch check verified (`19494b8`), and `commits: 3` was measured with `git rev-list --count`.

## Known Stubs
None.

## User Setup Required
None remaining. The npm scope, the trusted publisher and the GitHub environment were set up by the owner in Task 2.

## Next Phase Readiness
- Phase 1 success criteria SC1-SC3 were observed on the real home, for both the dev bundle and 0.1.0. The real home now holds the npm-installed 0.1.0 (global).
- The throwaway project dir `~/.claude/projects/-private-tmp-...-acc0109-proj/` is left in place (empty).
- Phase 2 should carry two items: the F10 caveat (the LLM runs the predicate command itself), and the MemPalace contribution that is rendered when both capabilities are enabled.

## Self-Check: PASSED
- FOUND: .planning/phases/01-walking-skeleton/01-SPIKE.md (`## Acceptance run (D-08)`), README.md, .github/workflows/publish.yml
- FOUND commits (ancestors of HEAD): 2171432, 8e40508, 6ec93c8
- Task 1 verify exit 0. Task 3 verify exit 0. `npm test` exit 0 (188 tests, 187 pass, 0 fail, 1 skipped). The direct `doctor --raw` in project d exits 0.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-22*
