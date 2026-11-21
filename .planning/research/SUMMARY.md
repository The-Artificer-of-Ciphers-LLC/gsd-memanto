# Project Research Summary

**Project:** gsd-memanto
**Domain:** Third-party, installable opengsd/gsd-core capability making Memanto (v0.3.0) the GSD project-memory provider
**Researched:** 2026-11-20
**Confidence:** MEDIUM-HIGH (HIGH on gsd-core manifest/loader contract; MEDIUM on Memanto runtime behavior and per-point dispatch; several items need a Phase 0 spike)

## Executive Summary

This is a thin, zero-dependency capability bundle on top of two fixed systems: gsd-core v1.20.1 (loader, consent, loop hooks, gate dispatcher) and Memanto v0.3.0 (CLI/MCP). Hard problems come from those constraints, not the memory logic.

Recommended approach: a deterministic core with a thin LLM shell. `lib/memanto-core.cjs` owns config resolution, preflight, agent pinning, `spawnSync` CLI calls, and an append-only ledger under `.planning/memanto/`. On top: blocking `command-exit-zero` gates (the only primitive that can stop a workflow), a synchronous `memanto` command family (CLI-only, headless-safe), and contribution fragments that tell the LLM to use Memanto MCP tools when present. Captures at non-gate points are made fail-closed by a ledger the next gate checks.

Key risks: steps are advisory, so "block always" holds only for gates, and only while the capability loads and has consent (a skipped capability fails open with one stderr line). The Memanto active agent is machine-global and CLI memory commands lack `--agent`, so projects can cross-write unless identity is verified. `detect-conflicts` is per agent and per day, not per phase topic. Skills and agents do not reach the runtime from project-scope installs. Each changes a PROJECT.md requirement; see "Conflicts with PROJECT.md" below.

## Key Findings

### Recommended Stack

Node CJS (`.cjs`, Node >=24), no runtime deps, `spawnSync` for the CLI, `node:test`. Zero deps because install is copy-only, symlinks abort staging, and consent hashes the whole bundle (16 MiB cap).

- capability.json v1: `version` 0.1.0, `tier: "full"`, `engines.gsd` `>=1.20.1 <2.0.0`, `runtimeCompat` `["claude"]` not `["*"]`.
- Command module `memanto.cjs` at bundle root (bare basename, synchronous; async routers rejected); `scripts/gate.cjs`; `lib/memanto-core.cjs`.
- `memanto` CLI pinned `>=0.3.0 <0.4.0`: headless transport and all non-MCP features. No JSON mode; use exit codes and narrow anchored parsing.
- `memanto-mcp` 0.1.5: interactive transport (7 default tools). Not installed locally. User installs it (`pipx inject`) and runs `memanto connect claude-code`; the capability never does.
- Tests: `node --test`; require gsd-core's `capability-validator.cjs` and `capability-loader.cjs` directly; fake `memanto` on temp PATH; opt-in live tests behind `MEMANTO_LIVE=1`.

Contract facts: `agents[]` never staged for third-party capabilities; `skills[]` not staged at project scope; `execute:pre` not dispatched through 1.22.0; `remember|recall|answer|upload|edit|forget|memory expire|restore` have no `--agent` flag (machine-global active agent).

### Expected Features

**Must have (table stakes):**
- Installable manifest that loads with zero `_overlay.warnings`, activates with consent, no gsd-core edits.
- Explicit `memanto.agent_id` default `""`; `memanto.enabled` as `activationKey`. `memanto-dev` never a default.
- Preflight gate (reachable, agent exists, session live, active == configured) at each memory point.
- Idempotent activation of the configured agent with identity re-verification (see D2).
- MemPalace mutual exclusion enforced by a gate (no manifest exclusivity field).
- Recall at `discuss:pre` and `plan:pre` into `MEMANTO-RECALL.md` (not `MEMORY-RECALL.md`), `recall --active` by default.
- Conflict detection and owner resolution at discuss, re-scoped to what `detect-conflicts` does (D4).
- Capture: decisions (`discuss:post`, `plan:post`); problem-to-fix pairs (`execute:wave:post`); uploads (PLAN, SUMMARY at `execute:post`; UAT at `verify:post`); daily summary (`ship:post`).
- `COVERAGE.md` matrix (INTEGRATE or OPT-OUT with reason), gsd-core `api_coverage_gate` format.
- Deterministic test suite with stubbed Memanto; one opt-in live run on a dedicated test agent.

