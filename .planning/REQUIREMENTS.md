# Requirements: gsd-memanto

**Defined:** 2026-11-20
**Core Value:** When the capability is enabled, every GSD lifecycle stage reliably reads from and writes to the project's explicitly configured Memanto agent. Any failure blocks the workflow, and gsd-core is never modified.

## v1 Requirements

Requirements for the initial release. Each maps to a roadmap phase.

### Install & Manifest

- [x] **INST-01**: Owner can install the capability globally (`$GSD_HOME/.gsd/capabilities/memanto`) through gsd-core's third-party install and consent flow, without editing any gsd-core file
- [x] **INST-02**: The installed manifest (`capability.json`, `engines.gsd >=1.20.1 <2.0.0`) loads through gsd-core's real loader with zero overlay warnings or diagnostics
- [x] **INST-03**: Every declared gate, step and contribution sits at a (point, kind) pair the host actually dispatches on gsd-core 1.20.1 (no `execute:pre`; no gates at `verify:post`, `ship:post` or `execute:wave:pre`), verified by a dispatch test
- [x] **INST-04**: The manifest avoids the loader traps that skip a capability: `MEMANTO-RECALL.md` instead of `MEMORY-RECALL.md`, `consumes` only host artifacts (CONTEXT/PLAN/SUMMARY/UAT), valid `into` roles, `when` only on the capability's own boolean keys, no reserved `gsd-` prefixes
- [x] **INST-05**: The bundle is zero-dependency Node CJS with a synchronous `memanto` command family, keeps runtime state outside the bundle, and ships as a minimal package (files whitelist)

### Configuration & Connectivity

- [x] **CONF-01**: Owner enables the capability per project with `memanto.enabled` (the activationKey); when it is false, no Memanto hook runs
- [ ] **CONF-02**: Owner sets `memanto.agent_id` explicitly per project; it defaults to `""`, and an empty or unknown id blocks with an actionable message (no implicit agent; `memanto-dev` is never a shipped default)
- [x] **CONF-03**: Owner configures the pre-running Memanto backend endpoint (on-prem host:port such as `plex2.nomorestars.com:8080`, or cloud) and the Memanto REST API URL; the capability never starts, stops or reconfigures either one
- [ ] **CONF-04**: Preflight checks that both endpoints' `/health` respond OK, that the configured agent exists, and that a canary write-and-read round-trip lands in the configured agent's namespace; any failure blocks
- [ ] **CONF-05**: Per-feature toggles (recall, temporal, answer, bootstrap, wave recall, uploads, daily summary, export) are single boolean config keys the owner can turn off without disabling the capability
- [ ] **CONF-06**: The capability works with any Memanto backend (on-prem or cloud) without backend-specific code paths beyond configuration

### Session & Identity

- [ ] **SESS-01**: Before each memory batch, the capability re-activates only the configured agent (verify-then-act) and re-verifies its identity, so session expiry never interrupts a workflow
- [ ] **SESS-02**: Reads and writes go through Memanto REST with the agent named on every request; CLI is used only for features REST lacks, under a lock with active-agent verification
- [ ] **SESS-03**: Interactive prompt contributions direct the LLM to use Memanto MCP tools with an explicit `agent_id` where an MCP tool exists, and to halt on any non-ok result
- [ ] **SESS-04**: The capability never enables machine-global `agent auto-activate`, and never creates an agent from a hook
- [ ] **SESS-05**: Session tokens are never printed to logs, artifacts or memory

### Enforcement & Gates

- [ ] **GATE-01**: Blocking gates (`command-exit-zero`, `blocking: true`, `onError: halt`) run at every gate-capable point the capability uses (discuss:pre/post, plan:pre/post, execute:wave:post, execute:post, verify:pre, ship:pre) and stop the workflow on any Memanto failure
- [ ] **GATE-02**: Operations at step-only points (`verify:post`, `ship:post`, `execute:wave:pre`) record pending/ok/failed in an append-only local ledger; the next gate refuses to pass until failed operations have been retried successfully
- [x] **GATE-03**: Every gate refuses to pass while `mempalace.enabled` is true (MemPalace mutual exclusion), with a message naming both capabilities
- [ ] **GATE-04**: Each gate failure prints a distinct, actionable message (which check failed, what the owner should do)
- [ ] **GATE-05**: `memanto.enabled=false` is the single documented break-glass; there is no other bypass
- [x] **GATE-06**: The doctor command detects the fail-open cases (enabled in config but not loaded, not consented, engines mismatch, not rendering at a point) and reports them as errors

### Recall

- [ ] **RECL-01**: At `discuss:pre` and `plan:pre`, the capability recalls active memories for the phase's goal and topic into `MEMANTO-RECALL.md` (bounded, labeled untrusted, with provenance)
- [ ] **RECL-02**: Recall includes temporal views: `--changed-since` the last ship timestamp in the ledger, and `--as-of` for what was true when a referenced phase was planned
- [ ] **RECL-03**: Recall includes a RAG `answer` brief for the phase topic, labeled as synthesized and with citations
- [ ] **RECL-04**: At phase start and on resume-work, an `agent bootstrap` snapshot primes the context
- [ ] **RECL-05**: At `execute:wave:pre`, past `error`/`learning` memories relevant to the wave are recalled into the executor's context

