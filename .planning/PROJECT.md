# gsd-memanto

## What This Is

An installable, third-party opengsd/gsd-core capability that fully supports and uses Memanto (https://memanto.ai, repo https://github.com/moorcheh-ai/memanto) as the GSD project-memory provider. Every Memanto feature is mapped to what gsd-core can support as a capability: hook points, steps, contributions, gates, config keys, skills, agents and commands. It is delivered only through the capability definition and is installed into a project's `.gsd/capabilities/memanto`. It is for GSD users who want Memanto-backed memory across the discuss → plan → execute → verify → ship lifecycle.

## Core Value

When the capability is enabled, every GSD lifecycle stage reliably reads from and writes to the project's configured Memanto agent, without any modification to gsd-core.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Capability is a third-party package installable into `.gsd/capabilities/memanto` via gsd-core's overlay and consent flow, with zero edits to gsd-core
- [ ] Every usable capability hook point (`discuss:pre/post`, `plan:pre/post`, `execute:wave:post`, `execute:post`, `verify:pre/post`, `ship:pre/post`, plus any further points the loader accepts) is wired where Memanto adds value, declared only in the capability definition
- [ ] A `COVERAGE.md` matrix lists every Memanto feature (CLI commands, REST endpoints, MCP tools) as INTEGRATE (with its GSD mapping) or OPT-OUT (with a reason); no feature is left undecided
- [ ] Memanto agent/namespace is explicitly configured and identified per project (config key); there is no implicit default
- [ ] Interactive runs use Memanto MCP tools; headless/cron runs fall back to the `memanto` CLI
- [ ] Capability auto-activates the configured Memanto agent session (`agent activate` / `auto-activate`) before memory calls so session expiry is invisible
- [ ] When enabled and expected, any Memanto failure (unreachable, misconfigured, no agent, failed activation) blocks the workflow with a clear error
- [ ] Capability is mutually exclusive with the first-party MemPalace capability; enabling one while the other is active is refused (enforced by the capability itself, since the manifest schema has no exclusivity field)
- [ ] Recall: prior memories (with temporal query and RAG `answer`) are surfaced into discuss and plan context
- [ ] Conflicts: `detect-conflicts` runs for the phase topic and conflicts are resolved with the owner during discuss-phase
- [ ] Capture: key decisions (PROJECT/CONTEXT/plan rationale) are remembered
- [ ] Capture: confirmed problem → fix pairs from execution/verification waves are remembered
- [ ] Capture: phase artifacts (PLAN, SUMMARY, VERIFICATION) are uploaded via `memanto upload`
- [ ] Capture: session summaries via `daily-summary`, with `schedule` support
- [ ] Backend-agnostic: works with whatever backend `memanto use` selected (cloud, on-prem, local); never configures the backend itself
- [ ] Automated tests validate the manifest against gsd-core's capability loader schema and exercise each hook against live and/or stubbed Memanto
- [ ] A full GSD cycle in a test project against the dev agent leaves the expected memories, uploads and summaries in Memanto

### Out of Scope

- Modifying opengsd/gsd-core in any way — the capability must work purely as an installable overlay
- First-party/upstream inclusion in gsd-core — owner chose third-party package distribution
- MemPalace → Memanto migration — owner ruled it out; switching providers starts fresh
- Coexisting with MemPalace — the two memory providers are mutually exclusive
- Configuring Memanto backends (`login`, `logout`, `use`) from the capability — backend choice belongs to the Memanto install
- Carrying the `memanto-dev` agent name into shipped defaults — it is the development name only

## Context

- gsd-core v1.20.1 is installed at `~/.claude/gsd-core`. Its capability registry (`bin/lib/capability-registry.cjs`, generated) defines `feature`, `reviewer` and `runtime` roles. The installed-overlay loader (`bin/lib/capability-loader.cjs`, `capability-lifecycle.cjs`, `capability-consent.cjs`, `capability-command-router.cjs`) supports third-party capabilities under `.gsd/capabilities/<id>`, gated by user consent.
- The first-party `mempalace` capability is the closest analog: config keys (`enabled`, `memory_mode`, `recall_on_discuss`, `capture_artifacts`, …), skills (`mempalace-recall`, `mempalace-capture`), an agent (`gsd-mempalace-curator` at `ship:post`), and inline contribution fragments injected into the discuss/execute prompts.
- gsd-core's `workflow.api_coverage_gate` already defines a COVERAGE.md "full coverage by default, opt out with reason" matrix format — reuse it for the Memanto feature map.
- Memanto v0.3.0 is installed (`~/.local/bin/memanto`) with config at `~/.memanto`. Its namespaces are per-agent (`memanto_agent_<id>`); the backend is currently moorcheh-on-prem; the local REST API runs at `http://localhost:8000`. Its CLI surface: login, logout, use, status, serve, ui, remember, edit, forget, upload, recall (temporal), answer (RAG), daily-summary, detect-conflicts, conflicts, widget, agent (create/list/activate/deactivate/auto-activate/delete/bootstrap), session, config, schedule, memory, policy (expiry), connect (MCP/tool integration), migrate.
- Development uses a Memanto agent named `memanto-dev`, a dev-only name.

## Constraints

- **Distribution**: third-party installable capability only — every hook, step, contribution, gate, config key, skill, agent and command lives in the capability definition
- **No gsd-core changes**: integration uses only what gsd-core's capability surface already supports
- **Namespace**: the Memanto agent id must be explicitly configured per project; `memanto-dev` is development-only and must not ship as a default
- **Failure semantics**: when enabled and expected, Memanto failures block (fail closed), unlike MemPalace's skip-on-error
- **Interface**: MCP when interactive, CLI fallback when headless
- **Compatibility**: must declare and satisfy gsd-core `engines.gsd` range; backend-agnostic across Memanto backends

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Third-party package, not first-party | Owner wants an installable capability with no gsd-core changes | — Pending |
| Mutually exclusive with MemPalace | One memory provider per project avoids split memory | — Pending |
| Explicit agent namespace, no default | `memanto-dev` is dev-only; projects must be identified deliberately | — Pending |
| Coverage matrix with reasoned opt-outs | Every Memanto feature is decided; matches gsd-core api_coverage convention | — Pending |
| MCP + CLI fallback | Mirrors MemPalace interactive/headless split | — Pending |
| Block always on failure when enabled | Owner expects memory to be authoritative once enabled | — Pending |
| Auto-activate agent sessions | Session expiry should not interrupt workflows | — Pending |
| Conflicts resolved at discuss | Resolve contradictory memory before planning consumes it | — Pending |
| No MemPalace migration | Owner ruled it out of scope | — Pending |

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
*Last updated: 2026-11-20 after initialization*