**Should have (differentiators):** temporal recall (`--as-of`, `--changed-since` using a ledger ship timestamp); supersession via `memory expire --reason superseded-by-phase-NN`; provenance and confidence mapping on writes; RAG `answer` labeled as synthesized; owner commands for setup, status, recall, conflicts, policy (guarded), schedule (opt-in), export (default off).

**Defer:** `execute:wave:pre` pitfall recall; `memory export`/OKF; `agent bootstrap` persistence; `edit`-in-place refinement.

**Anti-features:** `login|logout|use|migrate|to-cloud` from the capability; automatic `memanto connect`; `memory sync` into CLAUDE.md/AGENTS.md; `--from-conversation` auto-extraction; automated `forget`, `policy purge`, `agent delete`, `schedule enable`; any default `agent_id` or `memanto-dev` outside tests/planning; dual-write or migration with MemPalace; uploading all of `.planning/`; skip-on-error semantics.

### Architecture Approach

Three layers over an unmodified gsd-core host loop: gate layer (blocking shell predicates), prompt layer (contribution fragments into orchestrator/planner/verifier), action layer (steps via `ref.skill` or `ref.command`). All converge on `lib/memanto-core.cjs`.

**Major components:**
1. `capability.json`: id `memanto`, config slice, gates, steps, contributions, one `memanto` command family. Validated by real loader.
2. `scripts/gate.cjs`: sole blocking authority. Exclusion check, config sanity, preflight, ledger completeness. Exit 0 pass; non-zero block with actionable message. Shell line resolves `.gsd/capabilities/memanto` then `$GSD_HOME/.gsd/capabilities/memanto`.
3. `memanto.cjs` command family: synchronous `preflight|activate|recall|detect-conflicts|upload|daily-summary|ledger|doctor`, invoked `gsd_run memanto <sub> --phase N --raw`.
4. Skills (`memanto-recall`, `memanto-capture-decisions`, `memanto-capture-fixes`, `memanto-conflicts`): not staged at project scope; recommended design uses contributions and `ref.command` instead.
5. Contributions (`fragments/*.md`): prefer `mcp__memanto__*` with explicit `agent_id`, else CLI; treat recall as data; halt on any non-ok tool result.
6. Ledger `.planning/memanto/ledger.jsonl`: append-only, local, never in Memanto. pending/ok/failed captures, memory ids, last-ship timestamp, backend fingerprint, detect-conflicts run guard.
7. Test harness: real `loadRegistry`, real `loop render-hooks`, gates against stub `memanto`, wired-kinds assertion.

**Patterns:** pin-verify-act under one lock; append-only ledger plus next-gate check; one `when` boolean per hook, master via `activationKey`; never `when` on a gate or on `memanto.agent_id`; `engines.gsd` floor `>=1.20.1`.

**Data flow:** Memanto to GSD at `discuss:pre`/`plan:pre` (read, untrusted). GSD to Memanto at `discuss:post`, `plan:post`, `execute:wave:post`, `execute:post`, `verify:post`, `ship:post`. Memanto writes only `MEMANTO-RECALL.md` and the ledger under `.planning/`.

**Wired kinds (gsd-core 1.22.0 `getWiredKinds`):** discuss:pre/post, plan:pre/post = contribution, gate, step; execute:wave:pre = contribution, step; execute:wave:post and execute:post = contribution, gate, step; verify:pre = contribution, gate, step; verify:post = step only; ship:pre = gate, step; ship:post = step only; execute:pre = nothing on 1.20.1. Undispatched kinds install cleanly and never run.

### Critical Pitfalls

