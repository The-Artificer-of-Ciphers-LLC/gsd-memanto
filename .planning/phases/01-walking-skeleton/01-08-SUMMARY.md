---
phase: 01-walking-skeleton
plan: "08"
subsystem: release
tags: [readme, changelog, github-actions, ci-matrix, npm-trusted-publishing, oidc, npm-stage-publish, actionlint]

requires:
  - phase: 01-02
    provides: "lib/checks.cjs CHECK_ORDER and the gate messages that the README documents"
  - phase: 01-05
    provides: "01-SPIKE.md discuss:pre bypass paths (--power, --assumptions, discuss_mode assumptions)"
provides:
  - "README.md: Phase-1 owner documentation (install sources, memanto.* keys, every gate check id, break-glass, both doctor forms, fail-open caveat, known bypasses, uninstall)"
  - "CHANGELOG.md with an ## Unreleased section that publish.yml consumes"
  - "LICENSE (MIT, The Artificer of Ciphers LLC)"
  - "test/release.test.cjs: version, D-13 field, zero-dependency, changelog, README, .npmrc and LICENSE anti-drift checks"
  - ".github/workflows/ci.yml: ubuntu/macOS x gsd-core 1.20.1/1.22.0 matrix, Node 24, check names test (<os>, <gsd>)"
  - ".github/workflows/publish.yml: owner-triggered OIDC staged release that keeps capability.json in step with package.json"
  - ".npmrc save-exact=true; .gitignore hygiene"
affects: [01-09]

actuals:
  tokens: 7550
  tasks: 3
  commits: 2
plan_head_before: 225141094078422f2e8cdcd496c98f4b19c21e13
plan_head_after: 1f5f685dd181107acd879d995d6f308f2eebe2e6

tech-stack:
  added: []
  patterns:
    - "The gsd-core host is installed in CI at an exact version with --ignore-scripts into $RUNNER_TEMP and passed to the suite through GSD_CORE_DIR; it never enters the repo or the package"
    - "Matrix and workflow_dispatch inputs reach run scripts only through env:, never ${{ }} inside a script"
    - "Inline node scripts in workflows use a quoted heredoc (node <<'NODE'), which keeps shellcheck SC2016 quiet"

key-files:
  created:
    - README.md
    - CHANGELOG.md
    - LICENSE
    - test/release.test.cjs
    - .npmrc
    - .github/workflows/ci.yml
    - .github/workflows/publish.yml
  modified:
    - .gitignore

key-decisions:
  - "Owner approved @opengsd/gsd-core at the Task 2 blocking-human checkpoint: npm repository git+https://github.com/open-gsd/gsd-core.git, maintainers trek-e, solvely-colin and jeremymcs, 1.20.1 published 2026-11-05T14:33Z, 1.22.0 published 2026-11-19T04:11Z, GitHub releases v1.20.1 and v1.22.0 present"
  - "publish.yml bumps capability.json with an in-place replacement of the top-level version string, so the release commit changes one line of the manifest. It then re-parses the file and fails if the two versions differ"
  - "publish.yml tests the release against the 1.20.1 floor only. CI has already proven both hosts on the same commit, because the gate requires four passing test (...) checks"
  - "README uses gsd-tools (on PATH) for commands and states that gsd_run, as printed by the gate, is the same CLI"

patterns-established:
  - "Docs anti-drift: README must name every CHECK_ORDER id in backticks; adding a check without documenting it fails npm test"

requirements-completed: [INST-05, TEST-01, INST-01]