### Conflicts

- [ ] **CNFL-01**: `detect-conflicts` runs at most once per phase-day for the configured agent and date (a ledger guard prevents re-runs)
- [ ] **CNFL-02**: Detected conflicts are filtered to the current phase's tags and presented to the owner during discuss-phase for resolution (keep_old / keep_new / keep_both / remove_both / manual)
- [ ] **CNFL-03**: Owner resolutions are applied through Memanto REST conflict resolve, and the result is verified
- [ ] **CNFL-04**: In headless or autonomous runs, unresolved conflicts are recorded as unresolved in CONTEXT.md and don't block

### Capture

- [ ] **CAPT-01**: Key decisions from discuss and plan (CONTEXT, PLAN rationale) are remembered as `decision` memories with deterministic tags (`gsd`, project, phase, kind)
- [ ] **CAPT-02**: Confirmed problem → fix pairs from each execution wave are remembered as `error`/`learning` memories in a single batch per wave
- [ ] **CAPT-03**: Phase artifacts (PLAN at plan/execute, SUMMARY at execute:post, UAT/verification content at verify:post) are uploaded by default with deterministic filenames
- [ ] **CAPT-04**: Every write and upload passes through a secret scrubber; a hit blocks the operation with the location of the match
- [ ] **CAPT-05**: Writes are idempotent: the ledger records content hashes and memory ids, so re-running a phase creates no duplicate memories or uploads
- [ ] **CAPT-06**: Content over Memanto's 10,000-character cap is chunked deterministically; content that Memanto's injection filter rejects blocks with a clear explanation
- [ ] **CAPT-07**: At ship, `daily-summary` is generated for the configured agent and date and recorded in the ledger

### Lifecycle

- [ ] **LIFE-01**: When a later phase replaces a decision, the old memory is expired with reason `superseded-by-phase-NN`, and recall defaults to active memories
- [ ] **LIFE-02**: Owner can restore a wrongly expired memory with an owner command
- [ ] **LIFE-03**: Every write carries an explicit confidence and provenance (`explicit_statement` for owner-stated decisions, `inferred`, `validated` for confirmed fixes, `corrected` after a conflict is resolved)
- [ ] **LIFE-04**: GSD decisions are tagged `pinned` so expiry presets never age them out; doctor shows the agent's policy and presets
- [ ] **LIFE-05**: Owner can apply a policy preset through a guarded owner command (shows the effect and requires confirmation)
- [ ] **LIFE-06**: At ship, a policy `apply --dry-run` report shows what would expire, without applying it
- [ ] **LIFE-07**: When a decision is refined within the same phase, the existing memory (id taken from the ledger) is edited in place instead of duplicated

### Owner Commands

- [ ] **CMD-01**: `gsd_run memanto doctor` reports the full health picture: endpoints, agent, session, consent/load state, MemPalace exclusion, MCP registration (read-only `connect list`), policy, schedule status
- [ ] **CMD-02**: `gsd_run memanto setup` checks prerequisites, writes the project's memanto config, and can create a new agent with an owner-named id only on explicit request
- [ ] **CMD-03**: `gsd_run memanto recall|answer` lets the owner query the project's memory on demand
- [ ] **CMD-04**: `gsd_run memanto conflicts` lists and resolves conflicts outside of discuss
- [ ] **CMD-05**: `gsd_run memanto ledger` shows pending/ok/failed operations and retries failed ones
- [ ] **CMD-06**: `gsd_run memanto schedule enable|disable|status` manages Memanto's nightly job only on explicit owner request, disclosing that the job is machine-global
- [ ] **CMD-07**: `gsd_run memanto export` produces a memory export or OKF snapshot on demand or at milestone completion (off by default)

### Coverage

- [ ] **COVR-01**: `COVERAGE.md` lists every Memanto CLI command and subcommand, REST route group, and MCP tool as INTEGRATE (with its GSD mapping) or OPT-OUT (with a one-line reason), in gsd-core's api-coverage format
- [ ] **COVR-02**: A conformance test fails if `memanto --help` (recursively) exposes any command not listed in COVERAGE.md

### Testing & Delivery

- [x] **TEST-01**: Automated `node:test` suite validates the manifest through gsd-core's real validator and loader on a temporary `GSD_HOME`, and renders hooks through the real `loop render-hooks`
- [x] **TEST-02**: Gates, commands and adapter run against a stubbed Memanto (fake CLI on PATH, fake REST server)
- [ ] **TEST-03**: Fault-injection tests cover backend down, REST API down, CLI missing, wrong active agent, expired session, unknown agent id, MemPalace enabled, engines mismatch, consent removed, and a seeded secret
- [ ] **TEST-04**: An opt-in live suite (`MEMANTO_LIVE=1`, agent from env only) exercises recall, capture, upload, conflicts and summary against the real servers
- [ ] **TEST-05**: A full discuss → plan → execute → verify → ship cycle in a test project against the dev agent leaves the expected memories, uploads, summaries and ledger entries, and a second run creates no duplicates
- [ ] **TEST-06**: README documents prerequisites (pre-running servers, `memanto-mcp` + `connect` as owner steps), install, configuration, the fail-open-when-not-loaded caveat, and the break-glass

