# gsd-memanto

## What This Is

An installable, third-party opengsd/gsd-core capability that fully supports and uses Memanto (https://memanto.ai, repo https://github.com/moorcheh-ai/memanto) as the GSD project-memory provider. Every Memanto feature is mapped to what gsd-core can support as a capability: gates, steps, contributions, config keys, a command family, and (where staging allows) skills. Nothing is added outside the capability definition. It is installed once globally (`$GSD_HOME/.gsd/capabilities/memanto`) and enabled per project. It is for GSD users who want Memanto-backed memory across the discuss → plan → execute → verify → ship lifecycle.

## Core Value

When the capability is enabled, every GSD lifecycle stage reliably reads from and writes to the project's explicitly configured Memanto agent. Any failure blocks the workflow, and gsd-core is never modified.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Third-party capability bundle (`capability.json` + command module + scripts + fragments) installs globally through gsd-core's overlay/consent flow, loads with zero overlay warnings, and requires zero edits to gsd-core
- [ ] Per-project enablement via `memanto.enabled` (activationKey) and an explicit `memanto.agent_id` (default `""`, no implicit agent; `memanto-dev` is the dev-only name and never ships as a default)
- [ ] Config identifies the pre-running endpoints: the Memanto backend (on-prem host:port, e.g. `plex2.nomorestars.com:8080`, or cloud) and the Memanto REST API URL (e.g. `localhost:8000`); the capability never starts, stops or configures either server
- [ ] Preflight checks both endpoints' `/health`, the agent's existence, a live session, and a canary round-trip; any failure blocks
- [ ] Writes and reads go through Memanto REST with the agent named explicitly on every request; CLI only for features REST lacks (pin-verify-act under a lock); MCP tools (explicit `agent_id`) in interactive prompts where they apply
- [ ] Session handling is verify-then-act: re-activate only the configured agent and re-verify its identity; never enable machine-global `auto-activate`
- [ ] Blocking gates (`command-exit-zero`, `blocking: true`, `onError: halt`) at every gate-capable point; operations at step-only points (`verify:post`, `ship:post`) record pending/ok/failed in an append-only ledger and the next gate refuses to pass until failures are retried; `memanto.enabled=false` is the single documented break-glass
- [ ] Mutual exclusion with MemPalace: every gate refuses to pass while `mempalace.enabled` is true
- [ ] Recall at `discuss:pre` and `plan:pre` into `MEMANTO-RECALL.md` (active memories, bounded, labeled untrusted), including temporal queries and RAG `answer`
- [ ] Conflicts: `detect-conflicts` at most once per phase-day for the configured agent, results filtered to the phase's tags, resolved with the owner during discuss (applied via REST resolve); headless runs record conflicts as unresolved and don't block
- [ ] Capture key decisions (discuss/plan) with tags, provenance and confidence
- [ ] Capture confirmed problem → fix pairs per execution wave
- [ ] Upload phase artifacts (PLAN, SUMMARY, UAT/verification content) by default, through a secret scrubber that blocks on a hit, with deterministic names and ledger dedupe
- [ ] Session summaries via `daily-summary` at ship; `schedule` only through an explicit owner command
- [ ] Owner commands (`gsd_run memanto …`): doctor/status, setup (may create a new agent with an owner-named id only on explicit request), recall, conflicts, ledger, and the other Memanto features the coverage matrix integrates
- [ ] `COVERAGE.md` lists every Memanto feature (CLI commands, REST routes, MCP tools) as INTEGRATE (with its GSD mapping) or OPT-OUT (with a reason), and a test fails on any unlisted CLI command
- [ ] Automated tests: manifest validated through gsd-core's real loader on a temp `GSD_HOME`, gates and commands against a stubbed Memanto, fault injection, and an opt-in live suite
- [ ] A full discuss → plan → execute → verify → ship cycle in a test project against the dev agent leaves the expected memories, uploads, summaries and ledger entries

### Out of Scope

- Modifying opengsd/gsd-core in any way — the capability must work purely as an installable overlay
- First-party/upstream inclusion in gsd-core — owner chose third-party package distribution
- Project-scope install as the primary path — skills aren't staged there and consent breaks on worktrees, clones and edits; global install plus a per-project flag instead
- MemPalace → Memanto migration — owner ruled it out; switching providers starts fresh
- Coexisting with MemPalace — the two memory providers are mutually exclusive
- Starting/stopping/configuring Memanto servers or backends (`serve`, `ui`, `login`, `logout`, `use`) — servers must be pre-running and pre-configured
- Running `memanto connect`, `memory sync`, or installing `memanto-mcp` — owner prerequisite; these edit user/instruction files
- Machine-global `agent auto-activate` — it reopens the last-used agent and can mix up memory across projects
- Curator agent — third-party `agents[]` are never staged; the logic lives in the command family
- Automated destructive ops (`forget`, `policy purge`, `agent delete`, `schedule enable`) from hooks — owner-only
- Wiring `execute:pre` — not dispatched on gsd-core 1.20.1
- Carrying the `memanto-dev` agent name into shipped defaults — it is the development name only

## Context

- gsd-core v1.20.1 is installed at `~/.claude/gsd-core`. Third-party capabilities are `capability.json` bundles validated by `capability-validator.cjs` and loaded by `capability-loader.cjs`. Only gates block (`gate-predicate-evaluator.cjs`, `command-exit-zero`); steps are advisory. A capability that fails to load or has no consent is skipped with only a stderr warning (fail-open; document this, and make `doctor` detect it). Third-party `agents[]` are never staged, and `skills[]` are staged only from the global root.
- Which kinds each point dispatches: discuss/plan pre+post, `execute:wave:post`, `execute:post` and `verify:pre` accept contribution, gate and step; `execute:wave:pre` accepts contribution and step; `ship:pre` accepts gate and step; `verify:post` and `ship:post` accept step only. Undispatched kinds install cleanly and never run.
- Host artifacts are CONTEXT.md, PLAN.md, SUMMARY.md and UAT.md. `MEMORY-RECALL.md` belongs to MemPalace, so a collision drops the capability; use `MEMANTO-RECALL.md`.
- First-party `mempalace` is the closest analog for config and lifecycle shape.
- Memanto v0.3.0 CLI at `~/.local/bin/memanto`, config at `~/.memanto`. The backend is moorcheh-on-prem at `http://plex2.nomorestars.com:8080` (`/health` OK, local embedding + LLM). The Memanto REST API is at `http://localhost:8000` (`/health` OK; routes `/api/v2/agents/{id}/...`; `X-Session-Token` JWT). The CLI has no `--json`, and its memory commands have no `--agent` flag (they use the machine-global active agent). `memanto-mcp` 0.1.5 exposes 7 memory tools and isn't installed locally yet. Memanto rejects writes that look like prompt injection and caps content at 10,000 chars.
- Research: `.planning/research/` (STACK, FEATURES, ARCHITECTURE, PITFALLS, SUMMARY).
- Development uses a Memanto agent named `memanto-dev`, a dev-only name. The machine's currently active agent is a test agent (`clitest3`).

## Constraints

- **Distribution**: third-party capability, installed globally, enabled per project — every gate, step, contribution, config key, command and skill lives in the capability definition
- **No gsd-core changes**: only the capability surface gsd-core 1.20.1 already supports; `engines.gsd >=1.20.1 <2.0.0`
- **Runtime**: Node CJS with zero runtime dependencies (install is copy-only, symlinks are rejected, the bundle is hash-bound); synchronous command router; runtime state outside the bundle
- **Namespace**: the Memanto agent id must be explicitly configured per project
- **Servers**: Memanto backend and REST API must be pre-running, pre-configured and healthy; the capability only connects
- **Failure semantics**: fail closed — all memory operations block (directly via gates, or via the ledger at the next gate)
- **Interface**: REST with an explicit agent per request; CLI only where REST lacks the feature; MCP in interactive prompts
- **Compatibility**: works with any Memanto backend (on-prem or cloud)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Third-party package, not first-party | Owner wants an installable capability with no gsd-core changes | — Pending |
| Global install + per-project enable | Project scope can't stage skills, and its consent breaks on worktrees/clones | — Pending |
| Mutually exclusive with MemPalace | One memory provider per project avoids split memory | — Pending |
| Explicit agent namespace, no default | `memanto-dev` is dev-only; projects must be identified deliberately | — Pending |
| Coverage matrix with reasoned opt-outs | Every Memanto feature is decided; matches gsd-core api_coverage convention | — Pending |
| REST API (pre-running) as primary transport | Names the agent on every request (no machine-global race), returns JSON | — Pending |
| Servers pre-running; capability only connects | Owner configures backend (on-prem/cloud) and REST beforehand; health must respond | — Pending |
| Block always; ledger for step-only points | Memory is authoritative once enabled; only gates can block | — Pending |
| Verify-then-act sessions, no auto-activate | auto-activate is machine-global and reopens the last-used agent | — Pending |
| Conflicts day-scoped, filtered, owner-resolved at discuss | detect-conflicts can't narrow to a topic; headless runs record without blocking | — Pending |
| Uploads on, scrubbed, deduped | Owner wants artifacts in memory; prevent secret leaks and duplicates | — Pending |
| MCP setup is owner prerequisite | `connect` edits CLAUDE.md, hooks and permissions | — Pending |
| Agent creation only via explicit setup | `agent create` switches the machine's active agent | — Pending |
| No MemPalace migration | Owner ruled it out of scope | — Pending |
| `MEMANTO-RECALL.md`; avoid `execute:pre` | Avoid MemPalace artifact collision and the undispatched point | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-11-20 after research decisions*
