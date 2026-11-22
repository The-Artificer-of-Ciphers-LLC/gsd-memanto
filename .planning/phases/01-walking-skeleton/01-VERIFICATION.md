---
phase: 01-walking-skeleton
verified: 2026-11-22T04:30:00Z
status: human_needed
score: 8/8 must-haves verified
covered_files: [".github/workflows/ci.yml", ".github/workflows/publish.yml", ".gitignore", ".npmrc", ".planning/phases/01-walking-skeleton/01-01-PLAN.md", ".planning/phases/01-walking-skeleton/01-01-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-02-PLAN.md", ".planning/phases/01-walking-skeleton/01-02-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-03-PLAN.md", ".planning/phases/01-walking-skeleton/01-03-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-04-PLAN.md", ".planning/phases/01-walking-skeleton/01-04-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-05-PLAN.md", ".planning/phases/01-walking-skeleton/01-05-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-06-PLAN.md", ".planning/phases/01-walking-skeleton/01-06-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-07-PLAN.md", ".planning/phases/01-walking-skeleton/01-07-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-08-PLAN.md", ".planning/phases/01-walking-skeleton/01-08-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-09-PLAN.md", ".planning/phases/01-walking-skeleton/01-09-SUMMARY.md", "CHANGELOG.md", "LICENSE", "README.md", "capability.json", "lib/checks.cjs", "lib/config.cjs", "lib/gate-bundle.cjs", "lib/gsd-host.cjs", "lib/health.cjs", "lib/install-state.cjs", "memanto.cjs", "package.json", "scripts/check-probe.cjs", "scripts/gate.cjs", "test/activation.test.cjs", "test/bundle.test.cjs", "test/config-contract.test.cjs", "test/config.test.cjs", "test/dispatch.test.cjs", "test/doctor.test.cjs", "test/gate-bundle.test.cjs", "test/gate.test.cjs", "test/gsd-host.test.cjs", "test/health.test.cjs", "test/helpers/fake-api.cjs", "test/helpers/fake-memanto.cjs", "test/helpers/gsd-env.cjs", "test/helpers/install-invariants.cjs", "test/install-state.test.cjs", "test/install.test.cjs", "test/loader-drift.test.cjs", "test/manifest.test.cjs", "test/release.test.cjs", "test/skeleton.test.cjs", "test/spike-installer.test.cjs", "test/spike-regression.test.cjs", "test/stage-bundle.test.cjs", "test/traps.test.cjs", "tools/run-tests.cjs", "tools/stage-bundle.cjs"]
covered_digest: "v4:sha256:ea0ceaf599d76cf2c02ffa881d27396a797585f15b2d4eb8291b633e289dfca1"
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 5/7
  gaps_closed:
    - "CR-01: the discuss:pre gate fails closed in project scope; a planted or stray global scripts/gate.cjs is never run, and doctor reports it as a gate-bundle error"
    - "CR-02: gate and doctor output never echo endpoint credentials, including unparseable values such as http://user:p/ss@host:8000 and http://user:p#w@host"
  gaps_remaining: []
  regressions: []
deferred:
  - truth: "CONF-02 (second half): an unknown (non-existent) memanto.agent_id blocks with an actionable message"
    addressed_in: "Phase 2"
    evidence: "Phase 2 success criterion 1: 'The run halts at each of discuss:pre/post ... when any of these is true: the agent id is unknown, ...'. The Phase-1 prohibition forbids spawning the memanto CLI from the gate"
  - truth: "MVP outcome 'discuss-phase runs with memory' in the literal sense: discuss reads memories from the configured agent"
    addressed_in: "Phase 3"
    evidence: "Phase 3 success criterion 1: '/gsd-discuss-phase N and /gsd-plan-phase N write MEMANTO-RECALL.md with the active memories for the phase goal and topic'"