## v2 Requirements

Deferred. Tracked but not in the current roadmap.

- **V2-01**: Project-scope install as a supported alternative, once gsd-core stages third-party skills at project scope
- **V2-02**: Curator agent, if gsd-core starts staging third-party `agents[]`
- **V2-03**: Wiring `execute:pre` once a released gsd-core dispatches it

## Out of Scope

| Feature | Reason |
|---------|--------|
| Modifying gsd-core | Capability must work purely as an installable overlay |
| First-party/upstream inclusion | Owner chose third-party distribution |
| MemPalace → Memanto migration; `memanto migrate *` | Owner ruled it out; switching providers starts fresh |
| Coexisting / dual-writing with MemPalace | Mutually exclusive by owner decision |
| `serve`, `ui`, `widget`, `/api/ui/*` | Servers are pre-running; GUI/dashboard isn't a workflow concern |
| `login`, `logout`, `use`, `to-cloud` | Backend is configured outside the capability |
| `memanto connect` (mutating), `memory sync`, installing `memanto-mcp` | Edits user/instruction files; owner prerequisite |
| `agent auto-activate on` | Machine-global; reopens the last-used agent |
| `agent delete`, `agent deactivate`, `forget`, `policy purge` | Destructive or disruptive; owner runs them directly in Memanto |
| `remember --from-conversation` / extract | Noisy LLM extraction; owner chose explicit capture |
| MCP admin tools | Off by default upstream; CLI/REST cover them |
| Uploading all of `.planning/` | Noise, cost and secrets; only phase artifacts |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INST-01 | Phase 1 | Complete |
| INST-02 | Phase 1 | Complete |
| INST-03 | Phase 1 | Complete |
| INST-04 | Phase 1 | Complete |
| INST-05 | Phase 1 | Complete |
| CONF-01 | Phase 1 | Complete |
| CONF-02 | Phase 1 (empty id), Phase 2 (unknown id) | Partial |
| CONF-03 | Phase 1 | Complete |
| CONF-04 | Phase 2 | Pending |
| CONF-05 | Phase 6 | Pending |
| CONF-06 | Phase 7 | Pending |
| SESS-01 | Phase 2 | Pending |
| SESS-02 | Phase 2 | Pending |
| SESS-03 | Phase 3 | Pending |
| SESS-04 | Phase 2 | Pending |
| SESS-05 | Phase 2 | Pending |
| GATE-01 | Phase 2 | Pending |
| GATE-02 | Phase 5 | Pending |
| GATE-03 | Phase 1 | Complete |
| GATE-04 | Phase 2 | Pending |
| GATE-05 | Phase 2 | Pending |
| GATE-06 | Phase 1 | Complete |
| RECL-01 | Phase 3 | Pending |
| RECL-02 | Phase 6 | Pending |
| RECL-03 | Phase 3 | Pending |
| RECL-04 | Phase 3 | Pending |
| RECL-05 | Phase 5 | Pending |
| CNFL-01 | Phase 4 | Pending |
| CNFL-02 | Phase 4 | Pending |
| CNFL-03 | Phase 4 | Pending |
| CNFL-04 | Phase 4 | Pending |
| CAPT-01 | Phase 4 | Pending |
| CAPT-02 | Phase 5 | Pending |
| CAPT-03 | Phase 5 | Pending |
| CAPT-04 | Phase 4 | Pending |
| CAPT-05 | Phase 4 | Pending |
| CAPT-06 | Phase 4 | Pending |
| CAPT-07 | Phase 5 | Pending |
| LIFE-01 | Phase 6 | Pending |
| LIFE-02 | Phase 6 | Pending |
| LIFE-03 | Phase 4 | Pending |
| LIFE-04 | Phase 6 | Pending |
| LIFE-05 | Phase 6 | Pending |
| LIFE-06 | Phase 6 | Pending |
| LIFE-07 | Phase 4 | Pending |
| CMD-01 | Phase 2 | Pending |
| CMD-02 | Phase 2 | Pending |
| CMD-03 | Phase 3 | Pending |
| CMD-04 | Phase 4 | Pending |
| CMD-05 | Phase 5 | Pending |
| CMD-06 | Phase 6 | Pending |
| CMD-07 | Phase 6 | Pending |
| COVR-01 | Phase 7 | Pending |
| COVR-02 | Phase 7 | Pending |
| TEST-01 | Phase 1 | Complete |
| TEST-02 | Phase 1 | Complete |
| TEST-03 | Phase 7 | Pending |
| TEST-04 | Phase 7 | Pending |
| TEST-05 | Phase 7 | Pending |
| TEST-06 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 60 total
- Mapped to phases: 60
- Unmapped: 0 ✓

---
*Requirements defined: 2026-11-20*
*Last updated: 2026-11-20 after roadmap creation*