1. **P-01 Block-always only via gates, only while loaded.** Steps advisory even with `onError: halt`; skipped capability fails open. Avoid: `blocking: true, onError: halt` `command-exit-zero` gates before and after writes; load-status smoke check; document as "gate-enforced, load-conditional."
2. **P-03 Loader traps skip the whole capability:** `consumes: VERIFICATION.md` (not a host artifact; host set is CONTEXT.md, PLAN.md, SUMMARY.md, UAT.md); `produces` collision on `MEMORY-RECALL.md`; `into` roles not published at a point; `when` on undeclared keys; reserved prefixes. Avoid: manifest lint plus temp-`GSD_HOME` loader test.
3. **P-06 Machine-global active agent:** cross-project writes undetectable by exit code; `MEMANTO_AGENT_AUTO_CREATE` may create an empty agent on typo. Avoid: explicit `agent_id` on every MCP call; verify-then-act under lock for CLI; canary asserting namespace; never `auto-activate on`.
4. **P-04 Project-scope consent per realpath and bundle hash:** worktrees, clones, CI, and in-place edits go inactive. Avoid: scope decision (D1); install script; never edit installed copy.
5. **P-11/P-14 Secrets and conflict semantics:** no upstream redaction; 10,000-char cap; `detect-conflicts` per day, global, may 400 on busy on-prem days, costs quota. Avoid: scrubber that blocks on hit; deterministic chunking; once per phase-day guard; filter to phase tags.

## Implications for Roadmap

Phase names are suggestions. Scope-changing items (D1 to D5) must be resolved before locking phases.

### Phase 0: Platform spike (blocks everything)
**Rationale:** project-scope skill staging, `ref.command` dispatch on 1.20.1, and gate blocking at `discuss:pre`/`ship:pre` are source-read but unexercised; they decide D1 and whether skills exist.
**Delivers:** minimal throwaway capability (one gate, one command, one contribution, optional one skill) installed in a temp project under project and global scope; outcomes recorded.
**Avoids:** P-02, P-04, P-01. Research flag: yes (this is the spike).

### Phase 1: Manifest, config, loader harness
**Rationale:** nothing verifiable until the manifest loads cleanly for the supported gsd range.
**Delivers:** `capability.json` with full `memanto.*` slice (`enabled` activationKey, `agent_id` `""`, per-hook toggles, `timeout_seconds`); zero-warning load; `render-hooks` conformance to wired-kinds table; manifest lint for P-03 traps. No Memanto calls.
**Avoids:** P-03, P-05, P-21, P-27. Standard pattern once D1 is settled.

### Phase 2: Memanto adapter core (`lib/memanto-core.cjs`)
**Rationale:** identity, session, and interface decisions; gates, commands, skills depend on it.
**Delivers:** config precedence; preflight state machine (reachable, agent exists, activate, verify active == configured); canary round-trip; namespace check; `--version` range check; token redaction; ledger I/O; backend fingerprint; short TTL preflight cache.
**Avoids:** P-06, P-07, P-08, P-16, P-19, P-20 (gate on effect, not port 8000). Research flag: yes (CLI-vs-REST decision D3; exact arg shapes via read-only commands).

### Phase 3: Gates and mutual exclusion
**Rationale:** delivers the core value (reliable blocking). Depends on 1 and 2.
**Delivers:** `scripts/gate.cjs` blocking gates at `discuss:pre`, `plan:pre`, `execute:wave:post` (ledger), `verify:pre`, `ship:pre` (completeness); MemPalace exclusion as first step of every gate, reading `mempalace.enabled` via `gsd_run config-get`; distinct actionable messages; documented break-glass.
**Avoids:** P-12, P-13, P-21. Research flag: yes (headless and autonomous gate behavior; `memanto` PATH under non-login shells; timeouts).

### Phase 4: Read path (recall, conflicts)
**Rationale:** first visible value; conflicts need a day-scoped detection pass, so sequenced after basic recall.
**Delivers:** discuss contribution and `plan:pre` step producing `MEMANTO-RECALL.md` with `--active`, bounded limit, labeled untrusted output; `--as-of`, `--changed-since`; `answer` labeled; conflict flow (detect once per phase-day, `conflicts --list`, owner resolution in discuss, apply via `memory expire` or REST resolve); on-prem context-limit message.
**Avoids:** P-14, P-15, P-24, P-11. Research flag: yes for conflicts (resolve action values, REST path needs `serve`, D4).

