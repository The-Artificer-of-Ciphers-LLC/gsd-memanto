---
phase: 01-walking-skeleton
verified: 2026-11-22T15:15:18Z
status: passed
score: 9/9 must-haves verified
covered_files: [".github/workflows/ci.yml",".github/workflows/publish.yml",".gitignore",".npmrc",".planning/phases/01-walking-skeleton/01-01-PLAN.md",".planning/phases/01-walking-skeleton/01-01-SUMMARY.md",".planning/phases/01-walking-skeleton/01-02-PLAN.md",".planning/phases/01-walking-skeleton/01-02-SUMMARY.md",".planning/phases/01-walking-skeleton/01-03-PLAN.md",".planning/phases/01-walking-skeleton/01-03-SUMMARY.md",".planning/phases/01-walking-skeleton/01-04-PLAN.md",".planning/phases/01-walking-skeleton/01-04-SUMMARY.md",".planning/phases/01-walking-skeleton/01-05-PLAN.md",".planning/phases/01-walking-skeleton/01-05-SUMMARY.md",".planning/phases/01-walking-skeleton/01-06-PLAN.md",".planning/phases/01-walking-skeleton/01-06-SUMMARY.md",".planning/phases/01-walking-skeleton/01-07-PLAN.md",".planning/phases/01-walking-skeleton/01-07-SUMMARY.md",".planning/phases/01-walking-skeleton/01-08-PLAN.md",".planning/phases/01-walking-skeleton/01-08-SUMMARY.md",".planning/phases/01-walking-skeleton/01-09-PLAN.md",".planning/phases/01-walking-skeleton/01-09-SUMMARY.md","CHANGELOG.md","LICENSE","README.md","capability.json","lib/checks.cjs","lib/config.cjs","lib/gate-bundle.cjs","lib/gsd-host.cjs","lib/health.cjs","lib/install-state.cjs","lib/safe-read.cjs","memanto.cjs","package.json","scripts/check-probe.cjs","scripts/gate.cjs","test/activation.test.cjs","test/bundle.test.cjs","test/config-contract.test.cjs","test/config.test.cjs","test/dispatch.test.cjs","test/doctor.test.cjs","test/gate-bundle.test.cjs","test/gate.test.cjs","test/gsd-host.test.cjs","test/health.test.cjs","test/helpers/fake-api.cjs","test/helpers/fake-memanto.cjs","test/helpers/gsd-env.cjs","test/helpers/install-invariants.cjs","test/install-state.test.cjs","test/install.test.cjs","test/loader-drift.test.cjs","test/manifest.test.cjs","test/release-rehearsal.test.cjs","test/release.test.cjs","test/render-points.test.cjs","test/safe-read.test.cjs","test/skeleton.test.cjs","test/spike-installer.test.cjs","test/spike-regression.test.cjs","test/stage-bundle.test.cjs","test/traps.test.cjs","tools/run-tests.cjs","tools/stage-bundle.cjs"]
covered_digest: "v4:sha256:694d5b097afcc0238c396572bc744a9126180ed48515ba924fe58ef7c119da8b"
behavior_unverified: 0
overrides_applied: 1
overrides:
  - must_have: "Two concurrent `capability install` runs of the staged bundle into the same GSD_HOME leave one memanto ledger entry and a complete bundle (host-owned staging; not asserted by a phase test)"
    reason: "Owner ACCEPTED as a gsd-core host guarantee (backstop truth, 01-01); install staging and the ledger are owned by gsd-core, not by the capability"
    accepted_by: "owner"
    accepted_at: "2026-11-22T15:15:18Z"
re_verification:
  previous_status: human_needed
  previous_score: 8/8
  gaps_closed:
    - "Human item 1 (CI and release): resolved. CI run 45035372265 on 0ddff44 green on all four matrix jobs; Release run 45036137381 succeeded; 0.1.1 on npm and tagged v0.1.1 at 951ec3f"
    - "Human item 2 (judgment prohibition 01-02, no gate bypass): owner CONFIRMED"
    - "Human item 3 (judgment prohibitions 01-08, 01-09, no publish on the owner's behalf): owner CONFIRMED, noting one owner-instructed push of main (3dc63bc..0ddff44)"
    - "Human item 4 (backstop truth 01-01, concurrent installs): owner ACCEPTED as a gsd-core host guarantee"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "CONF-02 (second half): an unknown (non-existent) memanto.agent_id blocks with an actionable message"
    addressed_in: "Phase 2"
    evidence: "Phase 2 success criterion 1: 'The run halts at each of discuss:pre/post ... when any of these is true: the agent id is unknown, ...'"
  - truth: "MVP outcome 'discuss-phase runs with memory' in the literal sense: discuss reads memories from the configured agent"
    addressed_in: "Phase 3"
    evidence: "Phase 3 success criterion 1: '/gsd-discuss-phase N and /gsd-plan-phase N write MEMANTO-RECALL.md with the active memories for the phase goal and topic'"
