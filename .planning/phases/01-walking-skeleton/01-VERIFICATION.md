---
phase: 01-walking-skeleton
verified: 2026-11-21T23:59:00Z
status: gaps_found
score: 5/7 must-haves verified
covered_files: [".github/workflows/ci.yml", ".github/workflows/publish.yml", ".gitignore", ".npmrc", ".planning/phases/01-walking-skeleton/01-01-PLAN.md", ".planning/phases/01-walking-skeleton/01-01-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-02-PLAN.md", ".planning/phases/01-walking-skeleton/01-02-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-03-PLAN.md", ".planning/phases/01-walking-skeleton/01-03-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-04-PLAN.md", ".planning/phases/01-walking-skeleton/01-04-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-05-PLAN.md", ".planning/phases/01-walking-skeleton/01-05-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-06-PLAN.md", ".planning/phases/01-walking-skeleton/01-06-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-07-PLAN.md", ".planning/phases/01-walking-skeleton/01-07-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-08-PLAN.md", ".planning/phases/01-walking-skeleton/01-08-SUMMARY.md", ".planning/phases/01-walking-skeleton/01-09-PLAN.md", ".planning/phases/01-walking-skeleton/01-09-SUMMARY.md", "CHANGELOG.md", "LICENSE", "README.md", "capability.json", "lib/checks.cjs", "lib/config.cjs", "lib/gsd-host.cjs", "lib/health.cjs", "memanto.cjs", "package.json", "scripts/check-probe.cjs", "scripts/gate.cjs", "test/activation.test.cjs", "test/bundle.test.cjs", "test/config-contract.test.cjs", "test/config.test.cjs", "test/dispatch.test.cjs", "test/doctor.test.cjs", "test/gate.test.cjs", "test/gsd-host.test.cjs", "test/health.test.cjs", "test/helpers/fake-api.cjs", "test/helpers/fake-memanto.cjs", "test/helpers/gsd-env.cjs", "test/install.test.cjs", "test/manifest.test.cjs", "test/release.test.cjs", "test/skeleton.test.cjs", "test/spike-installer.test.cjs", "test/spike-regression.test.cjs", "test/traps.test.cjs", "tools/run-tests.cjs", "tools/stage-bundle.cjs"]
covered_digest: "v4:sha256:a0a09d7cd68caf8e7e6ec63082ba92a695dade3ca2c5e085eb3cc996977b03e1"
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "The discuss:pre gate fails closed in every install scope, and doctor exposes every state in which the capability silently fails open (phase goal, sentence 2; CLAUDE.md core value 'any failure blocks the workflow')"
    status: failed
    reason: "CR-01 reproduced by the agent in a temp GSD_HOME: with a consented project-scope install, memanto.agent_id empty and both endpoints dead, a stray $GSD_HOME/.gsd/capabilities/memanto/scripts/gate.cjs (no capability.json, not loaded by gsd-core) makes `check predicate` return block:false ('command exited 0'). In that same state doctor reports loaded ok, consent ok, render:discuss:pre ok and duplicate-install ok; it never says the gate is running code that is not the loaded bundle. The gate passes while doctor's own gate checks report errors. The predicate picks the global directory whenever a scripts/gate.cjs exists there. It never checks that this is the bundle gsd-core loaded and the consent hash covers. Global-scope installs (the owner's primary path) are not affected, because there the global directory is the loaded bundle."
    artifacts:
      - path: "capability.json"
        issue: "line 63: predicate command selects ${GSD_HOME:-$HOME}/.gsd/capabilities/memanto whenever scripts/gate.cjs exists there, regardless of which scope gsd-core loaded"
      - path: "scripts/gate.cjs"
        issue: "no self-check that its own bundle dir is the committed ledger entry or loaded scope it represents"
      - path: "memanto.cjs"
        issue: "duplicateCheck (lines 219-231) and consentCheck (lines 143-164) only consider directories that contain capability.json; a gate.cjs-only or non-loaded global directory next to a project install is reported as ok"
      - path: "test/gate.test.cjs"
        issue: "no regression test for project-scope install with a planted or stale global scripts/gate.cjs"
    missing:
      - "Make the gate select the bundle gsd-core actually loaded and fail closed (exit 1, [gate-internal]-style line) when the scope is ambiguous or both scope dirs hold differing gate code"
      - "Doctor error (not ok, not warn) when a global memanto directory with scripts/gate.cjs exists alongside an active project-scope install and is not the loaded bundle"
      - "Regression test: project-scope install plus a planted global scripts/gate.cjs (process.exit(0)) must still block and doctor must report an error"
  - truth: "Gate and doctor output never echo endpoint credentials (plan 01-02 threat T-01-05 mitigation; lib/health.cjs artifact 'userinfo redaction')"
    status: partial
    reason: "CR-02 reproduced by the agent: redactUrl('http://user:p/ss@host:8000') and redactUrl('http://user:p#w@host') return the input unchanged, so the [backend-url]/[api-url] 'is not an http(s) URL: <value>' line prints the password into gate stderr, the host message and the agent transcript. Parseable user:pass@ URLs are redacted (the literal 01-02 must-have truth, tested only with parseable URLs, passes). The fallback regex at lib/health.cjs:48 excludes / ? # @ from the userinfo span, and an unescaped reserved character in a password is the usual reason a URL does not parse. No roadmap success criterion names credential echo, so this does not defeat SC1-SC5 on its own. It does defeat the declared T-01-05 mitigation and the code comment at lib/health.cjs:33-35."
    artifacts:
      - path: "lib/health.cjs"
        issue: "line 48 fallback regex leaves userinfo containing / or # in unparseable values"
      - path: "test/health.test.cjs"
        issue: "redaction tests cover only parseable URLs"
    missing:
      - "Redact unparseable values greedily to the last '@' before whitespace, or print only '<scheme>://<redacted>' for invalid URLs"
      - "Add 'http://user:p/ss@host:8000' and 'http://user:p#w@host' cases to test/health.test.cjs and a gate-level assertion in test/gate.test.cjs"
