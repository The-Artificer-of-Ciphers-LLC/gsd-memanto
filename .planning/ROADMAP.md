# Roadmap: gsd-memanto

## Overview

The capability is built as vertical MVP slices. Each slice runs end to end through gsd-core 1.20.1's real loader and a pre-running Memanto, and nothing is a horizontal layer. Phase 1 is a walking skeleton: a globally installed bundle with one blocking gate and a doctor command. It also runs the platform spike, which can change the bundle's structure. Phase 2 extends that thin enforcement spine into verified agent identity at every gate-capable point. Phases 3 to 6 then add memory behavior in lifecycle order. Recall informs discuss and plan. Decisions are captured and conflicts resolved. Execute, verify and ship leave a trail behind a fail-closed ledger. Memory is kept current over time. Phase 7 closes out the COVERAGE.md conformance and proves the full discuss → plan → execute → verify → ship cycle against real Memanto.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Walking Skeleton** - Globally installed capability, one blocking Memanto gate at discuss:pre, doctor for fail-open states, platform spike settled
- [ ] **Phase 2: Verified Identity at Every Gate** - Health, agent, session and canary checks block every gate-capable point; setup and full doctor
- [ ] **Phase 3: Memory-Informed Discuss and Plan** - MEMANTO-RECALL.md, RAG answer brief, bootstrap priming, MCP-directed prompts, on-demand recall
- [ ] **Phase 4: Decisions Remembered, Conflicts Resolved** - Scrubbed, idempotent decision capture with provenance; day-scoped conflict detection resolved with the owner
- [ ] **Phase 5: Execution, Verification and Ship Leave a Trail** - Wave recall, fix capture, artifact uploads, daily summary, fail-closed ledger for step-only points
- [ ] **Phase 6: Memory Stays Current Over Time** - Supersession and restore, temporal recall, pinned decisions and guarded policy, schedule and export, per-feature toggles
- [ ] **Phase 7: Coverage and Full-Cycle Proof** - COVERAGE.md conformance, fault injection, live suite, full-cycle E2E, README

## Phase Details

### Phase 1: Walking Skeleton
**Goal**: The owner can install the capability once globally, enable it in one project, and watch a real discuss-phase run pass or halt on a Memanto gate. Doctor exposes every state where the capability silently fails open. The platform unknowns that could change the bundle's structure are settled before anything is built on them.
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: INST-01, INST-02, INST-03, INST-04, INST-05, CONF-01, CONF-02, CONF-03, GATE-03, GATE-06, TEST-01, TEST-02
**Success Criteria** (what must be TRUE):
  1. The owner installs the bundle into `$GSD_HOME/.gsd/capabilities/memanto` through gsd-core's third-party install and consent flow, and no gsd-core file changes. gsd-core's real loader reports the capability loaded with zero overlay warnings or diagnostics. The installed bundle contains only whitelisted, zero-dependency CJS files and holds no runtime state after use.
  2. In an enabled project, `/gsd-discuss-phase` halts at the `discuss:pre` gate with an actionable message in three cases: `memanto.agent_id` is empty, either configured endpoint's `/health` fails, or `mempalace.enabled` is true (that message names both capabilities). When all checks pass the run proceeds. With `memanto.enabled=false`, no Memanto hook runs.
  3. `gsd_run memanto doctor` reports four cases as errors: the capability is enabled in config but not loaded, it is not consented, it is outside `engines.gsd`, or it does not render at a declared point.
  4. `node --test` validates the manifest through gsd-core's real validator and loader on a temporary `GSD_HOME` and renders hooks through the real `loop render-hooks`. It fails if any hook sits at an undispatched (point, kind) pair or trips a loader trap: `MEMORY-RECALL.md`, non-host `consumes`, an invalid `into` role, `when` on an undeclared key, or a reserved prefix. It also exercises the gate against a fake `memanto` CLI and a fake REST server.
  5. The spike outcomes are recorded, and the bundle reflects them. They answer three questions: whether a gate halts a real run at `discuss:pre` and `ship:pre` (including headless), whether a `ref.command` step dispatches the third-party `memanto` command family on gsd-core 1.20.1, and whether global-scope skills are staged.