### Phase 5: Write path
**Rationale:** depends on identity and gates; deferred captures checked by next gate.
**Delivers:** decisions at `discuss:post` and `plan:post` (tags, provenance, confidence explicit); problem-to-fix at `execute:wave:post` (`error`, `learning`, batched per wave); uploads PLAN/SUMMARY at `execute:post` and UAT at `verify:post` from scrubbed temp copy with deterministic filename; `daily-summary` at `ship:post` with explicit `--agent`; ledger pending/ok/failed; completeness gate at `ship:pre`; scrubber blocking on hit; `remember --batch`; schedule only via explicit owner command.
**Avoids:** P-10, P-11, P-17, P-18, P-19. Research flag: yes (upload dedupe/replace; prompt-injection filter on writes).

### Phase 6: COVERAGE.md and inventory conformance
**Rationale:** attests to what landed; finalized after Phase 5; enumeration can start after Phase 0.
**Delivers:** COVERAGE.md in `api-coverage` format covering about 40 CLI commands, REST route groups, and 7 default plus 4 admin MCP tools; diff test failing on any unlisted `memanto --help` command.
**Avoids:** P-22. Standard pattern.

### Phase 7: End-to-end, fault injection, packaging, docs
**Delivers:** full discuss-to-ship cycle on a dedicated test agent (unique name, cleaned in `finally`, never `memanto-dev` for destructive tests); fault injection (backend offline, binary missing or off PATH, wrong active agent, expired session, MemPalace enabled, engines mismatch, consent removed, seeded secret); double-run idempotency; minimal published bundle (`files` whitelist, sha512 pin); README with verify-active steps and fail-open caveat.
**Avoids:** P-01, P-10, P-11, P-23, P-26. Research flag: yes for live cycle (owner or gated environment).

### Phase Ordering Rationale

Phase 0 first (changes bundle layout); 1 to 3 build the enforcement spine before memory behavior; 2 before 3 (preflight is the adapter); read (4) before write (5) so conflicts exist before writes create them; COVERAGE last.

### Research Flags

Needs spike or research: Phase 0, 2, 3, 4, 5, 7. Standard: Phase 1 (after D1), Phase 6.

## Conflicts with PROJECT.md / owner decisions needed

The four researchers converged on the items below. Each narrows or contradicts PROJECT.md. Recommendation given for each.

