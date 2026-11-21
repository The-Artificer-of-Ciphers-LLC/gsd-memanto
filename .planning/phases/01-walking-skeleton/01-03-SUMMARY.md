---
phase: 01-walking-skeleton
plan: "03"
subsystem: config-resolution
tags: [gsd-core, config-get, render-hooks, workstreams, GSD_PROJECT, GSD_WORKSTREAM, node-test, contract-test]

requires:
  - phase: 01-01
    provides: "lib/config.cjs resolveConfig/loadManifestDefaults with the configDirs() seam; test/helpers/gsd-env.cjs real-host harness"
provides:
  - "lib/config.cjs planningDirs(cwd, env) -> {root, scoped}; throws MEMANTO_INVALID_PLANNING_NAME (err.variable) for '/', '\\\\' or '..' in GSD_PROJECT / GSD_WORKSTREAM"
  - "resolveConfig host ladder: scoped config.json, then .planning/config.json only under GSD_WORKSTREAM, then manifest default; invalid names -> {ok:false, path:'GSD_WORKSTREAM'|'GSD_PROJECT', error:'invalid GSD_*...', kind:'read'}"
  - "test/config.test.cjs (23 unit cases) and test/config-contract.test.cjs (14 rows against real config-get and render-hooks)"
affects: [01-02, 01-04, 01-05, 01-06, 01-07, 01-08, 01-09]

actuals:
  tokens: 5346
  tasks: 2
  commits: 4
plan_head_before: 65ed61ca0b9c9c8b6f2ac6972fd482653a889e20
plan_head_after: ef61547

tech-stack:
  added: []
  patterns:
    - "Contract tests read non-raw `config-get <key>` (JSON) so the string \"true\" and the boolean true stay distinct; `--raw` prints both as `true`"
    - "Host ladder facts are probed against the installed host first, then pinned as contract rows"

key-files:
  created:
    - test/config.test.cjs
    - test/config-contract.test.cjs
    - .planning/phases/01-walking-skeleton/evidence/01-03-task1-red.json
    - .planning/phases/01-walking-skeleton/evidence/01-03-task2-red.json
  modified:
    - lib/config.cjs

key-decisions:
  - "Resolver follows the host ladder observed on gsd-core 1.20.1, not the plan's 'root whenever the paths differ': GSD_PROJECT alone does not inherit .planning/config.json, and .planning/<project>/config.json is never read under a workstream (both config-get and render-hooks agree)"
  - "Contract test parses non-raw config-get JSON instead of the plan's --raw + JSON.parse normalization, which cannot tell the string \"true\" from the boolean true"
  - "Invalid GSD_* names reuse kind 'read' so the unchanged lib/checks.cjs renders them as [config-unreadable] naming the variable"

patterns-established:
  - "Every host-divergence the gate keeps (malformed JSON) is an asserted contract row, not an omission"

requirements-completed: [CONF-01, CONF-02, CONF-03]

coverage:
  - id: D1
    description: "Resolver reads GSD_PROJECT / GSD_WORKSTREAM scoped config with the host's ladder and rejects unsafe names"
    requirement: CONF-02
    verification:
      - kind: unit
        ref: "node --test test/config.test.cjs (23 tests)"
        status: pass
    human_judgment: false
  - id: D2
    description: "Resolver equals gsd_run config-get for memanto.enabled/agent_id/backend_url/api_url, mempalace.enabled === true parity, and render-hooks discuss:pre gate iff memanto.enabled === true, across 12 parity rows"
    requirement: CONF-03
    verification:
      - kind: integration
        ref: "test/config-contract.test.cjs#contract: * (12 rows)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Asserted divergences: malformed root JSON (resolver ok false, config-get exit 1, no gate rendered); malformed workstream JSON with root enabled (gate renders, resolver ok false so it blocks)"
    requirement: CONF-01
    verification:
      - kind: integration
        ref: "test/config-contract.test.cjs#contract divergence: * (2 tests)"
        status: pass
    human_judgment: false