deferred:
  - truth: "CONF-02: an unknown (non-existent) memanto.agent_id blocks with an actionable message"
    addressed_in: "Phase 2"
    evidence: "Phase 2 success criterion 1: 'The run halts at each of discuss:pre/post ... when any of these is true: the agent id is unknown, ...'; Phase 1 prohibition forbids spawning the memanto CLI from the gate"
human_verification:
  - test: "Judgment-tier prohibition (01-02): no environment variable, flag or alternate config key skips or softens a gate check; memanto.enabled=false is the only off switch"
    expected: "Owner confirms. Non-authoritative LLM verdict: holds for lib/checks.cjs and scripts/gate.cjs, which read env only for GSD_WORKSTREAM/GSD_PROJECT config resolution. Caveat: GSD_HOME selects which gate.cjs the predicate runs (see the CR-01 gap)"
    why_human: "unverified-prohibition, human review recommended (judgment tier, no wired enforcement test)"
  - test: "Judgment-tier prohibitions (01-08, 01-09): the agent never published, pushed, approved a staged release or handled npm credentials on the owner's behalf"
    expected: "Owner confirms. Non-authoritative LLM verdict: holds. 01-SPIKE.md 'Release (Task 2, owner)' records that the owner staged and approved the release with 2FA"
    why_human: "unverified-prohibition, human review recommended (judgment tier)"
  - test: "Backstop truth (01-01): two concurrent `capability install` runs into one GSD_HOME leave one ledger entry and a complete bundle"
    expected: "Owner accepts this as a host-owned guarantee, or asks for a held-out test"
    why_human: "insufficient_spec: non-inferable backstop truth; no phase test exercises it and presence/wiring cannot qualify it"