- **D1 Install scope.** PROJECT.md says install into a project's `.gsd/capabilities/memanto`. Project scope cannot stage skills or agents; consent is bound to realpath and bundle hash (worktrees and clones go inactive); ARCHITECTURE flags possible dead-on-arrival when declared skills are absent. Recommendation: global install (`$GSD_HOME/.gsd/capabilities/memanto`) with per-project enablement via `memanto.enabled` and `memanto.agent_id`. Project scope only after Phase 0 proves activation.
- **D2 Auto-activation.** PROJECT.md says auto-activate via `agent activate` or `auto-activate` so expiry is invisible. Both are machine-global; `auto-activate on` resumes the last agent (leak path). Recommendation: verify-then-act. Re-activate only the configured agent at preflight, under lock, re-verify identity; never set `auto-activate`; `doctor` reports and recommends. Note: FEATURES treats `auto-activate on` as an owner-set option at setup; ARCHITECTURE and PITFALLS reject it. The owner may accept it as an explicit documented global choice.
- **D3 CLI vs REST for headless writes.** STACK and ARCHITECTURE keep CLI with pin and lock; PITFALLS and STACK note REST (`/api/v2/agents/{id}/...`, per-request agent, JSON) is the only race-free parseable option, but needs `memanto serve`, which the capability must not start. Recommendation: CLI as owner-mandated fallback behind one adapter seam; decide in Phase 2 after the spike.
- **D4 Conflict semantics.** PROJECT.md says detect-conflicts "runs for the phase topic." It accepts only `--date` and `--agent`, runs over the day's session memories, writes machine-global `~/.memanto/conflicts/`. `conflicts` needs a TTY; headless resolution needs REST and `serve`. Recommendation: re-scope to "detect for current agent and date after capture, at most once per phase-day, read with `conflicts --list`, filter to phase tags, resolve with owner in discuss." Headless runs record "unresolved" in CONTEXT.md and do not block unless the owner opts in.
- **D5 Block-always.** Only gates block; enforcement holds only while loaded and consented; late blocks at `ship:pre` can strand finished work; no break-glass without design. Recommendation: keep block-always as default; state the load-conditional limit; add doctor check for enabled-but-not-rendering; `memanto.enabled=false` as the one audited break-glass. PITFALLS also proposes tiers (Tier 1 always blocks, Tier 2 enrichments opt-in) and an outbox for captures. This is a genuine owner trade-off the research does not resolve.
- **D6 MCP registration and `connect`.** The capability cannot register the MCP server (`mcpServers` and `hooks[]` need shared-file edits and widen consent). `connect claude-code` writes CLAUDE.md, hooks, and permissions, duplicating GSD injection. Recommendation: user prerequisite (`pipx inject memanto memanto-mcp==0.1.5`; owner runs `connect claude-code`); capability never runs `connect`; COVERAGE OPT-OUT; doctor warns on Memanto SessionStart hook or CLAUDE.md block.
- **D7 MCP coverage is narrow.** Only 7 default tools (`remember`, `batch_remember`, `recall`, `recall_recent`, `recall_as_of`, `recall_changed_since`, `answer`). Upload, conflicts, daily-summary, expiry, policy, schedule are CLI or REST in every mode. Recommendation: state in PROJECT.md: "MCP for the seven memory tools, CLI for everything else in both modes."
- **D8 Points.** FEATURES proposes an `execute:pre` preflight, but `execute:pre` is not dispatched on 1.20.1. Recommendation: do not wire `execute:pre`; pre-execution check at `plan:post` (gate) and `execute:wave:pre` (contribution).
- **D9 Uploads.** PROJECT.md requires PLAN, SUMMARY, VERIFICATION. VERIFICATION.md is not a host artifact; `consumes` of it skips the capability (P-03). Recommendation: `consumes: ["UAT.md"]` at `verify:post`, with VERIFICATION content in a deterministic temp copy. Owner confirms default-on uploads given secrets risk (P-11) and duplicate cost (P-10).
- **D10 Curator agent.** MemPalace's `gsd-mempalace-curator` cannot be reproduced (third-party `agents[]` never staged); FEATURES proposed `gsd-memanto-curator`. Recommendation: no curator agent; `daily-summary` as a `ship:post` step; logic in the command family.
- **D11 Name collisions.** `MEMORY-RECALL.md` collides with MemPalace at `plan:pre`. Recommendation: `MEMANTO-RECALL.md` (all four agree). Avoid `execute:pre` (D8).
- **D12 Owner-only actions.** The capability must never run `memanto login|logout|use`, `connect`, `agent delete`, `forget`, `policy apply|purge` (beyond guarded owner commands), `schedule enable`, or `auto-activate on`. Owner confirms `agent create` runs only from an explicit setup command with a new id.

**Where researchers disagree (not resolved):**
- Gate breadth: STACK gates before every `:pre`; ARCHITECTURE selective plus `plan:post` ledger; PITFALLS before and after each memory point. Baseline: ARCHITECTURE placement, plus `plan:post` and `execute:post` gates if captures run there.
- Project-scope skills: STACK says not staged, recommends `skills: []`; ARCHITECTURE treats as open spike. Design assumes no skills until Phase 0.
- Exclusion check: ARCHITECTURE reads nested `config.json`; PITFALLS uses `gsd_run config-get`. Recommend the latter.
- memanto-mcp minimum: STACK and FEATURES say `memanto>=0.2.31`; PITFALLS says `>=0.2.13`. Confirm from package metadata in Phase 2.
- Session key: `--hours` (verified in `--help`) vs upstream docs `--duration-hours`. Use `--help`.
- Prompt-injection filter on writes may reject legitimate GSD content (FEATURES only). Phase 5 must define behavior.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH (manifest), MEDIUM (Memanto) | Manifest verified against installed gsd-core 1.20.1 source and scratch install; CLI from `--help` and read-only status; MCP names from upstream README, package not installed locally |
| Features | HIGH (CLI, loader), MEDIUM-LOW (MCP, REST) | CLI verified per command; REST from installed source (OpenAPI 404); MCP parameter schemas unpublished |
| Architecture | MEDIUM-HIGH | Loader, resolver, validator, gate mechanics from source; per-point dispatch matches workflow text, not exercised end to end |
| Pitfalls | MEDIUM-HIGH | gsd-core HIGH from source and ADR; Memanto MEDIUM (dated docs, drift; closed issues do not prove 0.3.0 fixes) |