coverage:
  - id: D1
    description: "Release metadata and docs cannot drift: versions match, D-13 fields, zero dependencies, ## Unreleased, every CHECK_ORDER id plus break-glass plus the direct doctor form in README, save-exact in .npmrc, LICENSE holder"
    requirement: INST-05
    verification:
      - kind: unit
        ref: "test/release.test.cjs (8 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The full suite passes on gsd-core 1.22.0 (npm layout) and on the installed 1.20.1"
    requirement: TEST-01
    verification:
      - kind: integration
        ref: "GSD_CORE_DIR=<scratch>/gsd-core-1.22.0/node_modules/@opengsd/gsd-core/gsd-core MEMANTO_SPIKE_INSTALLER=1 npm test (159/159, exit 0)"
        status: pass
      - kind: integration
        ref: "npm test on ~/.claude/gsd-core 1.20.1 (159/159, exit 0)"
        status: pass
    human_judgment: false
  - id: D3
    description: "CI and release workflows lint clean"
    requirement: INST-01
    verification:
      - kind: other
        ref: "actionlint .github/workflows/ci.yml .github/workflows/publish.yml (exit 0, no output)"
        status: pass
    human_judgment: false
  - id: D4
    description: "CI runs green on GitHub on all four matrix legs, with job names counted by publish.yml (A8), and fresh runners need no ~/.claude"
    verification: []
    human_judgment: true
    rationale: "Nothing has been pushed (D-15 prohibits the agent from pushing). The first CI run on GitHub is the only proof of the runner environment and the check-run names."
  - id: D5
    description: "The OIDC staged release works for @taoc/gsd-memanto with the owner's trusted publisher (A7)"
    verification: []
    human_judgment: true
    rationale: "Only exercised when the owner runs the release workflow and approves the staged version with 2FA (plan 01-09)."
  - id: D6
    description: "README reads correctly for an owner, and its doctor section matches 01-06's actual doctor output"
    verification: []
    human_judgment: true
    rationale: "Doctor was built in parallel by 01-06. Per the orchestrator, the doctor section is reconciled after the merge."

duration: 25min
completed: 2026-11-21
status: complete
---

# Phase 1 Plan 08: Release Readiness Summary

**Owner README documenting every gate check id, the break-glass switch, both doctor forms and the discuss:pre bypasses; MIT LICENSE and CHANGELOG; an anti-drift release test; a four-leg CI matrix (ubuntu/macOS x gsd-core 1.20.1/1.22.0, Node 24); and an OIDC `npm stage publish` release workflow that keeps capability.json's version in step with package.json. Everything lints clean, and the suite passes 159/159 on both gsd-core 1.22.0 and 1.20.1.**

## Performance

- **Duration:** about 25 min of executor time, excluding the owner checkpoint wait
- **Completed:** 2026-11-21T04:45Z
- **Tasks:** 3 (Task 2 was the owner checkpoint)
- **Files:** 8 (7 created, 1 modified)

## Accomplishments
- README.md covers prerequisites, the four supported install sources (local `.tgz` is explicitly unsupported), the `memanto.*` keys table with neutral example values, the gate line format, and a row for each CHECK_ORDER id with its fix. It also covers `[gate-internal]`, break-glass, doctor (both forms, exit codes, `--raw`, the loaded/consent/engines/render:<point> errors), the fail-open caveat, the three bypasses and uninstall. The check table and example lines were taken from running `scripts/gate.cjs` against failing configs, so they match what the gate actually prints.
- ci.yml: four legs, explicit job name `test (${{ matrix.os }}, ${{ matrix.gsd }})`, gsd-core installed with `--ignore-scripts` into `$RUNNER_TEMP`, `MEMANTO_SPIKE_INSTALLER=1`, and the tee plus awk more-than-one-test assertion. No `npm ci` and no npm cache, because the package has zero dependencies and no lockfile.
- publish.yml: copied from pi-mlx-models with its header comments, inputs, concurrency, `npm-publish` environment, permissions, env-passed inputs, main-only guard and changelog step. Changes: Node 24, at least 4 `test (` checks required, capability.json version sync, the host install step in place of Install/Build, and a release commit of package.json, capability.json and CHANGELOG.md.
- Local proof on npm-installed **gsd-core 1.22.0**: `# tests 159 / # pass 159 / # fail 0`, exit 0. On the installed 1.20.1: 159/159, exit 0.

## Task Commits

1. **Task 1: owner docs, changelog, license, release anti-drift test**: `907adea` (docs)
2. **Task 2: owner verification of @opengsd/gsd-core**: checkpoint, no commit. The owner answered "approved".
3. **Task 3: CI matrix, OIDC release workflow, repo hygiene, 1.22.0 proof**: `1f5f685` (chore)

Tasks 1 and 3 are plan-declared TDD exceptions (documentation and configuration). For Task 1, the release test was still written first: it failed 4/7 on the missing CHANGELOG, README and LICENSE, then passed 7/7.

## Owner Approval (Task 2)