---

# Phase 1: Walking Skeleton Verification Report

**Phase Goal:** The owner can install the capability once globally, enable it in one project, and watch a real discuss-phase run pass or halt on a Memanto gate. Doctor exposes every state where the capability silently fails open. The platform unknowns that could change the bundle's structure are settled before anything is built on them.
**Verified:** 2026-11-21T23:59:00Z
**Status:** gaps_found
**Re-verification:** No (initial verification)

## User Flow Coverage (MVP mode)

**Discrepancy:** ROADMAP marks Phase 1 `mode: mvp`, but the goal is not a user story (`user-story.validate` returns `valid: false`: no "As a ..., I want to ..., so that ..."). The verifier contract says to refuse MVP verification in that case and ask the owner to run `/gsd-mvp-phase 1`. The orchestrator explicitly requested verification, so the agent verified goal-backward against the goal's outcome clauses. The owner should reformat the goal or drop `mode: mvp`.

| Step | Expected | Evidence | Status |
|------|----------|----------|--------|
| Install once globally | npm spec with integrity installs into `~/.gsd/capabilities/memanto`, active, global | `~/.gsd-capabilities.json` entry `npm:@taoc/gsd-memanto@0.1.0` with the published sha512. The installed files are byte-identical to repo HEAD (cmp of all 8 shipped code files). 01-SPIKE.md "Post-publish acceptance" | VERIFIED |
| Enable in one project | `memanto.enabled: true` renders the gate; anything else renders none | test/activation.test.cjs (7 value variants); acceptance run e | VERIFIED |
| Watch discuss-phase halt | headless `/gsd-discuss-phase 1 --auto` stops on [agent-id], [api-health], [mempalace] | 01-SPIKE.md acceptance runs a, b, c and pub-a (real home, published package) | VERIFIED (global scope) |
| Watch discuss-phase pass | healthy config proceeds past discuss:pre | acceptance runs d and pub-d (gate EXIT=0, next step reached) | VERIFIED |
| Doctor exposes fail-open states | every fail-open state is reported as an error | Four named cases are tested. A fifth state (CR-01, project scope) is not exposed | FAILED |

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1: install into `$GSD_HOME/.gsd/capabilities/memanto` through the third-party install and consent flow; no gsd-core file changes; real loader reports zero overlay warnings or diagnostics; bundle holds only whitelisted zero-dep CJS and no runtime state | VERIFIED | test/install.test.cjs:61-156 (installed/aborted/--yes, gsd-core bin and workflows snapshot unchanged). manifest.test (no warnings or diagnostics, status active). bundle.test (builtin-only requires, no symlinks, pack whitelist, gate and doctor write nothing). Published tarball has 11 files and no dev paths. gsd-core 627-file aggregate sha256 unchanged (01-SPIKE.md) |
| 2 | SC2: discuss:pre halts with an actionable message for empty agent_id, failing /health on either endpoint, and mempalace.enabled true (names both); proceeds when all pass; no hook when disabled | VERIFIED (global scope) | lib/checks.cjs:67-130 and scripts/gate.cjs:9-28 (exits 1 on any error or exception). test/gate.test.cjs and test/health.test.cjs cover every failure mode against a fake REST server. Live headless runs a-e on the real home and pub-a/pub-d on 0.1.0 observed halts and passes. Project scope is subject to gap 1 |
| 3 | SC3: `gsd_run memanto doctor` reports not-loaded, not-consented, outside engines.gsd and not-rendering as errors | VERIFIED | memanto.cjs:132-217 (loadedCheck, consentCheck, enginesCheck, renderCheck). The test/doctor.test.cjs cases for all four pass. Both forms were observed on the real install |
| 4 | SC4: `node --test` validates through the real validator and loader on a temp GSD_HOME, renders through real `loop render-hooks`, fails on undispatched pairs and the 5 loader traps, and exercises the gate against a fake memanto CLI and a fake REST server | VERIFIED | test/dispatch.test.cjs uses getWiredKinds/validateHooksWired with negative fixtures. test/traps.test.cjs has 10 trap cases. fake-api.cjs and fake-memanto.cjs are wired, and the suite asserts zero memanto CLI invocations. `npm test`: 188 tests, 187 pass, 1 skip, 0 fail (re-run by the agent) |
| 5 | SC5: spike outcomes recorded (Q1 discuss:pre and ship:pre halts including headless, Q2 ref.command dispatch on 1.20.1, Q3 global skill staging) and the bundle reflects them | VERIFIED | 01-SPIKE.md Q1 POSITIVE (5/5 discuss and 2/2 ship halts), Q2 POSITIVE, Q3 POSITIVE (installer run). Bundle impact is recorded: no D-09 fallback, `skills: []`. Regression tests are in spike-regression.test.cjs. The installer test is env-gated and skipped locally; it passed under MEMANTO_SPIKE_INSTALLER=1 on 1.22.0 per 01-SPIKE.md |
| 6 | Goal: the gate fails closed and doctor exposes every state where the capability silently fails open | FAILED | CR-01 reproduced (see gap 1 and Behavioral Spot-Checks) |
| 7 | No credential echo in gate output (T-01-05; lib/health.cjs "userinfo redaction") | FAILED (partial) | CR-02 reproduced (see gap 2) |