duration: 6min
completed: 2026-11-21
status: complete
---

# Phase 1 Plan 03: Gate Config Resolution Parity Summary

**Gate resolver now mirrors gsd-core 1.20.1's config ladder: the GSD_PROJECT/GSD_WORKSTREAM scoped config.json first, then `.planning/config.json` only when GSD_WORKSTREAM is set, then the manifest default. Unsafe names fail closed. A 14-row contract test checks the resolver against the real `config-get` and `render-hooks` output.**

## Performance

- **Duration:** about 6 min
- **Started:** 2026-11-21T03:48:12Z
- **Completed:** 2026-11-21T03:54:11Z
- **Tasks:** 2
- **Files modified:** 5 (1 modified, 2 tests, 2 RED evidence records)

## Accomplishments
- `planningDirs(cwd, env)` uses the same rule as the host's `planningDir`: names are trimmed, a blank name counts as unset, and `/[/\\]|\.\./` is rejected. `resolveConfig` keeps the 01-01 signature and return shape.
- The host ladder is pinned against the installed host. Under GSD_WORKSTREAM the root fills keys the workstream config does not set. Under GSD_PROJECT alone nothing is inherited. Under project + workstream the lookup is `.planning/p/workstreams/w`, then `.planning`, and never `.planning/p`.
- The fail-closed divergences are asserted: a malformed workstream config with root `enabled: true` makes the host render the gate, and the resolver returns ok false, so the gate blocks.
- `defaults.json` in `$GSD_HOME/.gsd` is confirmed ignored by both the host and the resolver.

## TDD Gate Compliance

- **RED 1** (`880ac3c`): `node --test --test-reporter=tap test/config.test.cjs` exited 1 with 15 of 23 failing. The target `GSD_WORKSTREAM with only the workstream config resolves from the workstream` failed `'' !== 'w'`. Classifier: `RED_EVIDENCE_OK` (`target_test_failed`, tap). Semantic assessment: the target ran and failed on its planned assertion because 01-01 read only `.planning/config.json`. The planningDirs cases failed with TypeError (the export did not exist yet). The proto-guard, malformed-root and defaults.json cases already passed from 01-01 and stay as regressions. No load or fixture fault. Record: `evidence/01-03-task1-red.json`.
- **GREEN 1** (`4368aa6`): 23/23.
- **RED 2** (`f880695`): `node --test --test-reporter=tap test/config-contract.test.cjs` exited 1 with 1 of 14 failing. The target `contract: GSD_PROJECT alone does not inherit the root config` failed with resolver `true` !== config-get `false` for memanto.enabled. Classifier: `RED_EVIDENCE_OK`. Semantic assessment: this is a real parity divergence in the GREEN 1 resolver, which used the root fallback whenever the paths differed. The other 13 rows passed, which shows the harness and config-get parsing are sound. Record: `evidence/01-03-task2-red.json`.
- **GREEN 2** (`ef61547`): 37/37 for both files; `npm test` 57/57.
- No REFACTOR commit. The `scopeNames`/`dirsFor` split went into GREEN 2.

## Task Commits

1. **Task 1 RED** - `880ac3c` (test)
2. **Task 1 GREEN** - `4368aa6` (feat)
3. **Task 2 RED** - `f880695` (test)
4. **Task 2 GREEN** - `ef61547` (feat; lib/config.cjs ladder fix plus the corrected Task 1 GSD_PROJECT unit case)

## Files Created/Modified
- `lib/config.cjs` - `planningDirs`, the host ladder in `configDirs`, and invalid names mapped to ok false
- `test/config.test.cjs` - 23 in-process cases
- `test/config-contract.test.cjs` - 12 parity rows, 2 divergence rows, one install per temp home (plus one for the defaults.json row)