The owner typed "approved" in the orchestrator session. The orchestrator first checked, read-only, and showed the owner: npm repository `git+https://github.com/open-gsd/gsd-core.git`; maintainers trek-e, solvely-colin, jeremymcs; 1.20.1 published 2026-11-05T14:33Z; 1.22.0 published 2026-11-19T04:11Z; GitHub releases v1.20.1 and v1.22.0 exist. The first fetch (`npm install --prefix <scratchpad>/gsd-core-1.22.0 --no-audit --no-fund --ignore-scripts @opengsd/gsd-core@1.22.0`, 106 packages) happened after the approval.

## Files Created/Modified
- `README.md`: Phase-1 owner documentation
- `CHANGELOG.md`: `## Unreleased` / `### Added`
- `LICENSE`: MIT, The Artificer of Ciphers LLC
- `test/release.test.cjs`: 8 anti-drift tests
- `.npmrc`: `save-exact=true`
- `.gitignore`: kept `.claude/*` and `!.claude/CLAUDE.md`; added node_modules/, .env, .DS_Store, *.log, .codegraph/, .memdb/
- `.github/workflows/ci.yml`, `.github/workflows/publish.yml`

## Decisions Made
See key-decisions above.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical] Release test also asserts zero dependencies**
- **Found during:** Task 1
- **Issue:** INST-05 (zero runtime dependencies) is a plan requirement, but no listed assertion guarded it.
- **Fix:** One added test: dependencies, devDependencies, optionalDependencies and peerDependencies must all be empty.
- **Files modified:** test/release.test.cjs
- **Committed in:** 907adea

**2. [Rule 1 - Bug] actionlint SC2016 on the version-sync script**
- **Found during:** Task 3
- **Issue:** a single-quoted `node -e '…${v}…'` triggered shellcheck SC2016, and actionlint exited 1.
- **Fix:** the script now uses a quoted heredoc (`node <<'NODE'`), like the changelog step. A dry run in the scratchpad (`npm version minor` and then the script) changed only the `"version"` line of capability.json, to 0.1.0.
- **Files modified:** .github/workflows/publish.yml
- **Committed in:** 1f5f685

**3. [Rule 2 - Missing critical] No npm cache in publish.yml setup-node**
- **Issue:** the reference workflow's `cache: npm` needs a lockfile, which this package does not have, so setup-node would fail.
- **Fix:** removed, matching ci.yml.
- **Committed in:** 1f5f685

---

**Total deviations:** 3 auto-fixed (2 missing critical, 1 bug). **Impact:** each was needed for correctness or a clean lint. No scope creep.

## Issues Encountered
- A memtrace-first PreToolUse hook blocks reading `lib/checks.cjs` and `test/*.cjs` with Read or cat. No CodeGraph index exists in this worktree or the main checkout, so the sanctioned route fails, and the orchestrator forbids `codegraph init`. The README content came from running the gate and from the 01-01 and 01-02 summaries instead.
- The worktree isolation check refuses Bash commands containing `.github` next to other commands, because it reads the "git" substring. Commands were split.
- The plan commit ledger file under `.git` was not written. The base comes from the dispatch branch check: `2251410`.

## Threat Flags
None beyond the plan's threat model. T-01-25 (host fetched in CI): exact pins, `--ignore-scripts`, `$RUNNER_TEMP`, and owner verification. T-01-26: OIDC only, no token, `npm-publish` environment, main-only, four checks required. T-01-28: inputs and matrix values only through `env:`.

## User Setup Required
None for this plan. The release prerequisites (the `@taoc` scope and a trusted publisher bound to `publish.yml` and the `npm-publish` environment) are the owner's, per D-15, and belong to 01-09.

## Next Phase Readiness
- 01-09: once the code is pushed and all four CI checks are green, the owner runs Release with bump `minor` (0.0.0 to 0.1.0) and approves the staged version with 2FA.
- The orchestrator reconciles the README doctor section with 01-06's actual output after the merge.
- The first CI run confirms A8 (check-run names) and that fresh runners need no `~/.claude`.

## Self-Check: PASSED
- All 8 key files exist. Commits 907adea and 1f5f685 are ancestors of HEAD (`git rev-list --count 2251410..HEAD` = 2 before this SUMMARY commit).
- Re-run: release test 8/8; `actionlint` exit 0 with no output; `npm test` 159/159 on 1.20.1 and on 1.22.0; all grep acceptance criteria pass; `NODE_AUTH_TOKEN` appears only in the header comment.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-21*