**Score:** 5/7 truths verified (0 present, behavior-unverified)

Plan-level must-have truths (01-01 to 01-09, about 70 items) map onto the 188-test suite by name. Every named plan truth that can run without an LLM has a passing test with that name. The live-run truths (01-05, 01-09) are backed by the directly observed transcripts recorded in 01-SPIKE.md. 01-09's key link (real bundle to the throwaway project) is runtime-only, and the `verify.key-links` tool cannot parse it. The acceptance transcripts prove it.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | CONF-02 "unknown id blocks" | Phase 2 | Phase 2 SC1: "the agent id is unknown" halts every gate |

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| capability.json | VERIFIED (wiring defect) | `verify.artifacts`: all plans pass (31/31). Gate predicate wired to scripts/gate.cjs, but its scope selection is the CR-01 defect |
| scripts/gate.cjs, lib/checks.cjs, lib/config.cjs, lib/health.cjs | VERIFIED (health.cjs partial: CR-02) | substantive, wired gate.cjs -> checks -> config/health |
| memanto.cjs, lib/gsd-host.cjs, scripts/check-probe.cjs | VERIFIED | doctor is routed by gsd-core and also runs directly. check-probe reuses runGateChecks |
| tools/stage-bundle.cjs, tools/run-tests.cjs, test/** | VERIFIED | used by every test via gsd-env.cjs |
| README.md, CHANGELOG.md, LICENSE, ci.yml, publish.yml | VERIFIED | release.test.cjs anti-drift checks pass. 0.1.0 published via publish.yml (run 44964773176) |
| .planning/phases/01-walking-skeleton/01-SPIKE.md | VERIFIED | contains Q1, Q2, Q3 and "Acceptance run (D-08)" |

### Key Link Verification

| From | To | Status |
|------|-----|--------|
| All plan key_links (01-01 to 01-08) | | WIRED (`verify.key-links` 18/18) |
| real ~/.gsd bundle to throwaway discuss:pre (01-09) | | WIRED by runtime evidence (01-SPIKE.md acceptance a-e, pub-a, pub-d). The tool cannot parse a non-file `from` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite | `npm test` (once) | 188 tests / 187 pass / 1 skip (Q3 installer, env-gated) / 0 fail, exit 0 | PASS |
| CR-01 project-scope fail-open | scratch script, temp GSD_HOME: project install, empty agent_id, planted global `scripts/gate.cjs` | before plant: block true [agent-id]. After plant: `{"block":false,"message":"command exited 0"}`. Doctor exit 1 (agent-id and health errors) with loaded, consent, render:discuss:pre and duplicate-install all ok. Real consent.json unchanged | FAIL |
| CR-02 redaction | `node -e "redactUrl(...)"` | `http://user:p/ss@host:8000` and `http://user:p#w@host` come back unchanged; parseable `user:pass@` is stripped | FAIL |
| Installed bundle equals repo | `cmp` of 8 shipped code files vs `~/.gsd/capabilities/memanto` | all identical; `git diff v0.1.0 HEAD` on shipped files is empty | PASS |

### Probe Execution

No `scripts/*/tests/probe-*.sh` exist and no plan declares one. Step 7c: N/A.

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|------------|--------|----------|
| INST-01 | 01-01, 01-07, 01-08, 01-09 | SATISFIED | global install via npm + integrity on the real home, gsd-core unchanged |
| INST-02 | 01-04, 01-09 | SATISFIED | manifest.test zero warnings/diagnostics |
| INST-03 | 01-04, 01-05 | SATISFIED | dispatch.test oracle per host version |
| INST-04 | 01-04 | SATISFIED | traps.test 10 cases plus static assertions |
| INST-05 | 01-01, 01-06, 01-08 | SATISFIED | bundle.test, sync route(), no dependencies, pack whitelist |
| CONF-01 | 01-01, 01-03, 01-09 | SATISFIED | activation.test, config-contract render iff boolean true |
| CONF-02 | 01-01, 01-02, 01-03, 01-09 | PARTIAL (empty: SATISFIED; unknown id: deferred to Phase 2) | agent-id tests; no default agent shipped |
| CONF-03 | 01-02, 01-03, 01-09 | SATISFIED | URL validation and health checks, GET /health only, never starts servers |
| GATE-03 | 01-02, 01-09 | SATISFIED | strict `=== true`, message names both; acceptance run c |
| GATE-06 | 01-06, 01-09 | SATISFIED as worded (four enumerated cases) | the CR-01 state falls outside the four enumerated cases (gap 1) |
| TEST-01 | 01-01, 01-04, 01-05, 01-07, 01-08 | SATISFIED | real validator, loader and render-hooks on a temp GSD_HOME |
| TEST-02 | 01-02, 01-06 | SATISFIED | fake REST and fake memanto CLI |

No orphaned requirements: all 12 Phase-1 IDs in REQUIREMENTS.md appear in plan frontmatter. REQUIREMENTS.md still shows them unchecked and "Pending" (traceability not updated; informational).

### Prohibitions

| Prohibition | Tier | Disposition |
|-------------|------|-------------|
| 01-01 no implicit/default agent | test | enforced (agent-id tests; manifest-defaults test) |
| 01-01 gate never exits 0 when a check cannot be evaluated | test | enforced for malformed config and missing gate script (config tests; spike-regression "gate script is missing still blocks"). CR-01 is an adjacent violation: a foreign gate script exits 0 |
| 01-01 no gsd-core/settings/.mcp.json/CLAUDE.md modification | test | enforced (install.test snapshot; manifest has no hooks/mcpServers; settings.json sha unchanged in acceptance) |
| 01-01, 01-05, 01-07 no real ~/.gsd or ~/.claude writes from tests or spikes | test | enforced (realConsentStamp asserts in 4 suites; installer test uses a temp config dir) |
| 01-02 no memanto CLI spawn, no server control | test | enforced ("no gate run in this file spawned the memanto CLI") |
| 01-06 doctor read-only | test | enforced (bundle.test tree digests) |
| 01-09 only GET /health against real Memanto | test | enforced by test plus transcripts (no memanto CLI call in any acceptance transcript) |
| 01-02 no env/flag bypass | judgment | flagged for human review (non-authoritative: holds; GSD_HOME caveat) |
| 01-08, 01-09 no publish on the owner's behalf | judgment | flagged for human review (non-authoritative: holds) |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| capability.json | 63 | gate dir chosen by file existence, not by loaded scope | Blocker | gap 1 (CR-01) |
| lib/health.cjs | 48 | incomplete userinfo strip for unparseable URLs | Warning (security) | gap 2 (CR-02) |
| lib/gsd-host.cjs | 22-28 | spawnSync without timeout (WR-01) | Warning | doctor can hang; fails visibly, not open |
| lib/gsd-host.cjs | 60-93 | doctor executes a project-planted gsd-tools.cjs (WR-02) | Warning | trust issue in the doctor path, not the gate |

No TBD/FIXME/XXX/TODO/placeholder markers in any tracked non-planning file. The only skip is the env-gated Q3 installer test, which has an always-on companion test.

### Test Quality Audit

| Test File | Linked Req | Skipped | Circular | Assertion Level | Verdict |
|-----------|-----------|---------|----------|-----------------|---------|
| gate.test / health.test | GATE-03, CONF-02, CONF-03, TEST-02 | 0 | no | value + behavioral (real host check predicate) | OK (no unparseable-userinfo case) |
| doctor.test | GATE-06 | 0 | no | value (check id + status + exit) | OK (no CR-01 state) |
| install/manifest/dispatch/traps/bundle | INST-01..05, TEST-01 | 0 | no | behavioral through real host | OK |
| spike-installer.test | TEST-01 (Q3) | 1 (env-gated) | no | value | OK (companion always runs) |

Disabled tests that are the only proof of a requirement: 0. Circular patterns: 0.

### Decision Coverage

All trackable CONTEXT.md decisions are honored by shipped artifacts (21/21).

### Human Verification Required

1. **Judgment prohibition: no gate bypass.** The owner confirms that no env var, flag or alternate key softens a gate. The agent's non-authoritative verdict is that this holds, except that GSD_HOME selects the gate script (gap 1).
2. **Judgment prohibition: no publish on the owner's behalf.** The owner confirms. Per 01-SPIKE.md, the owner approved the release with 2FA.
3. **Backstop truth: concurrent installs.** The owner accepts this as a host guarantee or requests a held-out test (insufficient_spec).

### Gaps Summary

The owner's primary path works end to end on the published 0.1.0 package: global install, enabling in one project, a real headless discuss-phase halting on [agent-id], [api-health] and [mempalace] and passing when healthy, both doctor forms, and the spike answers. Two gaps remain, and both trace to open critical code-review findings.

1. **CR-01 (blocker).** The phase goal says the gate fails closed and doctor exposes every silent fail-open state. That does not hold for a project-scope install. The gate runs whichever global `scripts/gate.cjs` exists, even when gsd-core did not load that bundle, and doctor reports the state as healthy apart from the gate checks the real gate never enforced. Project scope is part of the phase surface: doctor's consent check exists only for project scope (SC3), and doctor's own fix hints tell the owner to reinstall with `--scope project` (memanto.cjs:58-59, 150). If the owner decides project scope is out of Phase-1 scope, an override can accept this deviation. The agent does not recommend one, because the defect contradicts the fail-closed core value:

   ```yaml
   overrides:
     - must_have: "The gate fails closed and doctor exposes every state where the capability silently fails open"
       reason: "Phase 1 supports global-scope installs only; project-scope fail-closed hardening tracked as <issue>"
       accepted_by: "<owner>"
       accepted_at: "<ISO timestamp>"
   ```

2. **CR-02 (partial, security).** An endpoint password containing `/` or `#` is echoed in the [backend-url]/[api-url] line. This does not defeat SC1-SC5, but it breaks the declared T-01-05 mitigation and the redaction claim in lib/health.cjs:33-35.

---

_Verified: 2026-11-21T23:59:00Z_
_Verifier: Claude (gsd-verifier)_