---

# Phase 1: Walking Skeleton Verification Report

**Phase Goal:** As a GSD user on gsd-core, I want to install Memanto once and pass its gate, so that discuss-phase runs with memory.
**Mode:** mvp (`user-story.validate` returns valid: true)
**Verified:** 2026-11-22T15:15:18Z
**Status:** passed
**Re-verification:** Yes. The previous report (human_needed, 8/8, HEAD c4d67f0) is stale after review rounds 8 to 10 (34 commits, 19 non-planning files, +2854/-337) and the 0.1.1 release. HEAD 951ec3f equals origin/main and tag v0.1.1.

## User Flow Coverage (MVP mode)

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Install Memanto once | the bundle installs through gsd-core's install and consent flow, globally or per project | The agent's fresh run (scratchpad `repro/e2e.cjs`, temp GSD_HOME): HEAD's bundle reports `installed` at global and project scope. The published 0.1.1 tarball has 14 files, byte-identical to HEAD's `npm pack` set (14). The real `~/.gsd` install has a committed ledger entry, version 0.1.1, `source npm:@taoc/gsd-memanto@0.1.1`, the integrity pin matches npm `dist.integrity`, and the bundle files are byte-identical to the tarball | VERIFIED |
| Enable it in the project | `memanto.enabled: true` renders exactly one blocking discuss:pre gate; anything else renders none | The agent's run, both scopes: enabled renders 1 hook with `blocking:true`. `enabled:false` and an absent key render NO memanto hook | VERIFIED |
| Pass its gate | with an explicit agent id and both endpoints healthy, `check predicate` returns block:false | Real `GET http://localhost:8000/health` returns `{"status":"ok"}` (the only Memanto call). Both scopes: `block:false`, "command exited 0". Doctor exits 0 with no errors | VERIFIED |
| ...and it halts otherwise | an empty agent id, a dead endpoint or mempalace.enabled=true blocks with an actionable line | The agent's run, both scopes: `[agent-id]`, `[backend-health]`, `[api-health]` and `[mempalace]` (names Memanto and MemPalace). Each line ends with a fix and the break-glass line | VERIFIED |
| so that discuss-phase runs with memory | discuss proceeds with a healthy Memanto and an explicit agent attached | The gate passes as above. Headless discuss passed the gate earlier (01-SPIKE.md runs d and pub-d). Reading memories into discuss is Phase 3 (deferred) | VERIFIED (memory content deferred to Phase 3) |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: install through the third-party install and consent flow; no gsd-core file changes; zero overlay warnings or diagnostics; whitelisted zero-dep CJS; no runtime state | VERIFIED | `npm test` (once, HEAD): install.test (gsd-core bin/ and workflows/ snapshot), manifest.test ("shipped bundle installs and loads with zero memanto warnings", ok 551) and bundle.test all pass. The agent's installs report `installed` in both scopes. The pack set is 14 whitelisted files |
| 2 | SC2: discuss:pre halts for an empty agent_id, a failing /health on either endpoint, or mempalace.enabled true (names both); proceeds when all pass; no hook when disabled | VERIFIED | The agent's runs in both scopes (User Flow rows 2 to 4). gate.test and health.test pass |
| 3 | SC3: doctor reports not-loaded, not-consented, outside engines.gsd and not-rendering as errors | VERIFIED | Passing tests: ok 73 (loaded error, exit 1), ok 74 (consent error after trust revoke), ok 76 (engines error naming host version and range), ok 77 (render:discuss:pre error). The agent's run: an unledgered global copy next to a project install gives doctor exit 1 with errors `consent` and `gate-bundle` |
| 4 | SC4: `node --test` through the real validator, loader and render-hooks on a temp GSD_HOME; dispatch-pair and loader-trap failures; fake memanto CLI and fake REST | VERIFIED | `npm test`: 551 tests, 550 pass, 1 skip (the env-gated Q3 installer, ok 521), 0 fail, exit 0, gsd-core 1.20.1 locally. Negative dispatch fixtures (ok 59 to 61) and traps.test pass. CI on 0ddff44 passed ubuntu and macOS on 1.20.1 and 1.22.0 |
| 5 | SC5: spike Q1, Q2 and Q3 recorded, and the bundle reflects them | VERIFIED (regression check) | Spike regression tests ok 520, 522 to 527 pass. `skills: []`, `steps: []`, `contributions: []` in capability.json |
| 6 | MVP outcome: a GSD user passes the gate, and discuss-phase proceeds with Memanto attached | VERIFIED | User Flow rows 3 to 5. The literal memory read is deferred to Phase 3 |
| 7 | CR-01 (regression): the gate fails closed at project scope, and doctor exposes stray gate code | VERIFIED (no regression) | The agent's run: project install with an empty agent_id plus a planted global `scripts/gate.cjs` that exits 0 still gives block:true `[agent-id]`. With a healthy config, adding an unledgered global `capability.json` gives block:true `[gate-bundle]`, and doctor exits 1. The mechanism is capability.json:63 (now O_NONBLOCK fstat reads with size caps) |
| 8 | CR-02 (regression): gate and doctor never echo endpoint credentials | VERIFIED (no regression) | doctor.test ok 67 to 71 pass (rejected values never printed; accepted values shown as scheme://host:port). health.test passes |
| 9 | Backstop (01-01): two concurrent installs leave one ledger entry and a complete bundle | PASSED (override) | Override: Owner ACCEPTED as a gsd-core host guarantee, accepted by owner on 2026-11-22 |

**Score:** 9/9 truths verified (0 present, behavior-unverified; 1 by override)

### Prohibitions

| Plan | Prohibition | Tier | Disposition |
|------|-------------|------|-------------|
| 01-01 | no implicit or default agent; `memanto-dev` never a default | test | Enforced: manifest `memanto.agent_id` default `""`, and the agent-id tests pass |
| 01-01 | the gate never exits 0 when a check cannot be evaluated | test | Enforced: ok 524 (missing gate script blocks), the config-unreadable tests and the `[gate-internal]` path |
| 01-01 | no gsd-core file or shared settings changed | test | Enforced: install.test snapshot passes |
| 01-01 | no real Memanto contact or real `~/.gsd` write from the default suite | test | Enforced: ok 9, 456, 519, 530 (real consent.json untouched). The agent's own runs left the real consent.json sha256 unchanged |
| 01-02 | no start/stop/reconfigure of Memanto; no memanto CLI spawn from the gate | test | Enforced: ok 184 "no gate run in this file spawned the memanto CLI" |
| 01-02 | no env var, flag or alternate key skips a gate check | judgment | **Resolved by owner: CONFIRMED** |
| 01-08, 01-09 | the agent never publishes, pushes, approves a staged release or handles npm credentials on the owner's behalf | judgment | **Resolved by owner: CONFIRMED**, with the owner's note that the agent pushed main once (3dc63bc..0ddff44) on the owner's explicit instruction ("Push. Watch ci."). The agent did not publish, approve a staged release or handle npm credentials |
| 01-05, 01-06, 01-07, 01-09 | remaining test-tier prohibitions | test | Enforced by their named tests in the passing suite (unchanged since the previous report) |

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | CONF-02: an unknown agent id blocks | Phase 2 | Phase 2 SC1 "the agent id is unknown" |
| 2 | discuss actually reads memories ("with memory", literal) | Phase 3 | Phase 3 SC1, MEMANTO-RECALL.md at discuss and plan |

### Advisory (New Scope, Unevidenced)

None.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| capability.json | VERIFIED | `verify.artifacts` passes. Version 0.1.1, and the reinstall pin at line 63 names `@0.1.1` |
| scripts/gate.cjs, lib/checks.cjs, lib/config.cjs | VERIFIED | wired: gate.cjs -> checks -> config and health. Exercised by the agent's runs |
| lib/health.cjs | VERIFIED (plan deviation) | `verify.artifacts` 01-02 still reports "Missing export: redactUrl". It was deliberately replaced by `displayEndpoint` and a strict allowlist (lib/health.cjs:100, exports at :179). The behavior is proven by truth 8. Not a stub. The override suggested in the previous report is still not recorded (see below) |
| lib/gate-bundle.cjs, lib/install-state.cjs, lib/safe-read.cjs (new in round 9) | VERIFIED | used by memanto.cjs. safe-read.test, install-state.test and gate-bundle.test pass. lib/safe-read.cjs ships inside the `lib` whitelist and is in the published tarball |
| memanto.cjs, lib/gsd-host.cjs, scripts/check-probe.cjs | VERIFIED | doctor exits 0 when healthy and 1 when not, in temp homes and on the real home |
| tools/*, test/**, README, CHANGELOG, workflows | VERIFIED | `verify.artifacts` passes for 01-01 and 01-03 to 01-09. CHANGELOG has a 0.1.1 section with the security fixes |

**Still suggested (looks intentional):**

```yaml
overrides:
  - must_have: "lib/health.cjs exports checkHealth, validateEndpointUrl, redactUrl"
    reason: "redactUrl was replaced by displayEndpoint and a strict allowlist in review round 4 (CR-01); the redaction capability is stricter and is tested"
    accepted_by: "<owner>"
    accepted_at: "<ISO timestamp>"
```

### Key Link Verification

| From | To | Status |
|------|-----|--------|
| All plan key_links 01-01 to 01-08 | | WIRED (`verify.key-links` 18/18) |
| real ~/.gsd bundle -> throwaway discuss:pre (01-09) | | WIRED by runtime evidence. The real bundle is byte-identical to 0.1.1 and doctor exits 0. The tool cannot parse a non-file `from` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| scripts/gate.cjs verdict | per-check failures | project config via lib/config.cjs plus a live GET /health via lib/health.cjs | yes: block:false on the real /health and block:true on a dead port | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite (once) | `npm test` | 551 / 550 pass / 1 skip / 0 fail, exit 0 | PASS |
| End-to-end, both scopes | scratchpad `repro/e2e.cjs` (temp GSD_HOME, real GET /health) | happy block:false; agent-id, backend-health, api-health and mempalace each block; disabled or absent renders no hook; CR-01 plant blocks; real consent.json unchanged | PASS |
| Published package equals HEAD | `npm pack @taoc/gsd-memanto@0.1.1` + `cmp` | 14/14 files identical; integrity sha512-WvqN... matches the brief | PASS |
| CI and release | `gh run view 45035372265`, `45036137381`, `gh release view v0.1.1` | 4 jobs success on 0ddff44; Release success; v0.1.1 published, not a draft | PASS |
| Real home doctor (read-only) | `gsd_run memanto doctor --raw` in this repo | exit 0; warnings only (memanto not enabled in this repo) | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exists and no plan declares one. N/A.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|------------|--------|----------|
| INST-01 | 01-01, 01-07, 01-08, 01-09 | SATISFIED | temp-home installs in both scopes; real-home 0.1.1 with an integrity pin |
| INST-02 | 01-04, 01-09 | SATISFIED | ok 551 zero memanto warnings |
| INST-03 | 01-04, 01-05 | SATISFIED | dispatch.test and negative fixtures; CI on 1.20.1 and 1.22.0 |
| INST-04 | 01-04 | SATISFIED | traps.test |
| INST-05 | 01-01, 01-06, 01-08 | SATISFIED | bundle.test; 14-file pack set |
| CONF-01 | 01-01, 01-03, 01-09 | SATISFIED | activation.test; the agent's disabled and absent runs |
| CONF-02 | 01-01, 01-02, 01-03, 01-09 | PARTIAL: empty id SATISFIED; unknown id deferred to Phase 2 | the agent's `[agent-id]` runs; manifest default `""` |
| CONF-03 | 01-02, 01-03, 01-09 | SATISFIED | `[backend-health]`/`[api-health]` runs; GET /health only. The requirement's scheme-less `host:port` example is still not accepted (the gate requires `http(s)://`, documented). Informational |
| GATE-03 | 01-02, 01-09 | SATISFIED | the agent's `[mempalace]` runs |
| GATE-06 | 01-06, 01-09 | SATISFIED | ok 73, 74, 76, 77 plus the gate-bundle states |
| TEST-01 | 01-01, 01-04, 01-05, 01-07, 01-08 | SATISFIED | real validator, loader and render-hooks; release rehearsal ok 469/470 |
| TEST-02 | 01-02, 01-06 | SATISFIED | fake REST and fake memanto CLI; ok 184 |

All 12 IDs appear in the plans and map to Phase 1 in REQUIREMENTS.md. None is orphaned. REQUIREMENTS.md still marks all 12 as Pending (informational).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (all tracked non-planning files) | | no TBD/FIXME/XXX/TODO/HACK/placeholder | | none |
| global-scope bundle | | an edited global `scripts/gate.cjs` is not detected: after the agent appended a comment, the gate still passed and doctor reported no error. gsd-core binds the content hash only at project scope, and doctor's gate-match check compares the rendered predicate, not gate.cjs bytes | Info | inside the user's own trust boundary for a global install, and outside SC1 to SC5. A candidate hardening for a later phase |

### Human Verification Required

None. The four items from the previous report are resolved by the owner (see re_verification.gaps_closed and Prohibitions).

### Gaps Summary

No gaps. All 9 must-haves verify (one by an owner-accepted override). The round 8 to 10 changes did not regress the earlier truths. HEAD is released as 0.1.1, and the published bytes and the real global install match HEAD. Two items stay deferred: blocking an unknown agent id (Phase 2) and reading memories into discuss (Phase 3).

---

_Verified: 2026-11-22T15:15:18Z_
_Verifier: Claude (gsd-verifier)_