**Plans:** 9 plans

Plans:
**Wave 1**
- [ ] 01-01-PLAN.md — Tracer: staged bundle installs globally; discuss:pre gate halts on empty agent_id, passes when set; install/activation tests and npm test runner

**Wave 2** *(blocked on Wave 1 completion)*
- [ ] 01-02-PLAN.md — Full gate check set: MemPalace exclusion, agent_id edges, endpoint validation and health checks, output budget, fake REST and fake memanto doubles
- [ ] 01-03-PLAN.md — Config resolver matches gsd-core resolution (project/workstream layers) with a host contract test
- [ ] 01-04-PLAN.md — Conformance: zero-warning load, dispatch oracle per host version, loader-trap fixtures
- [ ] 01-05-PLAN.md — Spike Q1/Q2 (live headless discuss:pre and ship:pre halts, ref.command dispatch) with regression tests and the D-09 fallback

**Wave 3** *(blocked on Wave 2 completion)*
- [ ] 01-06-PLAN.md — memanto doctor (four fail-open errors, gate checks, both invocation forms) and bundle hygiene tests
- [ ] 01-07-PLAN.md — Spike Q3: owner-approved gsd-core installer run into a throwaway config dir; env-gated regression test
- [ ] 01-08-PLAN.md — README, CHANGELOG, LICENSE, CI matrix (ubuntu/macOS x gsd-core 1.20.1/1.22.0), OIDC release workflow, owner check of the CI host package

**Wave 4** *(blocked on Wave 3 completion)*
- [ ] 01-09-PLAN.md — Headless acceptance on the real home, owner-run 0.1.0 release, re-check on the published package

### Phase 2: Verified Identity at Every Gate
**Goal**: Every gate-capable GSD stage in an enabled project proves it is reading and writing the configured agent. The endpoints are healthy, the agent exists, the session is live and the canary lands, or the stage does not continue. Setup and doctor give the owner the complete picture.
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: CONF-04, SESS-01, SESS-02, SESS-04, SESS-05, GATE-01, GATE-04, GATE-05, CMD-01, CMD-02
**Success Criteria** (what must be TRUE):
  1. The run halts at each of `discuss:pre/post`, `plan:pre/post`, `execute:wave:post`, `execute:post`, `verify:pre` and `ship:pre` when any of these is true: the agent id is unknown, the session cannot be re-established, the active agent is not the configured one, or the canary write-and-read does not land in the configured agent's namespace. Each failure prints a distinct message naming the failed check and the owner's next step.
  2. When the Memanto session has expired, the next gate re-activates only the configured agent, re-verifies its identity and lets the workflow continue. Machine-global `auto-activate` stays off, and no hook ever creates an agent.
  3. Every memory request names the agent in the REST route. The only CLI calls are for features REST lacks, and they run under a lock after the active agent is verified. A seeded session token never appears in logs, generated artifacts or stored memories.
  4. `gsd_run memanto setup` checks prerequisites and writes the project's `memanto.*` config. It creates an agent only when the owner explicitly asks with a new, owner-named id. `gsd_run memanto doctor` reports endpoints, agent, session, consent and load state, MemPalace exclusion, MCP registration (read-only `connect list`), policy and schedule status.
  5. Setting `memanto.enabled=false` is the only way past a failing gate. Doctor output and the config documentation name it as the break-glass, and no flag or environment variable bypasses a gate.
**Plans**: TBD

### Phase 3: Memory-Informed Discuss and Plan
**Goal**: When the owner starts discussing or planning a phase, both the owner and the LLM see what the configured agent already knows about that phase. That memory arrives as bounded, untrusted, attributed context.
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: RECL-01, RECL-03, RECL-04, SESS-03, CMD-03
**Success Criteria** (what must be TRUE):
  1. `/gsd-discuss-phase N` and `/gsd-plan-phase N` write `MEMANTO-RECALL.md` with the active memories for the phase goal and topic. The memories come from the configured agent only, are capped in size and marked untrusted, and each item carries provenance.
  2. `MEMANTO-RECALL.md` includes a RAG `answer` brief for the phase topic, labeled as synthesized and carrying citations.
  3. Starting a phase and resuming work both prime the context with an `agent bootstrap` snapshot of the configured agent.
  4. In an interactive session, the discuss and plan prompt contributions direct the LLM to Memanto MCP tools with an explicit `agent_id`. The LLM halts on any non-ok tool result instead of continuing without memory.
  5. `gsd_run memanto recall "<query>"` and `gsd_run memanto answer "<question>"` return results from the project's configured agent on demand.