human_verification:
  - test: "Push main (77 commits ahead of origin/main and of v0.1.0) and confirm the CI matrix (ubuntu/macOS x gsd-core 1.20.1/1.22.0) is green on HEAD. Then decide whether to release 0.1.1 before Phase 2"
    expected: "Four green 'test (' runs on HEAD. The owner either releases the CR-01/CR-02 fixes or records that the published 0.1.0 stays as is for now"
    why_human: "The agent may not push or publish. The last CI run is on 5774b92, before every review-fix round. The suite was re-run locally on 1.20.1 only. Published 0.1.0 still carries CR-01 (project scope) and CR-02. main still declares version 0.1.0 with different bytes"
  - test: "Judgment-tier prohibition (01-02): no environment variable, flag or alternate config key skips or softens a gate check; memanto.enabled=false is the only off switch"
    expected: "Owner confirms. Non-authoritative LLM verdict: holds. GSD_HOME selects the global scope for both gsd-core and the predicate (same rule), and after the CR-01 fix a planted gate.cjs is never run"
    why_human: "unverified-prohibition, human review recommended (judgment tier, no wired enforcement test)"
  - test: "Judgment-tier prohibitions (01-08, 01-09): the agent never published, pushed, approved a staged release or handled npm credentials on the owner's behalf"
    expected: "Owner confirms. Non-authoritative LLM verdict: holds. 01-SPIKE.md records an owner-approved 2FA release, and main is unpushed (origin/main...HEAD = 0/77)"
    why_human: "unverified-prohibition, human review recommended (judgment tier)"
  - test: "Backstop truth (01-01): two concurrent `capability install` runs into one GSD_HOME leave one ledger entry and a complete bundle"
    expected: "Owner accepts this as a host-owned guarantee, or asks for a held-out test"
    why_human: "insufficient_spec: non-inferable backstop truth; no phase test exercises it, and presence or wiring cannot qualify it"
---

# Phase 1: Walking Skeleton Verification Report

**Phase Goal:** As a GSD user on gsd-core, I want to install Memanto once and pass its gate, so that discuss-phase runs with memory.
**Mode:** mvp (`user-story.validate` returns valid: true)
**Verified:** 2026-11-22T04:30:00Z
**Status:** human_needed
**Re-verification:** Yes, after gap closure (7 review-fix rounds, HEAD c4d67f0)

## User Flow Coverage (MVP mode)

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Install Memanto once | the bundle installs through gsd-core's install and consent flow, globally or per project | The agent installed HEAD's bundle into a temp GSD_HOME at global and at project scope (stage-bundle.cjs, `status: installed`). install.test, manifest.test and bundle.test pass. The published 0.1.0 is installed globally on the owner's real home (prior acceptance pub-a/pub-d) | VERIFIED |
| Enable it in the project | `memanto.enabled: true` renders exactly one blocking discuss:pre gate; anything else renders none | The agent's run in both scopes: enabled renders the gate and disabled renders NONE. activation.test covers 7 value variants | VERIFIED |
| Pass its gate | with an explicit agent id and both endpoints healthy, the host's `check predicate` returns block:false | The agent's run against the real `GET http://localhost:8000/health` (`{"status":"ok"}`, the only Memanto call): global and project scope both return `block:false`, "command exited 0". Both doctor forms exit 0 | VERIFIED |
| ...and it halts otherwise | an empty agent id, a dead endpoint or mempalace.enabled=true blocks with an actionable line | The agent's runs: [agent-id], [backend-health]/[api-health] and [mempalace] naming both. gate.test and health.test pass | VERIFIED |
| so that discuss-phase runs with memory | discuss proceeds with a healthy Memanto and an explicit agent attached | Headless discuss passed the gate and proceeded (01-SPIKE.md runs d and pub-d). In Phase 1, "with memory" means a verified-healthy Memanto with an explicit agent. Reading memories into discuss is Phase 3 (deferred) | VERIFIED (memory content deferred to Phase 3) |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: install through the third-party install and consent flow; no gsd-core file changes; zero overlay warnings or diagnostics; whitelisted zero-dep CJS, no runtime state | VERIFIED | install.test (snapshot of gsd-core bin/ and workflows/), manifest.test, bundle.test all pass. The agent's temp-home installs report `installed` in both scopes |
| 2 | SC2: discuss:pre halts for an empty agent_id, a failing /health on either endpoint, or mempalace.enabled true (names both); proceeds when all pass; no hook when disabled | VERIFIED | The agent's runs in both scopes (see User Flow). gate.test and health.test cover every mode against fake REST |
| 3 | SC3: doctor reports not-loaded, not-consented, outside engines.gsd and not-rendering as errors | VERIFIED | doctor.test cases pass (e.g. "project-scope install then capability trust revoke: consent is an error"). In the agent's run, a tampered project gate.cjs (hash mismatch, gsd-core renders no hook) gave errors for loaded, consent, render:discuss:pre and gate-bundle, exit 1 |
| 4 | SC4: `node --test` through the real validator, loader and render-hooks on a temp GSD_HOME; dispatch-pair and loader-trap failures; fake memanto CLI and fake REST | VERIFIED | `npm test` (run once): 464 tests, 463 pass, 1 skip (env-gated Q3 installer), 0 fail, exit 0 |
| 5 | SC5: spike Q1, Q2 and Q3 recorded, and the bundle reflects them | VERIFIED (regression check) | 01-SPIKE.md is unchanged in substance. The spike-regression tests pass. `skills: []`, and no D-09 fragment ships |
| 6 | MVP outcome: a GSD user passes the gate, and discuss-phase proceeds with Memanto attached | VERIFIED | User Flow rows 3 to 5. The literal memory read is deferred to Phase 3 |
| 7 | Previous gap CR-01: the gate fails closed at project scope, and doctor exposes stray gate code | VERIFIED (gap closed) | The agent's fresh reproduction, temp GSD_HOME: a consented project install, empty agent_id and dead endpoints. **Before plant:** block:true [agent-id]. **After planting a global `scripts/gate.cjs` with `process.exit(0)`:** still block:true, and the project gate ran. Doctor gives gate-bundle error, exit 1. **Adding an unledgered global capability.json:** block:true [gate-bundle]. Mechanism: capability.json:63 inline rule, mirrored by lib/gate-bundle.cjs:71-74. Tests 91 to 97 and 118/120 in the saved run |
| 8 | Previous gap CR-02: gate and doctor never echo endpoint credentials | VERIFIED (gap closed) | lib/health.cjs:30-104 replaces redaction with a strict allowlist, and a rejected value is shown only as `<redacted>`. The agent's reproduction: `http://user:p/ss@host:8000` and `http://user:p#w@host` are rejected and shown as `<redacted>`. Gate stderr, doctor text, doctor --raw and `gsd_run memanto doctor` contain 0 occurrences of the secret fragments. health.test holds these inputs (3 matches) |

