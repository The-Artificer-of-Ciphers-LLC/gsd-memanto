<!-- GSD:project-start source:PROJECT.md -->

## Project

**gsd-memanto**

An installable, third-party opengsd/gsd-core capability that fully supports and uses Memanto (https://memanto.ai, repo https://github.com/moorcheh-ai/memanto) as the GSD project-memory provider. Every Memanto feature is mapped to what gsd-core can support as a capability: gates, steps, contributions, config keys, a command family, and (where staging allows) skills. Nothing is added outside the capability definition. It is installed once globally (`$GSD_HOME/.gsd/capabilities/memanto`) and enabled per project. It is for GSD users who want Memanto-backed memory across the discuss → plan → execute → verify → ship lifecycle.

**Core Value:** When the capability is enabled, every GSD lifecycle stage reliably reads from and writes to the project's explicitly configured Memanto agent. Any failure blocks the workflow, and gsd-core is never modified.

### Constraints

- **Distribution**: third-party capability, installed globally, enabled per project — every gate, step, contribution, config key, command and skill lives in the capability definition
- **No gsd-core changes**: only the capability surface gsd-core 1.20.1 already supports; `engines.gsd >=1.20.1 <2.0.0`
- **Runtime**: Node CJS with zero runtime dependencies (install is copy-only, symlinks are rejected, the bundle is hash-bound); synchronous command router; runtime state outside the bundle
- **Namespace**: the Memanto agent id must be explicitly configured per project
- **Servers**: Memanto backend and REST API must be pre-running, pre-configured and healthy; the capability only connects
- **Failure semantics**: fail closed — all memory operations block (directly via gates, or via the ledger at the next gate)
- **Interface**: REST with an explicit agent per request; CLI only where REST lacks the feature; MCP in interactive prompts
- **Compatibility**: works with any Memanto backend (on-prem or cloud)

<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->

## Technology Stack

## 1. Capability Bundle Contract (gsd-core v1.20.1)

### 1.1 File layout and discovery

| Fact | Evidence |
|------|----------|
| Manifest file is exactly `capability.json` at the bundle root. | `lib/capability-loader.cjs:628` |
| Project scope root: `<projectRoot>/.gsd/capabilities/<id>/`; global: `$GSD_HOME/.gsd/capabilities/<id>/` (GSD_HOME defaults to `~`). | `lib/capability-loader.cjs:12-13, 245-257` |
| Folder name MUST equal manifest `id`; `id` is kebab-case `^[a-z][a-z0-9-]*$`. | `lib/capability-validator.cjs:347-351`, `:175` |
| Reserved id prefixes `gsd-`, `gsd-core-`, `anthropic-` are rejected. Use `memanto`. | `lib/capability-loader.cjs:78, 679-682` |
| Install sources: local path (`./`, `../`, absolute), `npm:<pkg>`, https `.tgz`/`.tar.gz`, `git+`/`.git`/`#ref` URL, registry spec. | `lib/capability-source.cjs:767-811` |
| For local/git/npm/tarball the `capability.json` must sit at the source root (npm/tarball also accept `package/`). The bundle IS the repo root for a git install. | `lib/capability-source.cjs:829, 860, 910-914` |
| Install is copy-only; nothing in the bundle executes at install. | `lib/capability-source.cjs:5-14` |
| Staging copies the ENTIRE source tree with no ignore list (including `.git`, `.planning`, `node_modules`, tests). Any symlink aborts install (`Refusing to stage symlink`). | `lib/capability-source.cjs:420-481` (symlink refusal `:448-450`) |
| Limits: 128 MiB / 100k entries staged; consent content-hash walk is capped at 16 MiB total, over which the capability fails closed (inactive). | `lib/capability-source.cjs:86`, `lib/capability-consent.cjs:89` |
| Project-scope activation requires a consent record in the user-owned `~/.gsd/consent.json`, bound to a RECOMPUTED sha512 of the whole bundle. Any byte change after consent (including runtime-written files) deactivates the capability. | `lib/capability-loader.cjs:770-794`, `lib/capability-consent.cjs:463` |
| Per-capability mutable data belongs in `<root>/.gsd/capability-data/<id>/` (survives upgrade, removed by `remove --purge-data`), NEVER inside the bundle dir. | `lib/capability-lifecycle.cjs:65-67` |
| Command dispatch for a third-party family only works when the id has a COMMITTED ledger entry (i.e. installed via `capability install`, not hand-copied). | `lib/capability-loader.cjs:895-896` |

### 1.2 Required manifest fields (`role: "feature"`)

| Field | Rule | Source |
|-------|------|--------|
| `id`, `role:"feature"`, `title`, `description` | non-empty strings; role in `feature|runtime|reviewer` | `:347-364`, `:179` |
| `version` | strict semver (`1.2.3`, prerelease ok) | `:287`, `:192` |
| `tier` | `core|standard|full` (use `full`, same as first-party `mempalace`) | `:366`, `:180` |
| `requires` | array (use `[]`) | `:370-378` |
| `engines.gsd` | optional semver range, HARD gate at install and load; use `">=1.20.1 <2.0.0"` | `:291-297`, `lib/capability-loader.cjs:723-728` |
| `runtimeCompat` | required object `{supported:["*"]|[ids], unsupported:[]}`; `supported` non-empty | `:495-556, :561` |
| `skills`, `agents` | required arrays of strings (may be `[]`) | `:563, :587` |
| `config` | required object; each key `{type: boolean|string|number|enum, default, description}`; enum needs `values` | `:600-618`, `:81-171` |
| `steps`, `contributions`, `gates` | required arrays (may be `[]`) | `:676, :684, :692` |
| `commands` | optional `[{family, module, router, subcommands?}]`; `module` must match `^[A-Za-z0-9._-]+\.cjs$` (bare basename at bundle root) | `:576-585, :439-493, :463` |
| `activationKey` | optional; must name a key declared in this capability's own `config` | `:702-724` |
| `hooks` | optional `[{event, script, matcher?}]`; script path `[A-Za-z0-9._/-]` only | `:621-669, :211-256` (NOT recommended, see 1.6) |
| `compatVersions`, `integrity`, `provenance`, `author`, `license`, `repository`, `homepage`, `keywords` | optional | `:299-326`; reference doc `capability-manifest.md` |

### 1.3 Hook shapes and the 12 loop points

| Kind | Required fields | Notes / source |
|------|-----------------|----------------|
| **step** | `point`, `ref` (exactly ONE of `skill`/`agent`/`command`), `produces[]`, `consumes[]`, `onError: skip|halt`; optional `when`, `fragment`, `pointFrom` | `:2929-3023`. `ref.skill` stem must be declared in `skills[]` and must NOT start `gsd-` (`:2951-2967`). Step dispatch is advisory by construction (`references/loop-hook-dispatch.md:78`). |
| **contribution** | `point`, `into`, `produces[]`, `consumes[]`, `fragment` (`{path}` or `{inline}`), optional `when`, `onError` | `:3025-3063`. `into` must be an agent role of that point (`:3125-3135`): discuss/verify/ship -> `orchestrator`; plan -> `researcher|planner|checker`; execute -> `executor|verifier|code-reviewer` (`lib/loop-host-contract.cjs`). `fragment.path` is read at load into `inline`, confined to the bundle (`:2820-2884`). |
| **gate** | `point`, `check` (exactly one of `query|predicate|agentVerdict`), `blocking` (boolean), `onError: skip|halt`, optional `when` | `:3065-3103`. `agentVerdict` can never block (`:3083-3087`). `query` ids resolve to first-party `gsd_run check <id>` only, so a third-party gate must use `predicate` (`references/loop-hook-dispatch.md` gate section). |
- `when` (steps, contributions, gates) must be a key declared in this capability's `config` and is evaluated as `Boolean(value)` (`:3137-3206`, `lib/capability-activation.cjs`).
- `consumes` must be a host artifact already available at that point (`CONTEXT.md` from `discuss:post`, `PLAN.md` from `plan:post`, `SUMMARY.md` from `execute:post`, `UAT.md` from `verify:post`) or produced by a DIFFERENT step at an earlier/equal point; never its own output (`:3226-3355`). Nothing is consumable at `discuss:pre`.
- **Two capabilities producing the same artifact name at the same point is a thrown "duplicate-producer" error and the overlay is dropped** (`:3264-3295`). First-party `mempalace` produces `MEMORY-RECALL.md` at `plan:pre` (`lib/capability-registry.cjs:2773`). Memanto must NOT reuse that name; use `MEMANTO-RECALL.md`. Reproduced: install fails with `duplicate-producer invariant violated ... (capabilities: memanto, mempalace)`.
- Skill/agent stems, config keys, command families are globally unique; first-party always wins (`lib/capability-loader.cjs:689-722`).

### 1.4 The three execution primitives we can use (and what each can enforce)

| Primitive | Mechanism | Fail-closed? | Source |
|-----------|-----------|--------------|--------|
| **Gate, `predicate.kind:"command-exit-zero"`** | Runs `sh -c <command>` at the project root, default 30s, `timeout` in SECONDS, command <= 4096 chars; placeholders `${PHASE_NUMBER}`, `${PHASE_DIR}`, `${PHASE_REQ_IDS}`; non-zero exit or timeout -> `{block:true, message:<stderr tail, 2000 chars>}` | YES: with `blocking:true`, `onError:"halt"` the host halts the step. Proven by the skeleton. | `lib/gate-predicate-evaluator.cjs:34-106`, `lib/gate-predicate.cjs:53-60` |
| **Step, `ref.command`** | Validated against `^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$`, then run as `gsd_run <ref.command> --phase "$PHASE_NUMBER" --raw` -> routed to our command family (e.g. `memanto recall`) | Advisory only (steps never block); use for deterministic work (recall file generation, capture) | `references/loop-hook-dispatch.md:45-54` |
| **Contribution, `fragment.inline`** | Verbatim text injected into the named agent role's prompt | No: instructs the LLM (this is how interactive MCP use is expressed) | `references/loop-hook-dispatch.md:28-31` |
| Step, `ref.skill` | Skill tool call `gsd-<stem>` | Advisory; **unusable at project scope** (see 1.5) | `references/loop-hook-dispatch.md:36` |

### 1.5 Dispatch coverage per point (v1.20.1 workflows; MEDIUM, confirm with a probe capability in phase 1)

| Point | Dispatches | Evidence |
|-------|------------|----------|
| `discuss:pre`, `discuss:post` | all kinds (generic contract) | `workflows/discuss-phase.md:300, 419` |
| `plan:pre`, `plan:post` | steps, contributions, gates | `workflows/plan-phase.md:475, 512, 1467-1471` |
| `execute:pre` | **NOTHING in v1.20.1 or v1.22.0** (frontmatter lists it, no `render-hooks execute:pre` call; wired only on upstream `main`, #5848, unreleased) | `workflows/execute-phase.md:3`; grep of 1.20.1/1.21.0/1.22.0 tags |
| `execute:wave:pre` | contributions, steps | `workflows/execute-phase.md:622-624` |
| `execute:wave:post` | contributions, steps, gates | `workflows/execute-phase.md:991-995` |
| `execute:post` | steps via envelope; `code-reviewer` contributions are consumed by `code-review.md`, not generically | `workflows/execute-phase.md:207-211` |
| `verify:pre` | contributions, steps, gates | `workflows/verify-work.md:85-109` |
| `verify:post` | steps (contribution/gate coverage unverified) | `workflows/verify-work.md:602-606` |
| `ship:pre` | gates, steps | `workflows/ship.md:124-204` |
| `ship:post` | steps only (additive, never blocks) | `workflows/ship.md:545-555` |

### 1.6 What a project-scope bundle can and cannot ship

- **Skills do not reach the agent from a project-scope install (HIGH, source-read).** Third-party `SKILL.md` staging reads only `$GSD_HOME(or ~)/.gsd/capabilities/<capId>/skills/<stem>/SKILL.md` (`lib/install-profiles.cjs:741-749`) and only runs during the product installer/surface apply, not at `capability install`. Project scope plus `step.ref.skill` therefore dispatches a skill that was never staged. **Ship `skills: []`.** Express all instruction content as `contributions` (inline fragments) and `steps` with `ref.command`. If an interactive skill is later wanted, it requires a GLOBAL install plus re-running the GSD surface apply, and conflicts with the owner's "installed into `.gsd/capabilities/memanto`" project goal.
- **`agents[]` are never staged for third-party capabilities** (`references` doc: capability-manifest "skills and agents"; `docs/explanation/capability-trust-model.md`). Ship `agents: []`; do not use `ref.agent`.
- **`hooks[]` / `mcpServers`** require `--shared-file <settings.json>` edits at install (`lib/capability-lifecycle.cjs:455-566`), widen the consent disclosure, and `mcpServers` is written with an injected `_gsdCapability` marker key. Do not use either. MCP registration stays the user's `memanto connect` step (it writes `.mcp.json` itself).
- **Command module rules (HIGH):** bare `.cjs` basename at bundle root, required from the install root; the router receives `{args, cwd, raw, error}`; **it must be synchronous** (a returned Promise is rejected) (`gsd-tools.cjs:541-545, 625-641`). Use `child_process.spawnSync` for the `memanto` CLI. Command modules are an executable surface, so install needs `--yes` (observed `status:"aborted"` without it).

### 1.7 Install, consent, update (verbatim CLI)

## 2. Memanto Interface Contract (v0.3.0)

### 2.1 Versions

| Component | Version | Notes |
|-----------|---------|-------|
| `memanto` (PyPI, CLI + local REST server) | **0.3.0** (2026-11-20), `requires-python >=3.10,<4` | installed at `~/.local/bin/memanto`, pipx; pre-1.0 with 0.2.32 -> 0.3.0 in two days, so pin and add a drift test |
| `memanto-mcp` (PyPI, MCP server) | **0.1.5** (2026-10-29), needs `memanto>=0.2.31`, `mcp>=1.2,<2` | **not installed on this machine** (`memanto-mcp` not on PATH); required for the interactive path |
| Local REST | `http://localhost:8000`, `GET /health` -> `{"status":"ok"}` (verified) | `/docs` and `/openapi.json` return 404 (gated by `MEMANTO_ENABLE_DOCS`); routes taken from upstream source |

### 2.2 MCP tools (interactive path) - 7 default + 4 opt-in

| Tool | Use in GSD |
|------|------------|
| `remember`, `batch_remember` (<=100) | capture decisions, problem->fix pairs, artifact summaries |
| `recall`, `recall_recent`, `recall_as_of`, `recall_changed_since` | discuss/plan recall; temporal queries |
| `answer` | RAG synthesis for the discuss brief |
| `create_agent`, `list_agents`, `get_agent`, `delete_agent` | admin, only with `MEMANTO_EXPOSE_ADMIN=true`; do not rely on them |

### 2.3 CLI (headless fallback) - verified from `--help`

| Command | Flags that matter |
|---------|-------------------|
| `memanto agent activate <id>` | `--hours/-h` (default 6). Unknown agent -> non-zero. This is the preflight liveness check. |
| `memanto agent auto-activate [on|off]` | no arg = show. Machine-global setting; do not flip it from the capability |
| `memanto remember [content]` | `--type/-t` (13 types: fact, preference, goal, decision, artifact, learning, event, instruction, relationship, context, observation, commitment, error), `--title`, `--confidence/-c`, `--tags a,b`, `--source/-s`, `--provenance/-p`, `--batch <file.json>`, `--from-conversation <file|->`, `--dry-run`, `--max-memories` |
| `memanto recall [query]` | `--limit/-n`, `--type/-t`, `--min-similarity`, `--min-confidence`, `--tags`, `--as-of`, `--changed-since`, `--recent`, `--active`, `--expired`, `--source/-s` |
| `memanto answer <question>` | `--limit/-n`, `--source/-s` |
| `memanto upload <file>` | `.pdf .docx .xlsx .json .txt .csv .md` |
| `memanto daily-summary` | `--date`, `--agent/-a`, `--output/-o` |
| `memanto detect-conflicts` | `--date`, `--agent/-a`; writes `~/.memanto/conflicts/<agent>_<date>_conflicts.json` |
| `memanto conflicts` | `--list/-l` (non-interactive), `--date`, `--agent/-a`; resolution without `--list` is interactive TTY |
| `memanto edit|forget <id>`, `memanto memory expire|restore <id>`, `memanto memory export|sync`, `memanto policy *`, `memanto schedule enable|disable|status` | see `--help`; `forget` needs `--force` headless |

### 2.4 REST (optional, explicit-agent alternative to the CLI for writes)

### 2.5 Semantics that change requirements

- **`detect-conflicts` is per agent + per DATE, not per topic**: it compares that day's session memories against history (`memanto/app/services/daily_analysis_service.py:411-418`). PROJECT.md's "runs for the phase topic" cannot be implemented literally; run it for the current date after capture and surface the resulting conflicts at discuss. Roadmap should reword the requirement.
- `memanto connect claude-code` also writes CLAUDE.md instructions, skills and session hooks, overlapping GSD's own orchestration. The capability must never call `connect`; document it as a user prerequisite and test that GSD works with or without it.
- Namespaces are per agent (`memanto_agent_<id>`). Use a project agent id from config; create with `memanto agent create <id> --pattern project` (mutating, owner/CI step, not the capability).
- Session TTL default 6h; the preflight gate re-activates (`agent activate`) at each lifecycle point so expiry is invisible.

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js, CommonJS (`.cjs`) | `>=24` (gsd-core `engines.node >=24.0.0`; dev machine has 26.13) | ALL capability code: command module, gate scripts, helpers | The loader `require()`s the command module from the bundle in-process and only accepts a bare `.cjs` basename; no build step is possible because install is copy-only. Zero dependencies means zero `node_modules`, avoiding the symlink-refusal and 16 MiB hash cap. Matches gsd-core's own `.cjs` style. |
| `capability.json` v1 envelope | `version` 0.1.0, `engines.gsd >=1.20.1 <2.0.0` | Capability definition | Verified against the 1.20.1 validator and installed end to end; 1.22.0 is the latest upstream. |
| `node:child_process.spawnSync` | built-in | Call `memanto` CLI synchronously from the command family | Command routers must be sync; async routers are rejected (`gsd-tools.cjs:636-641`). |
| `memanto` CLI | `>=0.3.0 <0.4.0` | Headless transport and non-MCP features | Owner decision; only surface for upload, conflicts, daily-summary, expiry, policy. |
| `memanto-mcp` | `0.1.5` | Interactive transport (7 tools) | Official server; takes explicit `agent_id`. |

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:test` + `node:assert/strict` | built-in | Test runner | All tests; same as gsd-core (`node --test tests/*.test.cjs`, `scripts/run-tests.cjs`) |
| gsd-core's own `capability-validator.cjs` / `capability-loader.cjs` | installed copy, path via `GSD_CORE_DIR` (default `~/.claude/gsd-core`) | Contract tests | `require()` it directly: `validateCapability`, `validateAgainstContract`, `validateConsumesGlobal`, `validateCrossCapability`, `loadRegistry({includeInstalled:true, cwd, gsdHome})`. Tests the real loader, so schema drift is caught when GSD updates. |
| Fake `memanto` executable | repo fixture (Node script on a temp `PATH`) | Hermetic CLI tests | Records argv, returns scripted exit codes; asserts the activate-before-call ordering and fail-closed behaviour |
| `c8` | `^11` (as gsd-core) | Coverage, optional | Only if a coverage floor is wanted |

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `node --test` | unit + contract tests | no config file; `test/*.test.cjs` |
| E2E harness script | temp project + isolated `GSD_HOME` -> `gsd-tools capability install ... --scope project --yes` -> `loop render-hooks <point> --raw` -> run gates/commands | This is the exact flow used to verify this research; always set `GSD_HOME` to a temp dir so the real consent store is untouched |
| Live tests | opt-in `MEMANTO_LIVE=1`, agent from `MEMANTO_TEST_AGENT` (dev name only, never a shipped default) | Run against the dev agent per PROJECT.md; skipped by default so CI stays hermetic |
| CLI drift test | snapshot of `memanto <cmd> --help` option names, compared when `memanto` is present | CLI is pre-1.0 and text-only; catches renamed flags |

## Installation

# Memanto prerequisites (user/CI, not the capability)

# Capability, per project (local dev path, then published spec)

# Dev

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| Node `.cjs`, zero deps | TypeScript compiled to `.cjs` | Never for a copy-only bundle: build output would have to be committed and hashed |
| Node `.cjs` | Python (match Memanto) or shell | Command modules must be `.cjs` in-process; a Python gate adds an interpreter dependency. Shell is acceptable only as a one-line gate that `exec`s node |
| `node:test` | Vitest/Jest | Would add `node_modules` (symlinks in `.bin` break install) |
| Gates (`command-exit-zero`) for enforcement | `agentVerdict` gates | agentVerdict is forced non-blocking (`:3083`) |
| Contributions + `ref.command` | Skills at project scope | Skills are not staged for project scope (`install-profiles.cjs:741`); use skills only if the owner accepts a global install |
| CLI headless (owner-mandated) | REST `/api/v2/agents/{id}/...` | Choose REST for write paths if the global-active-agent race is judged unacceptable; JSON output and explicit agent per request |
| npm package with `files` whitelist, sha512 pinned | Direct git install | Git install copies `.git`, `.planning`, tests; fine for dev, avoid for release |

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `execute:pre` hooks | Not dispatched by any released gsd-core (<=1.22.0); declared hooks silently never run | `plan:post` gate, `execute:wave:pre` contribution/step |
| `skills[]` / `ref.skill` at project scope | Third-party skills only stage from the global overlay root | Contributions + `ref.command` |
| `agents[]` / `ref.agent` | Never staged for third-party capabilities | Command family + contributions |
| `hooks[]`, `mcpServers` in manifest | Need `--shared-file` settings edits, bigger consent surface, marker key injected | `memanto connect` (user step) |
| `query` gates | Resolve only to first-party `gsd_run check` ids | `predicate: command-exit-zero` |
| Producing `MEMORY-RECALL.md` (or any first-party artifact name) at the same point | duplicate-producer throws; the whole capability is dropped | `MEMANTO-RECALL.md` etc. |
| Writing caches/locks/state inside the bundle dir | Changes the bundle hash and deactivates the capability | `<root>/.gsd/capability-data/memanto/` |
| Async command router, `child_process.exec` promises | Async routers are rejected | `spawnSync` |
| Parsing `memanto` Rich output | No JSON mode; format is presentation | Exit codes; REST for structured data |
| `memanto login|logout|use|connect` from the capability | Out of scope (backend/tool config) and `connect` rewrites CLAUDE.md/hooks | Document as prerequisites |
| `memanto agent auto-activate on` from the capability | Machine-global setting affecting every Memanto client | Re-`activate` in the preflight gate |
| Shipping `memanto-dev` or any default `memanto.agent_id` | Owner constraint; no implicit namespace | Default `""` and a blocking preflight when empty |
| Symlinks or `node_modules` in the bundle | Install aborts on any symlink | Zero-dependency files only |

## Stack Patterns by Variant

- Contribution fragments instruct the agent to call `mcp__memanto__recall|answer|remember` with explicit `agent_id`; gate scripts still run via CLI for session activation.
- Because the fail-closed check cannot see MCP, the fragment must also require the agent to halt on any `status != "ok"` tool result.
- `ref.command` steps call `gsd_run memanto <sub> --phase N`, which calls the `memanto` CLI via `spawnSync` after `agent activate`; exit code != 0 -> non-zero exit -> blocks.
- Project scope (owner goal) -> no skills/agents; per-machine consent.
- Global scope -> would enable skills, but breaks per-project identification expectations and needs surface re-apply.

## Version Compatibility

| Package A | Compatible With | Notes |
|-----------|-----------------|-------|
| capability `engines.gsd` `>=1.20.1 <2.0.0` | gsd-core 1.20.1 (installed, verified) .. 1.22.0 (latest) | `execute:pre` becomes usable only after a release containing upstream #5848 |
| `memanto` 0.3.0 | `memanto-mcp` 0.1.5 (`memanto>=0.2.31`) | pin CLI `>=0.3.0 <0.4.0` in preflight (`memanto --version`) |
| Node >=24 | gsd-core 1.22.0 `engines.node` | dev machine Node 26.13.0 |

## Gaps and Phase Research Flags

- Per-point dispatch matrix (1.5) is from workflow prose; phase 1 needs a probe capability that declares every kind at every point and records which fire (especially `verify:post`/`ship:post` contributions and `ship:pre` steps).
- Skill staging on a global install (re-apply command, runtime coverage) was not exercised; only needed if skills are reintroduced.
- CLI-vs-REST decision for headless writes (race on the machine-global active agent) needs an owner call; both are documented above.
- `memanto-mcp` is not installed locally; MCP tool behaviour is from upstream source, not a live call. Confirm `pipx inject` flow and that `memanto connect claude-code` succeeds without overwriting a hand-written `.mcp.json`.
- `ConflictResolveRequest.action` accepted values were not confirmed (fields known: `date, conflict_index, action, manual_content, manual_type`).
- Whether `memanto agent activate` for a nonexistent id exits non-zero in 0.3.0 is inferred from `_error()` handling, not observed (would require a mutating-adjacent call).

## Sources

- HIGH (installed source): `~/.claude/gsd-core/bin/lib/capability-loader.cjs`, `capability-validator.cjs`, `capability-source.cjs`, `capability-lifecycle.cjs`, `capability-consent.cjs`, `capability-command-router.cjs`, `capability-activation.cjs`, `capability-registry.cjs` (mempalace entry at line 2673), `gate-predicate-evaluator.cjs`, `gate-predicate.cjs`, `install-profiles.cjs`, `loop-host-contract.cjs`, `bin/gsd-tools.cjs`, `references/loop-hook-dispatch.md`, `workflows/*.md`
- HIGH (empirical): scratch install/render/gate runs described at the top of this file
- HIGH (upstream docs, `github.com/open-gsd/gsd-core`): `docs/reference/capability-manifest.md`, `docs/how-to/develop-a-capability.md`, `docs/explanation/capability-trust-model.md`, `docs/tutorials/build-your-first-capability.md`, `docs/adr/1244-capability-ecosystem.md`, `docs/adr/2008-command-exit-zero-gate.md`; releases v1.20.1-v1.22.0
- HIGH (Memanto, `github.com/moorcheh-ai/memanto` v0.3.0): `memanto/cli/commands/*.py`, `memanto/cli/connect/mcp_setup.py`, `memanto/app/routes/*.py`, `memanto/app/services/daily_analysis_service.py`, `integrations/mcp/{README.md,pyproject.toml,memanto_mcp/{tools,lifecycle}.py}`
- HIGH (live, read-only): `memanto --help` and every subcommand help, `memanto status`, `memanto agent list`, `GET localhost:8000/health`, PyPI JSON for `memanto` and `memanto-mcp`
- MEDIUM: `pipx inject` install path for `memanto-mcp` (standard pipx behaviour, not run)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

Conventions not yet established. Will populate as patterns emerge during development.
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

Architecture not yet mapped. Follow existing patterns found in the codebase.
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd-fast` for a trivial task inline, with no subagents and no PLAN.md
- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