**Plans**: TBD

### Phase 4: Decisions Remembered, Conflicts Resolved
**Goal**: Decisions reached in discuss and plan become durable memories in the configured agent: scrubbed, de-duplicated and attributed. Contradictions with earlier memory are put to the owner and resolved.
**Mode:** mvp
**Depends on**: Phase 3
**Requirements**: CAPT-01, CAPT-04, CAPT-05, CAPT-06, LIFE-03, LIFE-07, CNFL-01, CNFL-02, CNFL-03, CNFL-04, CMD-04
**Success Criteria** (what must be TRUE):
  1. After discuss and plan, the phase's key decisions appear in the configured agent as `decision` memories tagged `gsd`, project, phase and kind. Each carries an explicit confidence and provenance: `explicit_statement`, `inferred`, `validated` or `corrected`.
  2. Re-running discuss or plan for the same phase creates no duplicate memories. A decision refined within the phase is edited in place, using the memory id recorded in the ledger.
  3. A decision containing a seeded secret is blocked, with the location of the match. Content over 10,000 characters is chunked deterministically. Content that Memanto's injection filter rejects blocks with a clear explanation.
  4. `detect-conflicts` runs at most once per phase-day for the configured agent. During discuss, its conflicts are filtered to the phase's tags and put to the owner. The owner's choice (keep_old, keep_new, keep_both, remove_both or manual) is applied through REST conflict resolve and then verified. Headless runs record the conflicts as unresolved in CONTEXT.md and continue.
  5. `gsd_run memanto conflicts` lists and resolves conflicts outside discuss.
**Plans**: TBD

### Phase 5: Execution, Verification and Ship Leave a Trail
**Goal**: An execute → verify → ship run leaves its fixes, artifacts and session summary in the configured agent. A capture that cannot block at its own point blocks the next gate until it succeeds.
**Mode:** mvp
**Depends on**: Phase 4
**Requirements**: RECL-05, CAPT-02, CAPT-03, CAPT-07, GATE-02, CMD-05
**Success Criteria** (what must be TRUE):
  1. Before each execution wave, past `error`/`learning` memories relevant to the wave are recalled into the executor's context.
  2. After each wave, the confirmed problem → fix pairs are stored as `error`/`learning` memories in a single batch.
  3. Three artifacts are uploaded under deterministic filenames: PLAN (at plan/execute), SUMMARY (at `execute:post`) and UAT/verification content (at `verify:post`). Each upload is scrubbed, and a re-run does not upload it again.
  4. At ship, a `daily-summary` for the configured agent and date is generated and recorded in the ledger along with the ship timestamp.
  5. A capture that fails at a step-only point (`execute:wave:pre`, `verify:post`, `ship:post`) is recorded as failed in the append-only ledger. The next gate refuses to pass until that capture is retried successfully. `gsd_run memanto ledger` shows pending, ok and failed operations and retries the failed ones.
**Plans**: TBD