**Score:** 8/8 truths verified (0 present, behavior-unverified)

The plan-level must-haves (01-01 to 01-09) map onto the 464-test suite by name. No regression was found against the truths that passed in the previous report.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | CONF-02: an unknown agent id blocks | Phase 2 | Phase 2 SC1 "the agent id is unknown" |
| 2 | discuss actually reads memories ("with memory", literal) | Phase 3 | Phase 3 SC1, MEMANTO-RECALL.md at discuss and plan |

**SPIDR slices:** The owner-accepted split moved "gate halts on bad config" and "doctor reports fail-open states" into two follow-up phases. Those phases do not exist in ROADMAP.md yet, so nothing can be deferred to them. Their requirements are verified here in full: GATE-03, CONF-02 (empty id), CONF-03, GATE-06, and the halt half of SC2. The code and tests live in this phase. When the owner creates those phases with /gsd-phase, their requirement lists must not duplicate these IDs, or the IDs must be re-mapped in REQUIREMENTS.md.

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| capability.json | VERIFIED | `verify.artifacts` passes. The gate predicate (line 63) selects the gsd-core-loaded scope and blocks on ambiguity |
| scripts/gate.cjs, lib/checks.cjs, lib/config.cjs | VERIFIED | wired: gate.cjs -> checks -> config and health |
| lib/health.cjs | VERIFIED (plan deviation) | `verify.artifacts` 01-02 reports "Missing export: redactUrl". The export was deliberately replaced by `displayEndpoint` plus the strict allowlist (round-4 CR-01), which supplies the "userinfo redaction" capability more strictly. Behavior proven by truth 8. An override is suggested below |
| lib/gate-bundle.cjs, lib/install-state.cjs (new) | VERIFIED | used by memanto.cjs. test/gate-bundle.test checks predicate and module parity. install-state.test has 30 cases covering every state |
| memanto.cjs, lib/gsd-host.cjs, scripts/check-probe.cjs | VERIFIED | doctor runs in both forms (exit 0 when healthy, 1 when not) |
| tools/*, test/**, README, CHANGELOG, workflows | VERIFIED | `verify.artifacts` passes for 01-01, 01-03 to 01-09 |

**Suggested override (looks intentional):**

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
| real ~/.gsd bundle -> throwaway discuss:pre (01-09) | | WIRED by runtime evidence (01-SPIKE.md acceptance). The tool cannot parse a non-file `from` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite (once) | `npm test` | 464 / 463 pass / 1 skip / 0 fail, exit 0 | PASS |
| CR-01 repro | scratchpad `repro/cr01.sh`, temp GSD_HOME | planted global gate.cjs: block:true. Doctor gate-bundle error, exit 1. Real consent.json sha256 unchanged | PASS |
| CR-02 repro | `validateEndpointUrl`/`displayEndpoint`, and the gate plus 3 doctor forms with a `p/ss`/`p#w` config | `<redacted>`, 0 secret matches | PASS |
| Happy path, both scopes | scratchpad `repro/happy.sh` against real `GET /health` | block:false. Both doctor forms exit 0. Disabled: no hook. mempalace: [mempalace] | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exists and no plan declares one. N/A.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|------------|--------|----------|
| INST-01 | 01-01, 01-07, 01-08, 01-09 | SATISFIED | temp-home installs, install.test, real-home 0.1.0 |
| INST-02 | 01-04, 01-09 | SATISFIED | manifest.test zero warnings |
| INST-03 | 01-04, 01-05 | SATISFIED | dispatch.test per-host oracle |
| INST-04 | 01-04 | SATISFIED | traps.test |
| INST-05 | 01-01, 01-06, 01-08 | SATISFIED | bundle.test (builtin-only requires, sync router, pack whitelist, no state) |
| CONF-01 | 01-01, 01-03, 01-09 | SATISFIED | activation.test and the agent's disabled runs |
| CONF-02 | 01-01, 01-02, 01-03, 01-09 | PARTIAL: empty id SATISFIED; unknown id deferred to Phase 2 | agent-id tests and repro; manifest default `""` |
| CONF-03 | 01-02, 01-03, 01-09 | SATISFIED | strict URL rule, GET /health only. The requirement's example is a scheme-less `host:port`, but the gate requires `http(s)://` (README and manifest say so). Informational |
| GATE-03 | 01-02, 01-09 | SATISFIED | the agent's [mempalace] run |
| GATE-06 | 01-06, 01-09 | SATISFIED | the four cases plus the gate-bundle and stray-code states |
| TEST-01 | 01-01, 01-04, 01-05, 01-07, 01-08 | SATISFIED | real validator, loader and render-hooks |
| TEST-02 | 01-02, 01-06 | SATISFIED | fake REST and fake memanto CLI with zero-invocation asserts |

No orphaned requirements. REQUIREMENTS.md still marks all 12 as Pending (informational).

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (all tracked non-planning files) | | no TBD/FIXME/XXX/TODO/placeholder | | none |
| CHANGELOG.md | 5 | `## Unreleased` is empty despite the CR-01/CR-02 security fixes | Info | release notes would omit the fixes |
| main vs v0.1.0 | | 77 unpushed commits change shipped files (966+/171-), and the version is still 0.1.0 | Warning | the fixes reach no installable release; CI has not run on them (human item 1) |
| lib/install-state.cjs | | new 495-line classifier (round 7) with no independent re-review after its fix round | Info | doctor wording only; the gate does not depend on it |

### Release Status (does 0.1.0 vs main matter for the goal?)

Not for the goal. The published 0.1.0 already delivers the happy path: global install, pass the gate, discuss proceeds (pub-d). CR-01 does not affect global scope. It does matter for the fail-closed core value. A project-scope user, or one whose endpoint password holds `/` or `#`, still gets the defective code from npm. The gate's own `[gate-bundle]` reinstall hint pins `@0.1.0` (capability.json:63); publish.yml:204-209 rewrites that pin on the next release.

### Human Verification Required

1. **CI and release.** The owner pushes main, confirms four green `test (` runs on HEAD (1.22.0 and macOS are untested since round 1), and decides on 0.1.1.
2. **Judgment prohibition: no gate bypass.** The owner confirms. The agent's non-authoritative verdict is that it holds. The earlier GSD_HOME caveat is resolved by the CR-01 fix.
3. **Judgment prohibition: no publish on the owner's behalf.** The owner confirms. The agent's non-authoritative verdict is that it holds.
4. **Backstop truth: concurrent installs.** The owner accepts this as a host guarantee or requests a held-out test.

### Gaps Summary

Both previous gaps are closed and were reproduced fresh. All 8 truths verify, and nothing regressed. The status is human_needed, not passed, because of the 3 carried judgment and backstop items and the CI and release item. Two items are deferred: unknown-agent blocking (Phase 2) and literal memory recall in discuss (Phase 3).

---

_Verified: 2026-11-22T04:30:00Z_
_Verifier: Claude (gsd-verifier)_