**Overall confidence:** MEDIUM-HIGH. Enforcement model well supported. Memory behavior (identity race, conflict semantics, upload dedupe, MCP params) needs validation before committing.

### Gaps to Address

- Project-scope skill and command activation: Phase 0; decides D1.
- `ref.command` dispatch and third-party command family on 1.20.1: Phase 0.
- Gate blocking in headless and autonomous runs (`[VERIFY]` per point): Phase 3.
- Exact `agent activate`, `status`, `session info` output and exit codes (not measured): Phase 2 on a throwaway agent.
- Nonexistent-id activation exit code (inferred): Phase 2.
- MCP tool schemas and `agent_id` behavior (`tools/list`): Phase 2 or spike.
- Upload dedupe/replace; `bootstrap` JSON schema (undocumented): Phase 5.
- `ConflictResolveRequest.action` values (partial): Phase 4.
- On-prem 2048-token embedding limit and HTTP 400 on busy days (upstream closed): verify in Phase 4.
- Backend differences (cloud, on-prem, local) untested: Phase 7 matrix.
- Prompt-injection filter on writes: Phase 5.
- Cloud free-tier quota (100K ops per month per upstream README): Phase 2 cache design.
- Secret scrubber patterns: none upstream; design and test in Phase 5.

## Sources

### Primary (HIGH confidence)
- gsd-core v1.20.1 installed source (`~/.claude/gsd-core/bin/lib/capability-loader.cjs`, `capability-validator.cjs`, `capability-source.cjs`, `capability-lifecycle.cjs`, `capability-consent.cjs`, `capability-command-router.cjs`, `capability-activation.cjs`, `capability-state.cjs`, `capability-registry.cjs`, `loop-resolver.cjs`, `gate-predicate-evaluator.cjs`, `gate-predicate.cjs`, `install-profiles.cjs`, `loop-host-contract.cjs`, `bin/gsd-tools.cjs`, `references/loop-hook-dispatch.md`, installed workflows)
- gsd-core 1.22.0 checkout (`docs/reference/capability-manifest.md`, `docs/how-to/develop-a-capability.md`, `docs/how-to/command-exit-zero-gate.md`, `docs/explanation/capability-trust-model.md`, `docs/adr/2008-command-exit-zero-gate.md`, `docs/adr/2363-capability-instruction-surface-trust.md`, `scripts/gen-loop-host-contract.cjs`, `CHANGELOG.md`)
- Memanto v0.3.0 `--help`, read-only `status`, `agent list`, `/health`, installed package source; PyPI JSON for `memanto` and `memanto-mcp`

### Secondary (MEDIUM confidence)
- Memanto upstream repo (`integrations/mcp/README.md`, `pyproject.toml`, `memanto_mcp/tools.py`, `lifecycle.py`, `docs/CLI_USER_GUIDE.md`, `docs/SESSION_ARCHITECTURE.md`); issues #884, #1329, #1340, #1418, #1438, #1453, #1478, #1910, #1940, #2106, #2120 (states may have changed); `pipx inject` path (not executed)

### Tertiary (LOW confidence)
- Glama listing with `memanto_`-prefixed names (not official, excluded)
- `MEMANTO_*` per-process agent selection (unverified; would remove the race if it exists)

---
*Research completed: 2026-11-20*
*Ready for roadmap: yes, after owner decisions D1 to D12 are resolved (D1 to D5 block phase scope).*