### Phase 6: Memory Stays Current Over Time
**Goal**: Memory reflects how the project has changed. Superseded decisions are expired and can be restored. Recall shows what changed since the last ship. Policy effects are visible before they apply. The owner controls each feature, and the Memanto-wide jobs, explicitly.
**Mode:** mvp
**Depends on**: Phase 5
**Requirements**: LIFE-01, LIFE-02, LIFE-04, LIFE-05, LIFE-06, RECL-02, CMD-06, CMD-07, CONF-05
**Success Criteria** (what must be TRUE):
  1. When a later phase replaces a decision, the old memory is expired with reason `superseded-by-phase-NN` and drops out of default recall. An owner command brings a wrongly expired memory back.
  2. Recall at discuss and plan includes two temporal sections: what changed since the ledger's last ship timestamp (`--changed-since`), and what was true when a referenced phase was planned (`--as-of`).
  3. GSD decisions carry the `pinned` tag, so expiry presets never age them out. Doctor shows the agent's policy and presets. At ship, a policy `apply --dry-run` report lists what would expire without applying anything. A preset is applied only through an owner command that shows its effect and asks for confirmation.
  4. `gsd_run memanto schedule enable|disable|status` changes Memanto's nightly job only when the owner runs it, and states that the job is machine-global. `gsd_run memanto export` produces a memory export or OKF snapshot on demand or at milestone completion; export is off by default.
  5. Each of recall, temporal, answer, bootstrap, wave recall, uploads, daily summary and export can be turned off with a single boolean `memanto.*` key. The capability and its gates stay on.
**Plans**: TBD

### Phase 7: Coverage and Full-Cycle Proof
**Goal**: The capability is proven end to end against real Memanto, every Memanto feature has a recorded integrate or opt-out decision, and an owner can install and run the capability from the README alone.
**Mode:** mvp
**Depends on**: Phase 6
**Requirements**: COVR-01, COVR-02, CONF-06, TEST-03, TEST-04, TEST-05, TEST-06
**Success Criteria** (what must be TRUE):
  1. `COVERAGE.md` lists every Memanto CLI command and subcommand, REST route group and MCP tool as INTEGRATE (with its GSD mapping) or OPT-OUT (with a one-line reason). A conformance test fails when recursive `memanto --help` exposes a command that `COVERAGE.md` doesn't list.
  2. Fault-injection tests block with the expected message in every case: backend down, REST API down, CLI missing, wrong active agent, expired session, unknown agent id, MemPalace enabled, engines mismatch, consent removed and a seeded secret.
  3. With `MEMANTO_LIVE=1` and the agent taken only from the environment, the live suite exercises recall, capture, upload, conflicts and summary against the real servers. Changing backends (on-prem or cloud) needs only configuration, with no backend-specific code path.
  4. A full discuss → plan → execute → verify → ship cycle in a test project against the dev agent leaves the expected memories, uploads, summaries and ledger entries. A second run creates no duplicates.
  5. The README covers prerequisites (pre-running servers; `memanto-mcp` and `connect` as owner steps), install, configuration, the fail-open-when-not-loaded caveat and the break-glass.
**Plans**: TBD

## Research Flags

- Phase 1: the spike itself. It covers gate halting at `discuss:pre`/`ship:pre` (interactive and headless), `ref.command` dispatch of a third-party command family on 1.20.1, and global skill staging. If `ref.command` steps do not dispatch, later phases carry step logic through contributions and gates instead.
- Phase 2: exact REST argument shapes and the `agent activate`/`status`/`session info` exit codes, measured on a throwaway agent. Also the nonexistent-id behavior, and the CLI features REST lacks.
- Phase 3: MCP tool schemas and `agent_id` handling (`memanto-mcp` is not installed locally yet; installing it is an owner prerequisite), the `bootstrap` JSON shape, and where "resume work" can be hooked without a dispatch point.
- Phase 4: `ConflictResolveRequest.action` values, the on-prem embedding limit and HTTP 400 on busy days, the injection filter on legitimate GSD content, and scrubber patterns.
- Phase 5: upload dedupe/replace semantics.
- Phase 7: the live cycle and backend matrix need the owner's environment (real servers; cloud access for the non-on-prem leg).

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Walking Skeleton | 0/9 | Planned | - |
| 2. Verified Identity at Every Gate | 0/TBD | Not started | - |
| 3. Memory-Informed Discuss and Plan | 0/TBD | Not started | - |
| 4. Decisions Remembered, Conflicts Resolved | 0/TBD | Not started | - |
| 5. Execution, Verification and Ship Leave a Trail | 0/TBD | Not started | - |
| 6. Memory Stays Current Over Time | 0/TBD | Not started | - |
| 7. Coverage and Full-Cycle Proof | 0/TBD | Not started | - |
