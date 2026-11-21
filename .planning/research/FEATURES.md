# Feature Research

**Domain:** Third-party gsd-core capability integrating Memanto as the GSD project-memory provider
**Researched:** 2026-11-20
**Confidence:** HIGH for CLI surface (every command verified from `--help` on installed v0.3.0) and gsd-core loader schema (read from `capability-validator.cjs` / `loop-host-contract.cjs` v1.20.1). MEDIUM for REST (read from installed package source; the local server publishes no `/openapi.json` or `/docs`, both return 404). MEDIUM-LOW for MCP (`memanto-mcp` is not installed locally; tool names come from the official integration README, parameter schemas are NOT published).

## Verification Notes (read first)

1. **MCP surface is tiny.** The official `memanto-mcp` exposes 7 tools by default: `remember`, `batch_remember` (max 100), `recall`, `recall_recent`, `recall_as_of`, `recall_changed_since`, `answer`. Four admin tools (`create_agent`, `list_agents`, `get_agent`, `delete_agent`) appear only with `MEMANTO_EXPOSE_ADMIN=true`. There is NO MCP tool for edit, forget, upload, expire/restore, policy, daily-summary, conflicts, bootstrap, status or export. So "MCP interactive / CLI headless" only holds for the 7 core tools. Everything else is CLI-only (or REST) in every mode.
2. **CLI `remember`, `recall`, `answer`, `upload`, `edit`, `forget` have NO `--agent` flag.** They act on the machine-global *active agent*. Only `daily-summary`, `detect-conflicts`, `conflicts`, `agent bootstrap`, `policy *`, `memory export`, `memory sync` and `migrate *` take `--agent`/`-a`. MCP calls accept an optional per-call `agent_id`. Two projects on one machine with different agents race on the global active agent. The capability must `agent activate <configured-id>` and verify (`session info`) immediately before each CLI memory batch, and fail closed on mismatch.
3. **`detect-conflicts` is date-scoped, not topic-scoped.** Flags are only `--date` and `--agent`. It runs an LLM pass over *that day's session memories* and writes JSON to `~/.memanto/conflicts/`. PROJECT.md says "runs for the phase topic". That cannot be met literally. See the conflicts mapping below.
4. **`memanto conflicts` is interactive (TTY).** Non-interactive resolution is REST `POST /api/v2/agents/{id}/conflicts/resolve` with action `keep_old | keep_new | keep_both | remove_both | manual` (+`manual_content`). `--list` is the non-interactive read. The REST path needs `memanto serve` running (research flag).
5. **gsd-core `onError` is `skip | halt`.** `halt` on a step, contribution or gate is the "block always" lever. BUT a capability that fails to *load* (validation failure, `engines.gsd` mismatch) fails OPEN with a stderr warning (#2009 comment in `loop-resolver.cjs`). Block-always cannot cover the capability failing to load. Surface this as a documented limitation.
6. **`agentVerdict` gates are forced `blocking:false`.** A blocking gate must be `query` or `predicate`. How an overlay-supplied `query`/`predicate` is evaluated at runtime was not found in `loop-resolver.cjs`. Treat gate-based blocking as a research flag. Fallback is a `halt` step running a preflight skill.
7. **Memanto write path rejects prompt-injection-shaped text** (`INJECTION_PATTERNS` in `app/constants.py`, e.g. "ignore previous instructions", "system override"). GSD artifacts that quote such strings (security research, test fixtures) can fail to store. That would block the workflow under fail-closed semantics.

## gsd-core Surface Available to the Capability (from loader/validator, v1.20.1)

| Surface | What the loader accepts |
|---------|-------------------------|
| Loop points (12) | `discuss:pre/post`, `plan:pre/post`, `execute:pre`, `execute:wave:pre`, `execute:wave:post`, `execute:post`, `verify:pre/post`, `ship:pre/post`. PROJECT.md lists 10; `execute:pre` and `execute:wave:pre` are the extra two |
| Step | `{point, ref:{skill XOR agent XOR command}, produces[], consumes[], when, onError: skip\|halt, fragment?}`. Skill stems must NOT start with `gsd-`; skills/agents must be declared in the capability's own lists |
| Contribution | `{point, into:<role>, fragment:{path\|inline}, produces, consumes, when, onError}`. `into` must be in the step's roles: discuss/verify/ship=`orchestrator`; plan=`researcher,planner,checker`; execute=`executor,verifier,code-reviewer` |
| Gate | `{point, check:{query XOR predicate XOR agentVerdict}, when, blocking:bool, onError}` |
| Config | slice per key `{type: boolean\|string\|number\|enum, default, description}`; `activationKey` names the master toggle; `when` on steps/gates must reference a declared key |
| Commands | `commands[]: {family, module:<bare>.cjs, router, subcommands?}`. Executable, only dispatched after user consent |
| Hooks | `hooks[]: {event, script, matcher?}` (runtime hook scripts). Consent-bound executable surface |
| Other | `requires[]` (capability ids, dependency only, no exclusivity), `engines.gsd`, `tier`, `runtimeCompat`. Reserved id prefixes `gsd-`, `gsd-core-`, `anthropic-` are rejected |
| MemPalace analog | skills `mempalace-recall`/`mempalace-capture`, agent `gsd-mempalace-curator` (ship:post), inline contributions at `discuss:pre` (recall) and `execute:wave:post` (capture), 8 config keys, steps at `discuss:post`, `plan:pre` (produces `MEMORY-RECALL.md`), `plan:post`, `verify:post`, `ship:post`. All `onError: skip` |

Capability id must not collide with `mempalace`. Skill stems (e.g. `memanto-recall`) must not carry a `gsd-` prefix (the workflow prepends it).

## Full Inventory: Memanto Feature to GSD Mapping

Legend: **I** = INTEGRATE, **O** = OPT-OUT candidate. Complexity: L/M/H = low/medium/high (build + test effort for the capability).

### A. Data plane: write

| Memanto feature | Interface | Proposed GSD mapping | I/O | Cx | Notes |
|-----------------|-----------|----------------------|-----|----|-------|
| `remember "<content>"` with `--type/-t` (13 types), `--title`, `--confidence/-c` (0-1, default 0.8), `--tags` (CSV), `--source/-s`, `--provenance/-p` | CLI; MCP `remember` | Skill `memanto-capture`. `discuss:post` and `plan:post` store `decision`; `execute:wave:post` stores `error`+`learning`; `verify:post` stores outcomes with `provenance=validated`. All tagged `gsd,<project>,phase-NN,<kind>` | **I** | M | Content max 10 000 chars, title max 100. Default `source` auto-detects the calling tool, so set `gsd` explicitly. MCP parameter schema unpublished, so the CLI is the verified path |
| `remember --batch memories.json` | CLI; MCP `batch_remember` (<=100) | One-shot capture at `execute:post` and `ship:post` for many learnings | **I** | L | Cuts per-call activation overhead and the active-agent race window |
| `remember --from-conversation <json\|->` with `--dry-run`, `--max-memories` (20), `--ai-model` | CLI; REST `POST .../remember/extract` | None by default | **O** | H | LLM extraction from raw transcript is noisy; owner decided capture is explicit (decisions, problem-fix, artifacts, summaries). May be a later opt-in |
| `edit <id>` with `--title/--content/--type/--confidence/--tags/--source` | CLI; REST `PATCH .../memories/{id}` | Used when a decision is refined within a phase (correct in place instead of duplicating) | **I** (internal) | L | Needs the memory id from the earlier `remember`. Store ids in a capability-local ledger. No MCP tool |
| `forget <id>` (`--force`) | CLI; REST `DELETE .../memories/{id}` | None automated | **O** | L | Permanent and irreversible. Reversible alternative is `memory expire`. Offer only inside the owner-driven command with confirmation |
| `upload <file>` (.pdf .docx .xlsx .json .txt .csv .md; 5 GB max) | CLI; REST `POST .../upload-file` | `plan:post` uploads PLAN.md; `execute:post` SUMMARY.md; `verify:post` VERIFICATION.md/UAT.md. Deterministic filename `<project>-<phase>-<NN>-<KIND>.md` | **I** | M | No tag/metadata option, so provenance lives in the filename. Dedupe behaviour on re-upload is unknown (research flag). No MCP tool |

### B. Data plane: read

| Memanto feature | Interface | Proposed GSD mapping | I/O | Cx | Notes |
|-----------------|-----------|----------------------|-----|----|-------|
| `recall <query>` with `--limit/-n`, `--type/-t`, `--min-similarity`, `--min-confidence`, `--tags`, `--active`, `--expired`, `--source/-s` | CLI; MCP `recall`; REST `POST .../recall` and `.../recall/all` | `discuss:pre` contribution (into `orchestrator`) and `plan:pre` step producing `MEMORY-RECALL.md`. Query = phase goal + topic. Default `--active` so expired (superseded) facts are not surfaced as current | **I** | M | Default returns active AND expired, labelled. Config: `recall_limit`, `min_confidence` |
| `recall --as-of <ISO>` | CLI; MCP `recall_as_of`; REST `.../recall/as-of` | `plan:pre` "what was true when phase N was planned". Also audit during `verify:pre` | **I** | M | Differentiator: temporal decision archaeology. No query argument needed |
| `recall --changed-since <ISO>` | CLI; MCP `recall_changed_since`; REST `.../recall/changed-since` | `discuss:pre` "what changed since the last phase shipped". The timestamp comes from the previous phase's `ship:post` | **I** | M | Needs a capability-local last-ship timestamp (ledger) |
| `recall --recent` | CLI; MCP `recall_recent`; REST `.../recall/recent` | `resume-work` / `discuss:pre` fallback when the topic query is thin | **I** | L | Newest-first, no query |
| `answer "<question>"` with `--limit/-n`, `--source/-s` | CLI; MCP `answer`; REST `POST .../answer` | `plan:pre` RAG synthesis ("what do we already know and decide about X?") folded into `MEMORY-RECALL.md`; `discuss:pre` synthesis | **I** | M | Server-side LLM (answer config: temperature 0.7, limit 15, threshold 0.15). Treat output as hearsay with citations, never as authority. Non-deterministic |
| `agent bootstrap [agent_id]` with `--output/-o` (JSON snapshot) | CLI | `discuss:pre` session primer (once per phase) and `gsd-resume-work` context. Optionally persisted to `.planning/memanto/bootstrap.json` | **I** | M | CLI only, no MCP tool. Snapshot JSON schema is unpublished (research flag) |

### C. Conflict, expiry and lifecycle

| Memanto feature | Interface | Proposed GSD mapping | I/O | Cx | Notes |
|-----------------|-----------|----------------------|-----|----|-------|
| `detect-conflicts` (`--date`, `--agent`) | CLI; REST `POST .../conflicts/generate` | Run at `ship:post` (and `execute:post`) for the day's captures. At `discuss:pre` run for today and read the report. See finding 3 | **I** | H | Date-scoped, LLM pass. Report in `~/.memanto/conflicts/` (global, not project-local) |
| `conflicts` (`--date`, `--agent`, `--list`) | CLI interactive; REST `GET .../conflicts` and `POST .../conflicts/resolve` | `discuss:pre`: `conflicts --list`, then the orchestrator asks the owner per conflict (AskUserQuestion), then resolve via REST (`keep_old/keep_new/keep_both/remove_both/manual`) | **I** | H | The interactive CLI cannot run inside an agent. REST resolution requires a local server. Resolve = Memanto expires the loser (assumed, verify) |
| `memory expire <id>` (`--reason/-r`) | CLI; REST `POST .../expire` | Supersession: when a later phase replaces a decision, expire the old memory with `--reason superseded-by-phase-NN` | **I** | M | Reversible. Memanto removed native `supersedes/superseded_by` fields, so link the old and new memories by tag/content |
| `memory restore <id>` | CLI; REST `POST .../restore` | Owner-driven command only (rollback of a wrong expiry) | **I** (command only) | L | Not a lifecycle hook |
| `policy show` (`-a`) | CLI; REST `GET .../policy` | Read-only doctor/preflight info | **I** | L | |
| `policy list-preset` | CLI; REST `GET .../policy/presets[/{name}]` | Owner command help | **I** (command) | L | Presets: `conservative`, `balanced`, `aggressive`. `pinned` tag always exempt; `preference/instruction/relationship` never expire |
| `policy apply-preset <name>` (`-a`, `-y`) | CLI; REST `POST .../policy/preset` | Owner-driven `/gsd-memanto-policy` command (recommend `balanced`). Never silent | **I** (command, guarded) | M | Replaces the agent's whole policy. GSD decisions should carry the `pinned` tag so no preset ever ages them out |
| `policy apply` (`-a`, `--dry-run`, `-n`, `-y`) | CLI; REST `POST .../policy/apply` | `ship:post` agent runs `--dry-run` and reports what would expire. Real apply only with `memanto.expiry_sweep=true` | **I** | M | The nightly `schedule` job already performs the expiry sweep |
| `policy purge` (`-a`, `--dry-run`, `-y`) | CLI; REST `POST .../policy/purge` | None | **O** | L | Irreversible hard delete, disabled unless the policy sets `purge_expired_after`. Never automated by a workflow tool |
| `daily-summary` (`-d`, `-a`, `-o`) | CLI; REST `POST .../daily-summary` | `ship:post` agent generates the session summary, writing to `.planning/phases/<phase>/MEMANTO-SUMMARY.md` (`-o`). Config `daily_summary_on_ship` | **I** | M | The server controls the REST output path and ignores `output_path`; the CLI honours `-o`. Default location is `~/.memanto/summaries/<agent>_<date>.md`. The summary is per-day, not per-phase |
| `schedule enable / disable / status` | CLI | Read-only `schedule status` in preflight and doctor. `enable` only from the explicit owner command `/gsd-memanto-schedule` | **I** (guarded) | M | Installs an OS-level job (crontab/schtasks, `MemantoNightlyJob`): daily-summary + detect-conflicts + expiry-sweep. **Machine-global, not per project.** Never auto-enable |
| `memory export` (`-a`, `-o`, `-n`, `--okf`, `--split`) | CLI | Optional `ship:post` snapshot to `.planning/memanto/memory.md` (default OFF), plus a milestone-complete command | **I** (optional) | L | Portability and audit trail. Max 25 memories per type by default. May leak private memory into git, so default off |
| `memory sync` (`-p`, `-a`, `--connection`, `--scope`, `-n`, `--okf`, `--split`, `--catch-up`) | CLI | None | **O** | L | Injects memories into agent-instruction files (CLAUDE.md etc.) via sentinels. Collides with GSD-managed instructions and duplicates what the recall steps do |

### D. Agents, sessions and identity

| Memanto feature | Interface | Proposed GSD mapping | I/O | Cx | Notes |
|-----------------|-----------|----------------------|-----|----|-------|
| `agent create <id>` (`--pattern project\|support\|tool`, `--description`) | CLI; MCP admin `create_agent`; REST `POST /api/v2/agents` | One-time `/gsd-memanto-setup` command. Pattern `project`. The id is chosen explicitly by the owner and written to `memanto.agent_id`. **No default** | **I** (command) | M | Also activates the agent immediately. `memanto-dev` must never ship as a default |
| `agent list` | CLI; MCP admin `list_agents`; REST `GET /api/v2/agents` | Setup/doctor: verify the configured id exists | **I** | L | |
| REST `GET /api/v2/agents/{id}`, MCP admin `get_agent` | REST; MCP | Preflight existence check | **I** | L | |
| `agent activate <id>` (`--hours/-h`, default 6) | CLI; REST `POST .../activate` | Preflight step at `discuss:pre`, `plan:pre`, `execute:pre`, `verify:pre`, `ship:pre` (idempotent re-activate, `--hours` config, default 6) | **I** | M | Sets the machine-global active agent (see finding 2) |
| `agent auto-activate [on\|off]` | CLI | Doctor/preflight reads the state. `on` set once in setup with owner consent | **I** (guarded) | L | Machine-global; affects every tool on the computer. Renews, restarts and resumes the last agent |
| `agent deactivate` | CLI; REST `POST .../deactivate` | None | **O** | L | Session expiry must stay invisible; deactivating would break the next stage |
| `agent delete <id>` (`-f`, `--delete-memories/--keep-memories`) | CLI; MCP admin `delete_agent`; REST `DELETE /api/v2/agents/{id}` | None | **O** | L | Destroys project memory; owner does this directly in Memanto |
| `session info` (legacy alias namespace) | CLI | Preflight verification that the active agent equals the configured agent, and the session is live | **I** | L | Used as the fail-closed identity check |
| `status` | CLI; REST `GET /api/v2/status`, `/health`, `/ready`, `/live` | Preflight/doctor: environment, server health, config, active session, agents | **I** | L | `GET /health` returns `{"status":"ok"}` (verified live) |
| `config show` | CLI | Doctor: reports backend (cloud/moorcheh/on-prem), recall/answer defaults. **Read-only; never writes backend config** | **I** | L | Honors backend-agnostic: only reports |

### E. Connection, backend and tooling (out of lifecycle)

| Memanto feature | Interface | Proposed GSD mapping | I/O | Cx | Notes |
|-----------------|-----------|----------------------|-----|----|-------|
| `login` (`--key`), `logout`, `use <cloud\|moorcheh\|on-prem\|local>` | CLI | None | **O** | L | Owner decision: backend is configured outside the capability. Doctor may display the current backend |
| `connect [tool]` for claude-code, codex, kimi-code, pi, cursor, windsurf, antigravity, gemini-cli, cline, continue, opencode, goose, roo, github-copilot, augment; plus `connect update / list / remove / multi` (`-p`, `-g`, `-y`, `-a`) | CLI | Doctor runs read-only `connect list` to verify the MCP server is registered for Claude Code. Setup docs instruct the owner to run `connect claude-code`. The capability never invokes `connect` | **O** (list = **I** read-only) | L | `connect` edits `.mcp.json` / `~/.claude.json`, tool permissions, hooks, a statusline and instruction templates. Mutating user/global tool config is not the capability's job. Installs the `memanto-mcp` server (needs `pip install memanto-mcp`) |
| `serve` (`--host`, `--port`, `--reload`) | CLI | None to manage; REST fallback requires it, so doctor probes `GET /health` | **O** (probe = **I**) | L | Capability does not start daemons |
| `ui` (`--host`, `--port`, `--local`), `/ui` and all `/api/ui/*` | CLI; REST | None | **O** | L | Human dashboard. Local-only (`_require_local`). Docs may mention it |
| `widget on\|off` | CLI | None | **O** | L | Desktop GUI; no workflow value |
| `migrate mem0 / letta / supermemory / zep / hindsight / langfuse / okf / to-cloud` (`--file`, `--api-key`, `--agent`, `--dry-run`, `--report`, ...) | CLI; REST `/api/ui/migrate/*`, `/api/ui/cloud-move*` | None | **O** | L | Owner ruled out migration. Provider imports are unrelated to the GSD lifecycle. `to-cloud` is backend management. OKF is a possible future portability add-on (paired with `memory export --okf`) |

### F. REST endpoint coverage (base path `/api/v2`, memory routes under `/agents/{agent_id}`)

| Endpoint | CLI/MCP equivalent | Decision |
|----------|--------------------|----------|
| `GET /health`, `/ready`, `/live`, `GET /` | `status` | **I** (probe only) |
| `GET /status` | `session info` / `status` | **I** |
| `POST /agents`, `GET /agents`, `GET /agents/{id}`, `DELETE /agents/{id}` | `agent create/list/delete`, MCP admin | create/list/get **I**, delete **O** |
| `POST /agents/{id}/activate`, `/deactivate` | `agent activate/deactivate` | activate **I**, deactivate **O** |
| `POST .../remember`, `/batch-remember`, `/remember/extract` | `remember`, `--batch`, `--from-conversation` | remember/batch **I**, extract **O** |
| `PATCH .../memories/{id}`, `DELETE .../memories/{id}` | `edit`, `forget` | edit **I**, delete **O** |
| `POST .../upload-file` | `upload` | **I** |
| `POST .../recall`, `/recall/as-of`, `/recall/changed-since`, `/recall/recent`, `/recall/all` | `recall` variants | **I** |
| `POST .../answer` | `answer` | **I** |
| `POST .../daily-summary` | `daily-summary` | **I** (CLI preferred, REST ignores `output_path`) |
| `POST .../conflicts/generate`, `GET .../conflicts`, `POST .../conflicts/resolve` | `detect-conflicts`, `conflicts --list`, interactive `conflicts` | **I** (resolve is the only REST-only path) |
| `POST .../memories/{id}/expire`, `/restore` | `memory expire/restore` | **I** |
| `GET/PUT .../policy`, `GET .../policy/presets[/{name}]`, `POST .../policy/preset`, `/policy/apply`, `/policy/purge` | `policy *` | show/presets/preset/apply **I**, purge **O** |
| `/api/ui/*` (~35 routes: config, conflicts, daily-summary, sessions, browse, connections, template-status, achievements, migrate, cloud-move, onprem restart, api-key, shutdown) | dashboard only | **O** (UI backing API, local-only) |

### G. MCP tool coverage

| MCP tool | Decision and mapping |
|----------|----------------------|
| `remember`, `batch_remember` | **I**: interactive capture (decisions, problem-fix). Pass `agent_id` explicitly |
| `recall`, `recall_recent`, `recall_as_of`, `recall_changed_since` | **I**: interactive recall at discuss/plan |
| `answer` | **I**: interactive RAG synthesis |
| `create_agent` (admin) | **O**: use the CLI in the setup command; do not require `MEMANTO_EXPOSE_ADMIN` |
| `list_agents`, `get_agent` (admin) | **O**: CLI/REST used for preflight; admin exposure is off by default |
| `delete_agent` (admin) | **O**: destructive |

## Table Stakes

| Feature | Why Expected | Cx | Notes |
|---------|--------------|----|-------|
| Installable manifest (`.gsd/capabilities/memanto`, `engines.gsd`, no gsd-core edits, consent flow) | Owner constraint. Without it nothing loads | M | Validate against `capability-validator.cjs`. Id must not collide with `mempalace` or use a reserved prefix |
| Explicit `memanto.agent_id` config (no default) and `memanto.enabled` as `activationKey` | Owner decision: agent identity per project, `memanto-dev` is dev-only | L | Empty id = hard block, not a silent default |
| Preflight (health, agent exists, session live, active==configured) with `onError: halt` | Fail-closed once enabled and expected | M | Run at every `:pre` point. Covers unreachable, misconfigured, no agent, failed activation |
| Auto-activate before memory calls | Session expiry must be invisible | L | Per-stage idempotent `agent activate --hours N` plus `auto-activate` status check |
| Mutual exclusivity with MemPalace | Owner decision. Manifest has no exclusivity field | M | Preflight step reads `mempalace.enabled`; also refuse at enable-time in setup command. Gate form is a research flag |
| Recall at `discuss:pre` and `plan:pre` (semantic + temporal + RAG `answer`) | Core value: read prior memory | M | `MEMORY-RECALL.md` artifact, same shape as MemPalace |
| Conflict detection and owner resolution at discuss | Owner decision | H | See findings 3 and 4 |
| Capture decisions, problem to fix pairs, artifact uploads, session summaries | Owner-required capture set | M | Types: `decision`, `error`, `learning`; uploads; `daily-summary` |
| MCP interactive / CLI headless transport | Owner constraint | M | Only 7 operations are MCP-capable; the rest are CLI in both modes |
| `COVERAGE.md` matrix (this inventory, every row INTEGRATE or OPT-OUT with reason) | Owner requirement, reuses `api_coverage_gate` format | L | Feeds from sections A to G; table format `capability | decision | reason` |
| Deterministic test suite (manifest validation + stubbed Memanto; one live run on the dev agent) | Owner requirement | M | A `memanto` shim script enables headless stub tests |

## Differentiators

| Feature | Value Proposition | Cx | Notes |
|---------|-------------------|----|-------|
| Temporal recall: `--as-of` (decision archaeology) and `--changed-since` (delta since last ship) | Memanto's signature capability; MemPalace has a KG timeline only | M | Needs a last-ship timestamp in a capability ledger |
| Supersession via `memory expire --reason superseded-by-phase-NN` | Keeps stale decisions out of recall without deleting them; reversible | M | Recall with `--active` by default |
| Confidence and provenance mapping (`explicit_statement` for owner-stated decisions, `inferred` for agent-derived, `validated` for verified fixes, `corrected` after conflict resolution) | Lets recall rank trusted memory above guesses; works with the `balanced` preset's low-confidence expiry | L | Never leave defaults (0.8, `explicit_statement`) |
| `agent bootstrap` primer at phase start and on resume | One-call "what does this agent know" snapshot | M | Schema unpublished |
| Pre-task pitfall recall at `execute:wave:pre` (`--type error,learning`) | Prevents repeating fixed problems inside a wave | M | Contribution into `executor`; keep small |
| Ship-time curator agent (`gsd-memanto-curator` at `ship:post`: daily-summary, detect-conflicts, expiry dry-run, optional export) | Mirrors the MemPalace curator; one place for end-of-phase curation | M | Agent stem must be declared in `agents[]` |
| Owner commands: `/gsd-memanto-setup`, `-status` (doctor), `-recall`, `-conflicts`, `-policy`, `-schedule`, `-export` | Operability; maps the CLI areas that have no lifecycle hook | M | Delivered as skills/commands in the overlay, or a `commands[]` module (consent-bound) |
| `memory export` / OKF snapshot at milestone completion | Portable audit trail of project memory | L | Default off |
| RAG `answer` folded into planning context with citations | Condenses many memories into a plan-ready brief | M | Non-deterministic; label as synthesized |

## Anti-Features (Do NOT Build)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Run `login` / `logout` / `use` / `migrate to-cloud` from the capability | "One-command setup" | Owner ruled backend configuration out; credentials in a workflow tool | Doctor reports the backend; owner runs `memanto use` |
| Run `memanto connect` automatically | Zero-config MCP | Edits global tool settings, hooks, statusline, instruction files; surprises the user | Doctor checks `connect list`; setup docs tell the owner to run it |
| `memory sync` into CLAUDE.md / AGENTS.md | Memory always in context | Double-injects alongside GSD recall, fights GSD-managed instruction files, unbounded growth | Phase-scoped `MEMORY-RECALL.md` and contributions |
| `--from-conversation` auto-extraction of every session | "Capture everything" | LLM-noisy memory, cost, and bypasses the owner's explicit capture list | Explicit decision / problem-fix / artifact capture |
| Automated `forget`, `policy purge`, `agent delete` | Memory hygiene | Irreversible loss; fail-closed workflow could delete in error | Reversible `memory expire`; destructive ops stay owner-run |
| Auto-`schedule enable` | Nightly summaries for free | Installs an OS cron job, machine-global, outside the project | Explicit `/gsd-memanto-schedule` with consent |
| Shipping a default `agent_id` (especially `memanto-dev`) | Convenience | Cross-project memory contamination | Hard error when empty |
| Dual-writing to MemPalace or migrating from it | Continuity | Owner: mutually exclusive, no migration | Switching providers starts fresh |
| Uploading every file under `.planning/` | Completeness | Noise and secrets; unbounded cost | Only PLAN, SUMMARY, VERIFICATION/UAT per phase |
| Widget, UI dashboard or `serve` lifecycle management | Visibility | GUI and daemons are not workflow concerns | Mention in docs |
| Skip-on-error semantics (MemPalace style) | Resilience | Violates owner's block-always decision | `onError: halt` plus clear error text |

## Feature Dependencies

```
memanto.enabled + memanto.agent_id (config)
    └──requires──> Preflight (health, agent exists, exclusivity vs mempalace, activate)
                       ├──requires──> Recall (discuss:pre, plan:pre)
                       │                 ├──enhances──> temporal (as-of, changed-since)
                       │                 └──enhances──> RAG answer, bootstrap
                       ├──requires──> Capture (decision, problem-fix, batch)
                       │                 ├──requires──> capability ledger (memory ids, last-ship ts, idempotency)
                       │                 └──enhances──> expire (supersession) ──requires──> memory ids
                       ├──requires──> Artifact upload (PLAN/SUMMARY/VERIFICATION) ──requires──> deterministic filenames
                       └──requires──> Conflicts (detect then resolve at discuss)
                                         ├──requires──> detect-conflicts run on a prior day/phase (date-scoped)
                                         └──requires──> REST resolve path (local `serve`) OR a TTY fallback

Daily summary ──enhances──> Schedule (nightly job also does detect-conflicts + expiry sweep)
Policy preset ──enhances──> Expiry (apply --dry-run at ship:post); `pinned` tag protects GSD decisions
COVERAGE.md ──documents──> every row above
connect (owner-run) ──prerequisite for──> MCP transport
```

### Dependency Notes

- **Conflicts resolve requires an earlier detect run:** the detector is date-scoped, so conflicts between today's capture and an old memory only appear if both fall in the analysed window. Run detect at capture time (`ship:post`, `execute:post`) and again at `discuss:pre`, then read the report.
- **Capture requires a ledger:** Memanto has no native supersede links, and no verified dedupe on `remember`. A capability-local ledger of (kind, phase, content-hash, memory id) provides idempotency, edit-in-place and expire targeting.
- **Every CLI call requires the active-agent check:** because `remember/recall/answer/upload` have no `--agent`, preflight must precede each batch.
- **Mutual exclusivity requires reading MemPalace config:** the capability reads `mempalace.enabled`; there is no manifest field to express this.

## MVP Recommendation

Prioritize (in dependency order):
1. Manifest + config + preflight with `halt` (identity, health, exclusivity, auto-activate). Everything else depends on it.
2. Capture: decisions (`discuss:post`, `plan:post`), problem to fix (`execute:wave:post`), artifact uploads, ledger.
3. Recall: `discuss:pre` and `plan:pre` with semantic + `answer` + `MEMORY-RECALL.md`; then temporal (`as-of`, `changed-since`).
4. Conflicts at discuss (research the REST resolve path first).
5. Ship curator: daily-summary, expiry dry-run; owner commands (setup/status/schedule/policy); `COVERAGE.md`.

Defer: `execute:wave:pre` pitfall recall, `memory export`/OKF, bootstrap persistence, `edit`-in-place refinement. All are valuable but non-blocking.

## Research Flags for Roadmap

- **Gate evaluation for overlay `query`/`predicate`:** how gsd-core executes a third-party gate check at runtime is not visible in the loader; may require a consent-bound `commands[]` module. Fallback is `halt` steps.
- **How host workflows dispatch overlay steps/contributions:** the first-party comments say consumers "dispatch on specific capIds / ref.skills". Verify that a third-party `ref.skill`/`ref.agent` step at every point actually renders (`gsd_run loop render-hooks <point>`).
- **MCP parameter schemas** (`remember` title/tags/confidence support, `agent_id`) cannot be verified until `memanto-mcp` is installed. Run `tools/list`.
- **REST conflict resolve** requires a local server; confirm the server auth model and behaviour on the cloud backend.
- **Recall/upload dedupe semantics and `bootstrap` JSON schema** are undocumented.
- **Prompt-injection filter on writes** may reject legitimate GSD content; define the fail-closed behaviour (escape, or owner decision) up front.

## Sources

- Installed Memanto v0.3.0 `memanto --help` and every `memanto <cmd> [<sub>] --help` (all 24 top-level commands and every subcommand under agent, session, config, schedule, memory, policy, connect, migrate): HIGH.
- Installed package source `~/.local/share/uv/tools/memanto/lib/python3.14/site-packages/memanto` (`app/routes/*.py`, `app/constants.py`, `app/core.py`, `app/services/policy_presets.py`, `cli/schedule_manager.py`, `cli/connect/*`): HIGH for routes, types and fields; the live server's `/openapi.json` and `/docs` return 404, only `/health` answers.
- https://github.com/moorcheh-ai/memanto and https://github.com/moorcheh-ai/memanto/tree/main/integrations/mcp (fetched README summaries; MCP tool list, env vars `MEMANTO_DEFAULT_AGENT_ID`, `MEMANTO_EXPOSE_ADMIN`, `MEMANTO_SESSION_DURATION_HOURS`, transports): MEDIUM. https://pypi.org/project/memanto-mcp/ (tool table): MEDIUM. A third-party Glama listing using `memanto_`-prefixed names is NOT the official server: LOW.
- gsd-core v1.20.1 `~/.claude/gsd-core/bin/lib/capability-validator.cjs`, `loop-host-contract.cjs`, `capability-loader.cjs`, `loop-resolver.cjs`, `capability-registry.cjs` (mempalace entry ~line 2673, api_coverage_gate ~line 43), `agents/gsd-mempalace-curator.md`, `commands/gsd/mempalace-recall.md`: HIGH.
- `/Users/trekkie/projects/gsd-memanto/.planning/PROJECT.md` (binding owner decisions).