## Decisions Made
See `key-decisions` in the frontmatter.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug, plan defect] GSD_PROJECT alone must not fall back to the root config**
- **Found during:** Task 2, from a scratch host probe and then RED 2
- **Issue:** The plan's implementation note said "reads scoped config.json then root config.json (when the paths differ)", and that is how Task 1 was built. gsd-core 1.20.1 does not do this. With GSD_PROJECT alone, `config-get` returns `false`/`""` and `render-hooks` renders 0 hooks even when the root has `enabled: true`. Under project + workstream, `.planning/p/config.json` is not read. The comment on `readScopedConfigValue` in `planning-workspace.cjs` documents this (#3963).
- **Fix:** `configDirs` returns `[scoped, root]` only when GSD_WORKSTREAM is set, and `[scoped]` otherwise. The Task 1 unit case was corrected to match.
- **Files modified:** lib/config.cjs, test/config.test.cjs
- **Committed in:** `ef61547`

**2. [Rule 1 - Bug, plan defect] The malformed-JSON row's expected host behavior was wrong**
- **Issue:** The plan expected config-get to "still return the manifest default" on malformed JSON. On 1.20.1 it exits 1 with `Failed to read config.json: ...`. Host activation (render-hooks) treats the key as absent.
- **Fix:** The divergence row asserts what the host actually does: resolver ok false, config-get non-zero, 0 hooks. A second row covers the dangerous case, a malformed workstream file with root enabled, where the host renders the gate and the resolver blocks.
- **Committed in:** `f880695`

**3. [Rule 1 - Bug, plan defect] `config-get --raw` loses the value's type**
- **Issue:** `--raw` prints the string `"true"` and the boolean `true` the same way, so the planned "JSON.parse first, then trimmed text" normalization would wrongly fail the `mempalace.enabled "true"` row.
- **Fix:** The contract test reads non-raw `config-get <key>`, which prints JSON.
- **Committed in:** `f880695`

---

**Total deviations:** 3 auto-fixed (all Rule 1, plan defects found against the real host)
**Impact on plan:** The truths hold in their intended sense: the resolver equals the host on every parity row. No scope creep, and no files outside files_modified were touched.

## Issues Encountered / Follow-ups
- **The fix hint for invalid names is awkward.** `lib/checks.cjs` (owned by parallel plan 01-02, not modified here) renders an invalid name as `[config-unreadable] GSD_WORKSTREAM cannot be read (invalid GSD_WORKSTREAM "../x": ...) -> make GSD_WORKSTREAM readable`. The gate still blocks correctly. A `kind: 'env'` branch in checks.cjs with the fix `unset or rename GSD_WORKSTREAM` would read better.
- **Stored active-workstream pointer.** The host CLI bootstrap also resolves the workstream from a stored pointer when GSD_WORKSTREAM is blank, and writes it into the env (`active-workstream-store.cjs`). A gate run through `gsd_run check predicate` inherits that env. A gate run outside gsd-tools does not. This is not in the matrix; a later plan should add a contract row.
- **Stricter host name rule.** The host also rejects workstream names outside `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` and the reserved name `none` before any verb runs. Such names never render the gate, so the resolver keeps the simpler `planningDir` rule.
- `.codegraph/` is an untracked, local-only index that the agent built in this worktree. It was not committed.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Plans that read config (01-02 checks, 01-06 doctor) get workstream and project parity through `resolveConfig` with no changes on their side.
- `test/config-contract.test.cjs` should also run on the second host version in CI (T-01-11).

## Self-Check: PASSED

- Files present: lib/config.cjs, test/config.test.cjs, test/config-contract.test.cjs, evidence/01-03-task1-red.json, evidence/01-03-task2-red.json.
- Commits 880ac3c, 4368aa6, f880695, ef61547 are ancestors of HEAD.
- Plan verification: `node --test --test-reporter=tap test/config.test.cjs test/config-contract.test.cjs` exit 0 (37/37); `npm test` exit 0 (57/57).
- Acceptance: planningDirs/resolveConfig export check exit 0; a `'../x'` case is present; `config-get` and `render-hooks` are spawned through the gsd-env helpers.

---
*Phase: 01-walking-skeleton*
*Completed: 2026-11-21*
