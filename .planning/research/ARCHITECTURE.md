# Architecture Patterns

**Domain:** third-party installable opengsd/gsd-core capability that makes Memanto the GSD project-memory provider
**Researched:** 2026-11-20
**Overall confidence:** MEDIUM-HIGH (loader/resolver/validator mechanics read from source: HIGH; third-party command dispatch, project-scope skill staging, Memanto session semantics under concurrent projects: MEDIUM, spike required)

Path shorthand: `L/` = `~/.claude/gsd-core/bin/lib/` (installed gsd-core 1.20.1). `SRC/` = `~/projects/gsd-core` (1.22.0 source checkout, used for docs, `.cts` sources and `scripts/`). `M/` = `~/.local/share/uv/tools/memanto/lib/python3.14/site-packages/memanto/` (Memanto 0.3.0).

## Executive Findings (read these first)

1. **The manifest has no way to express "block". Only a `gate` with `blocking: true` can.** Steps are advisory by construction (`~/.claude/gsd-core/references/loop-hook-dispatch.md:78-80`; `SRC/docs/reference/capability-manifest.md:82`). `onError: "halt"` is a legal value on steps and contributions (`L/capability-validator.cjs:181`, `:3018`, `:3058`) but the dispatch contract only promises "best-effort ... honoring onError" for them. Fail-closed therefore has to be built as **gates plus a capture ledger**, not as halting steps.
2. **Gates can only run first-party `query` checks or a `predicate`.** `agentVerdict` is forced non-blocking (`L/capability-validator.cjs:3082-3086`). The only third-party-usable blocking check is `predicate.kind = "command-exit-zero"`, which runs `sh -c <command>` at the project root with a 30s default timeout (`L/gate-predicate-evaluator.cjs:41,66`; `L/gate-predicate.cjs:55-58`). Non-zero exit = `block: true`. The command may only interpolate `${PHASE_NUMBER}`, `${PHASE_DIR}`, `${PHASE_REQ_IDS}`. **`${GSD_CAP_DIR}`, used in `SRC/docs/how-to/command-exit-zero-gate.md:33,61`, is not defined anywhere in source** (zero hits in `SRC/src`, `SRC/gsd-core/bin`, `SRC/scripts`). The gate command must resolve the bundle path itself.
3. **Gates are not dispatched at every point, and the loader does not check.** `validateHooksWired` (`L/capability-validator.cjs:3800-3865`) runs only in the first-party build generator. `loadRegistry` never calls it (`L/capability-loader.cjs:684-841`), so an overlay hook at an undispatched kind is silently dropped. Dispatched kinds per point (1.22.0 `getWiredKinds`, computed): `discuss:pre/post`, `plan:pre/post`, `execute:post`, `execute:wave:post`, `execute:pre`: contribution+gate+step; `execute:wave:pre`: contribution+step; `verify:pre`: contribution+gate+step; **`verify:post`: step only**; `ship:pre`: gate+step; **`ship:post`: step only**. On installed 1.20.1, **`execute:pre` has no `render-hooks` call site at all** (`~/.claude/gsd-core/workflows/execute-phase.md:3` only lists it in frontmatter; call sites are at `:207,619,984`); the dispatch was added in 1.22.0 (`SRC/CHANGELOG.md:29`, #5848/#6082).
4. **Loader failures fail OPEN for gates.** A capability that fails validation, `engines.gsd`, fragment materialization, or buildRegistry composition is skipped; its gates become a stderr warning, not a block (`L/loop-resolver.cjs:487-534`; `L/capability-loader.cjs:655-662,927-955`). A project-scope overlay with no consent record on the machine is silently inactive (`L/capability-loader.cjs:770-794`). "Block always" is therefore only true for a *loaded, consented, enabled* capability. This is a hard limit of the platform and must be stated in the docs and covered by a doctor check.
5. **Third-party `agents[]` are never staged** (`SRC/docs/explanation/capability-trust-model.md:250-258`). `mempalace`'s `ref.agent` curator pattern (`L/capability-registry.cjs:2806-2817`) is not reproducible. Use skills and the `commands` family only.
6. **Third-party skills are staged only from the GLOBAL overlay root** (`SRC/src/install-profiles.cts:764-766`: `capDir = $GSD_HOME/.gsd/capabilities/<id>`, `skills/<stem>/SKILL.md`), and a capability whose declared skills are absent from the runtime skills dir reads `enabled=false`, which makes every hook inactive (`L/capability-state.cjs:118-140,153`; `L/loop-resolver.cjs:147-161`). PROJECT.md says "installed into a project's `.gsd/capabilities/memanto`". With skills declared, a project-scope install may be dead on arrival. **Spike this first** (see Build Order, Phase 0).
7. **Memanto's CLI has one machine-global "active agent".** `remember`, `recall`, `answer`, `upload`, `status` have no `--agent` flag (verified via `--help`); only `daily-summary` and `detect-conflicts` do. `auto-activate on` is also machine-global: "Applies to every tool on this computer" (`M/cli/commands/agent.py:158-185`). Two projects with different `memanto.agent_id` on one machine can cross-write unless every call re-pins the agent. The MCP server, by contrast, is pinned per registration via env `MEMANTO_DEFAULT_AGENT_ID` (`M/cli/connect/mcp_setup.py:60-70`).

## Recommended Architecture

Three layers, with deterministic code at the boundary and the LLM only where judgement is required.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ gsd-core host loop (UNMODIFIED)   loop render-hooks <point> → activeHooks │
│  discuss:pre/post  plan:pre/post  execute:wave:post  execute:post         │
│  verify:pre  verify:post  ship:pre  ship:post                             │
└───────┬───────────────┬──────────────────┬───────────────────────────────┘
        │ gate          │ contribution     │ step
        ▼               ▼                  ▼
┌──────────────┐ ┌──────────────┐ ┌─────────────────────────────────────────┐
│ GATE LAYER   │ │ PROMPT LAYER │ │ ACTION LAYER                            │
│ sh -c node   │ │ fragments/   │ │ ref.skill  → skills/<stem>/SKILL.md (LLM)│
│ scripts/     │ │ *.md inline  │ │ ref.command→ `gsd_run memanto <sub>`    │
│ gate.cjs     │ │ into orch /  │ │              (sync node router, det.)   │
│ (blocking)   │ │ planner /    │ │                                         │
│              │ │ verifier     │ │                                         │
└──────┬───────┘ └──────┬───────┘ └───────┬─────────────────┬───────────────┘
       │                │                 │ MCP (interactive)│ CLI (headless)
       ▼                ▼                 ▼                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│ lib/memanto-core.cjs  (shared by gate.cjs and the command router)         │
│  config read (same precedence as gsd) · preflight · pin/activate agent ·  │
│  ledger (.planning/memanto/ledger.jsonl) · CLI wrapper (spawnSync)        │
└──────────────────────────────────┬───────────────────────────────────────┘
                                   ▼
        memanto CLI ─► local REST (localhost:8000) ─► backend (cloud|on-prem|local)
        memanto-mcp (stdio, pinned to MEMANTO_DEFAULT_AGENT_ID)  ─► same REST/backend
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| `capability.json` | Declares id/version/engines, config slice, steps, contributions, gates, skills, commands. Pure data; validated by the real loader. | gsd-core loader/resolver only |
| Gate layer: `scripts/gate.cjs` | Single blocking authority. Per-point checks: mutual exclusion, config sanity, Memanto preflight, ledger completeness. Exit 0 pass / non-zero block, message on stderr/stdout (tail is surfaced, 2000 char cap, `L/gate-predicate-evaluator.cjs` trimToMax). | `lib/memanto-core.cjs`; gsd gate dispatcher via `sh -c` |
| Command family `memanto` (`commands/memanto.cjs`, router `routeMemantoCommand`) | Deterministic, synchronous subcommands called as `gsd_run memanto <sub> --phase N --raw`: `preflight`, `activate`, `recall`, `detect-conflicts`, `upload`, `daily-summary`, `ledger`, `doctor`. Real exit codes via `error()`. | `lib/memanto-core.cjs`; Memanto CLI |
| Skills `memanto-recall`, `memanto-capture-decisions`, `memanto-capture-fixes`, `memanto-conflicts` | LLM-judgement work: choose what to recall, distill decisions and confirmed problem to fix pairs, run the owner conflict dialogue. Thin: mechanics are delegated to MCP tools or `gsd_run memanto ...`. | Agent runtime, MCP tools `mcp__memanto__*`, or the command family |
| Contributions (`fragments/*.md`) | Inject recall/conflict/capture instructions into `orchestrator`, `planner`, `verifier` prompts. Data, not control flow. | Host prompts |
| `lib/memanto-core.cjs` | One implementation of: gsd config-key resolution, preflight state machine, agent pinning, CLI invocation with timeout, ledger IO. Zero dependencies (node built-ins only: bundle is copied verbatim and content-hashed). | Memanto CLI, `.planning/` |
| `COVERAGE.md` + `coverage/` tests | Decision record: every Memanto CLI/REST/MCP feature INTEGRATE or OPT-OUT with reason. Reuses the gsd `api-coverage` table format (`| capability | decision | reason |`). | Test harness (parse + completeness) |
| Test harness (`test/`) | Loads the manifest through the real `loadRegistry`, resolves hooks through the real `loop render-hooks`, runs gate/command scripts against a stub `memanto`. | gsd-core package (devDependency), stub CLI, optional live `memanto-dev` agent |

### Recommended bundle layout

```
gsd-memanto/                          # repo root == published bundle root (see note)
├── capability.json                   # id: "memanto" (folder name MUST equal id: L/capability-validator.cjs:347-351)
├── fragments/
│   ├── recall-discuss.md             # contribution → orchestrator @ discuss:pre
│   ├── conflicts-discuss.md          # contribution → orchestrator @ discuss:pre
│   ├── recall-plan.md                # contribution → planner @ plan:pre
│   ├── capture-fixes-wave.md         # contribution → verifier @ execute:wave:post
│   └── interface-selection.md        # shared MCP-vs-CLI rules (inlined into each fragment at build)
├── skills/
│   ├── memanto-recall/SKILL.md       # layout fixed by SRC/src/install-profiles.cts:766
│   ├── memanto-capture-decisions/SKILL.md
│   ├── memanto-capture-fixes/SKILL.md
│   └── memanto-conflicts/SKILL.md
├── memanto.cjs                       # command-family router; `commands[0].module` must be a bare basename (L/capability-validator.cjs:456-470), so it lives at the bundle root
├── scripts/gate.cjs                  # predicate command target
├── lib/memanto-core.cjs              # required relatively by memanto.cjs and gate.cjs
├── COVERAGE.md
├── README.md  LICENSE
└── test/
    ├── fixtures/ stub-memanto/  (fake `memanto` executable on PATH)
    ├── manifest-load.test.cjs  hooks-resolve.test.cjs  gate.test.cjs  exclusivity.test.cjs
    └── live/ (opt-in, MEMANTO_LIVE=1, agent from env, never defaulted)
```

Notes on layout:
- **Module path correction.** `commands[].module` must match `/^[A-Za-z0-9._-]+\.cjs$/` (bare basename, no separators; `L/capability-validator.cjs:456-470`). Put `memanto.cjs` at the bundle root; `lib/` and `scripts/` are reached by relative `require` inside the bundle (confinement is only enforced on the entry module, `gsd-tools.cjs:550-556`).
- **Fragments**: `fragment.path` is materialized into `fragment.inline` at load (`L/capability-validator.cjs:2820-2884`), confined to the capability dir, 8 MiB cap. Prefer `path` for anything longer than a sentence. Because shared text cannot be `include`d, inline the MCP-vs-CLI block at build time (a small script) rather than duplicating by hand.
- **Repo-as-bundle.** Installing from git/npm/path copies the bundle; keep dev-only files (`test/`, `.planning/`) out via `files`/ignore so `bundleContentHash` (consent binding, `L/capability-loader.cjs:777`) is stable and small. `.pyc`/`__pycache__` paths are refused for executable surfaces (`L/capability-validator.cjs:233-234`); irrelevant here but do not ship Python.
- No `hooks[]` (settings.json hook scripts) and no `agents[]`. `mcpServers` is not a validated feature-body field (zero hits in `L/capability-validator.cjs`); the MCP server is registered by the user via `memanto connect` (mutating user tool config: OPT-OUT in COVERAGE.md, remediation text only).

### Manifest skeleton (shape only; every field below is required by the validator unless noted)

```jsonc
{
  "id": "memanto", "role": "feature", "version": "0.1.0",
  "title": "Memanto memory", "description": "…", "tier": "full", "requires": [],
  "engines": { "gsd": ">=1.20.1" },            // see "Version envelope"
  "runtimeCompat": { "supported": ["*"], "unsupported": [] },
  "skills": ["memanto-recall", "memanto-capture-decisions", "memanto-capture-fixes", "memanto-conflicts"],
  "agents": [],                                  // required array; keep empty
  "commands": [{ "family": "memanto", "module": "memanto.cjs", "router": "routeMemantoCommand",
                 "subcommands": ["preflight","activate","recall","detect-conflicts","upload","daily-summary","ledger","doctor"] }],
  "activationKey": "memanto.enabled",            // must be declared in config (L/capability-validator.cjs:714-723)
  "config": { /* see Config Gating */ },
  "steps": [ /* see Data Flow */ ], "contributions": [ /* … */ ], "gates": [ /* … */ ]
}
```
Hard schema facts: `steps[].produces/consumes/onError` and `gates[].blocking/onError/check` are all required (omission fails validation: `L/capability-validator.cjs:2982-3020,3065-3100`); `contributions[].produces/consumes/fragment` required, `onError` optional (`:3025-3063`); `runtimeCompat`, `skills`, `agents`, `config`, `steps`, `contributions`, `gates` must all be present (`:558-698`); `id` must not start `gsd-`/`gsd-core-`/`anthropic-` (`L/capability-loader.cjs:78,679-682`); skill stems in `ref.skill` must be unprefixed and declared (`:2951-2967`); `when`/`pointFrom` must name a key in this capability's own `config` (`L/capability-validator.cjs:3137-3206`).

## Config Gating (enabled, explicit agent_id with no default, per-hook toggles)

Config keys are dotted, federated, globally unique, and must not exist in the central schema (`L/capability-validator.cjs:3411-3461`); first-party precedent is `mempalace.enabled` (`L/capability-registry.cjs:2699`). Use the `memanto.*` prefix. `.planning/config.json` nested JSON (`{"memanto":{"enabled":true}}`) overrides defaults (`L/capability-activation.cjs:75-108`) and `config-loader.cjs:478` already loads overlay schemas, so `config-set memanto.agent_id …` validates.

| Key | Type / default | Role |
|-----|----------------|------|
| `memanto.enabled` | boolean / `false` | **Capability-level `activationKey`.** Cascades to every hook: `active = enabled && configActivation` (`L/capability-state.cjs:147-153`), and the resolver only renders hooks of active capabilities (`L/loop-resolver.cjs:147-161,211-212,248-249,283-284`). Do NOT repeat it in per-hook `when`. |
| `memanto.agent_id` | string / `""` | **"No default" is expressed as the empty string.** `default` is mandatory in a slice (`L/capability-validator.cjs:109-113`), so true absence is impossible. `""` is falsy, so it can be used by the gate to refuse. Never put `memanto-dev` here. |
| `memanto.interface` | enum `auto\|mcp\|cli` / `auto` | `auto` = MCP when `mcp__memanto__*` tools exist in the session, else CLI. |
| `memanto.recall_on_discuss`, `recall_on_plan`, `detect_conflicts_on_discuss`, `capture_decisions`, `capture_problem_fixes`, `upload_artifacts`, `daily_summary` | boolean / `true` | **Per-hook toggles.** Each hook's `when` names exactly one of these. `when` is a plain truthy test on ONE key (`L/capability-activation.cjs:109-112`), no AND/OR, no equality. |
| `memanto.schedule_summary` | boolean / `false` | Consent-style opt-in for `memanto schedule enable` (machine-global side effect). |
| `memanto.timeout_seconds` | number / `30` | Bound for CLI calls and for the gate (`predicate.timeout`). |

**Gotcha: an inactive hook is silent, not blocked.** `when: "memanto.recall_on_discuss"` false means the hook never renders. That is the intended meaning of a per-hook toggle. The fail-closed behavior must live in a hook whose `when` is absent (gates carry no `when`, so they run whenever the capability is active). Consequence: `enabled=true` with `agent_id=""` still renders the gates, and the gate refuses. Do not put `when: "memanto.agent_id"` on anything: that would turn "misconfigured" into "silently off".

## Failure Semantics: block always, expressed with what the loader supports

Supported values: `onError ∈ {"skip","halt"}` only (`L/capability-validator.cjs:181`). Blocking is `gate.blocking: true` only; two-step gate contract: (1) check command itself fails (non-zero exit incl. exit 69 UNAVAILABLE) is routed by `onError`; (2) exit 0 plus `block: true` halts if `blocking` (`loop-hook-dispatch.md:111-124`).

Rules for this capability:

1. **Every gate: `blocking: true`, `onError: "halt"`.** For `command-exit-zero` a non-zero exit of the script is a gate *result* (`block:true`), and an unevaluable predicate is a check failure routed to `halt`. Both stop the step. Never use `skip` on a gate.
2. **Gate script exit contract:** exit 0 = pass; exit 1 = policy failure (misconfig, mutual exclusion, Memanto unreachable, wrong agent, activation failed, ledger incomplete); the message must be actionable (what failed, the exact `gsd_run memanto doctor` or `memanto …` remediation). Distinguish "cannot determine" from "determined bad" only in message text; both block.
3. **Gate placement** (only points that dispatch gates): `discuss:pre` (full preflight + mutual exclusion + prior-phase ledger), `plan:pre` (preflight, recall freshness), `execute:wave:post` (ledger entry for the wave's problem to fix pairs), `verify:pre` (preflight), `ship:pre` (**completeness gate**: every required capture for this phase is `ok` in the ledger). Add `plan:post` and `execute:post` ledger gates if capture steps run there. Skip `execute:pre` (not dispatched on 1.20.1).
4. **Capture at non-gate points is made fail-closed by deferral, not by halting.** `verify:post` and `ship:post` dispatch steps only, and steps are advisory. A failed capture there cannot stop that point. Pattern: **append-only ledger plus next-gate check.** Each capture step writes `pending` then `ok|failed` entries to `.planning/memanto/ledger.jsonl`; the next gate (`ship:pre` for verify:post captures, the next phase's `discuss:pre` for ship:post captures) exits non-zero while any required entry is not `ok`. The failure surfaces as a hard block at the earliest dispatchable gate.
5. **Step `onError`:** set `"halt"` on capture/recall steps to state intent and get best-effort stop, but never rely on it (documented advisory).
6. **Known fail-open holes (document, detect, do not pretend otherwise):** loader skip (bad manifest, engines mismatch, fragment unreadable) → gate silently not enforced + stderr warning (`L/loop-resolver.cjs:487-534`); unconsented project overlay → inactive (`L/capability-loader.cjs:783-793`); declared skills missing from runtime → `enabled=false` → inactive (`L/capability-state.cjs:140`); `memanto.enabled` false → off by design. Mitigation: `gsd_run memanto doctor` (and a skill-body first step) reports "capability expected enabled but gates not rendering" by comparing config to `gsd_run capability state --raw`, and the README makes `gsd capability list` + `loop render-hooks ship:pre` part of install verification.
7. **Trust note:** gate `check` bodies are NOT in the install consent disclosure (`loop-hook-dispatch.md:90-95`). Ship a `commands` family so the executable code is disclosed and consent-bound, and keep `gate.cjs` thin and in the same hashed bundle.

### Gate command (path resolution without `${GSD_CAP_DIR}`)

The subprocess cwd is the project root (`L/gate-predicate.cjs` header: "runs at the runtime project root"). Resolve project install first, then global:

```
"command": "d=.gsd/capabilities/memanto; [ -f \"$d/scripts/gate.cjs\" ] || d=\"${GSD_HOME:-$HOME}/.gsd/capabilities/memanto\"; exec node \"$d/scripts/gate.cjs\" --point discuss:pre --phase \"${PHASE_NUMBER}\" --phase-dir \"${PHASE_DIR}\""
```
Single argv element, ≤4096 chars (`gate-predicate-evaluator.cjs` COMMAND_MAX_LENGTH), `timeout` set from the longest expected preflight (activation can take seconds; use 60). `sh` is required (fails closed 127 on Windows without it).

## Mutual Exclusivity with `mempalace` (capability-level only)

The schema offers `requires` (positive only, must exist, acyclic, tier-monotone; `L/capability-validator.cjs:3550-3615`) and no `conflicts`/`excludes` field. Enforcement is therefore runtime, layered, and refuses rather than prevents:

1. **Gate (authoritative).** `gate.cjs` runs the exclusion check first, at every gate point. It resolves `mempalace.enabled` with the same precedence gsd uses (nested `config.json` in workstream dir, then root, then default false; `L/capability-activation.cjs:75-108`) and exits 1 with "MemPalace and Memanto are mutually exclusive: disable one (`gsd-tools config-set mempalace.enabled false` / `memanto.enabled false`)" when both are truthy. Because `memanto.enabled` is the `activationKey`, the gate only exists while Memanto is on, which is exactly when the conflict matters; with Memanto off MemPalace is untouched.
2. **`discuss:pre` orchestrator contribution** repeats the refusal in prose for the interactive agent (data, not enforcement).
3. **`gsd_run memanto doctor`** reports the same check, for headless/CI use.
4. **Tests** assert the gate blocks for `{memanto.enabled:true, mempalace.enabled:true}` on both nested-JSON forms and on workstream-vs-root precedence.
5. **Limits to document:** the capability cannot veto `config-set` and cannot disable MemPalace's own hooks; it halts the loop at the first gate instead, which is the "refused" behavior PROJECT.md asks for. Do not read `mempalace.*` through any private API: use the config-file read only (stable, documented precedence).

## Session Auto-Activation Flow

Facts (Memanto 0.3.0, read from source): `agent activate <id>` creates a session (default 6h, `--hours`) and writes the *machine-global* active session (`M/cli/commands/agent.py:107-131`); `auto-activate on|off` renews/restarts sessions and "resumes the last active agent when none is active", also machine-global (`:158-185`); `get_client` restores whichever agent is active and re-activates that same agent on expiry only when auto-activate is on (`M/cli/commands/_shared.py:112-146`). REST is agent-scoped (`POST /agents/{agent_id}/activate`, `POST /{agent_id}/remember|recall|answer|…`, `GET /status`, `/health`; `M/app/routes/sessions.py:275,342`, `M/app/routes/memory.py`).

Design: **pin, then verify, then act, in one process.**

```
core.ensureSession(agentId):
  0. config check: agentId non-empty, not "memanto-dev" unless explicitly set by the owner (no default ever shipped)
  1. `memanto status` (or REST /health) → backend reachable?      else FAIL(unreachable)
  2. agent exists? (`memanto agent list`)                          else FAIL(no such agent; remediation: `memanto agent create <id>` is OWNER-run)
  3. `memanto agent activate <agentId>` (idempotent, cheap)        else FAIL(activation failed)
  4. verify active agent == agentId (parse `memanto status`/`config show`; fall back to REST GET /status)  else FAIL(wrong agent: another project changed it)
  5. report auto-activate state (informational). Never flip it silently.
```
- Run `ensureSession` in every gate and at the start of every command-family subcommand and every CLI-mode skill. Because step 3 is idempotent and step 4 verifies, session expiry is invisible regardless of `auto-activate`.
- **Do not auto-enable `auto-activate`.** It is machine-global and changes behavior of every other Memanto client on the box. Offer it as an owner-run recommendation printed by `doctor`/preflight; record it in COVERAGE.md as INTEGRATE-as-check, OPT-OUT-as-mutation with that reason. (PROJECT.md lists `auto-activate` under the requirement; this is the conflict to resolve with the owner: recommend "verify + recommend", not "set".)
- **Cross-project race:** two projects pinning different agents interleave activations. Mitigations in order of strength: (a) `daily-summary` and `detect-conflicts` take `--agent` → race-free, always pass it; (b) hold a short advisory lock (`~/.memanto/.gsd-pin.lock` via `mkdir`-style lock) across pin+verify+call for `remember/recall/answer/upload`; (c) interactive mode prefers MCP, which is pinned per registration and does not use the global marker; (d) document the residual race. This is a Phase-0/1 research flag.

## MCP vs CLI dispatch (interactive vs headless)

gsd-core has no "interactive?" flag exposed to capabilities; `mempalace` uses prose ("Interactive run → call `mempalace_search` …; Headless/cron run (no MCP server) → CLI", `L/capability-registry.cjs:2825`). Same pattern, made deterministic:

- **Skills and fragments** carry a standard first block: "If tools named `mcp__memanto__*` are available in this session AND `memanto.interface` ≠ `cli`, use them; else use `gsd_run memanto <sub>` (CLI wrapper). If `memanto.interface = mcp` and the tools are absent, that is a failure: STOP and report."  `mcp` explicit + tools missing blocks; `auto` falls back to CLI.
- **MCP agent binding check.** The MCP server is pinned by `MEMANTO_DEFAULT_AGENT_ID` in the client config (`M/cli/connect/mcp_setup.py:60-70`). Before the first MCP write in a run, the skill must confirm the server's agent equals `memanto.agent_id` (call a status/identity tool, or fall back to CLI if it cannot be proven). A mismatch is a hard failure, never "write anyway".
- **Command family is CLI-only and headless-safe**: `gsd_run memanto …` always uses the Memanto CLI through `spawnSync` with a timeout. The router MUST be synchronous: async routers are rejected (`gsd-tools.cjs:636-641`). It is invoked as `router({ args, cwd, raw, error })` (`gsd-tools.cjs:627`); `args[0]` is the family, `args[1]` the subcommand; failures via `error(msg, reason)` (throws ExitError), success prints JSON.
- **Step shapes:** LLM-judgement steps use `ref.skill`; mechanical steps (upload, daily-summary, detect-conflicts report generation, ledger flush) use `ref.command: "memanto <sub>"`; dispatched as `gsd_run ${ref.command} --phase "${PHASE_NUMBER}" --raw` after in-context validation against `^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$` (`loop-hook-dispatch.md:45-56`). Keep subcommand names kebab-case.
- Command dispatch requires a **committed ledger entry** (installed through `gsd capability install`) and, for project scope, a consent record (`L/capability-loader.cjs:895-896`). A bundle merely copied into `.gsd/capabilities/` gets declarative surfaces only, no command dispatch.

## Data Flow per Hook Point

Legend: R = read from Memanto, W = write to Memanto, G = gate, S = step, C = contribution. "ledger" = `.planning/memanto/ledger.jsonl` (local, append-only; never in Memanto). Dispatch kinds per point are from the computed wired-kinds table above.

| Point | Kinds | Hook | Memanto I/O | Notes |
|-------|-------|------|-------------|-------|
| `discuss:pre` | G, C | **G1 preflight**: mutual exclusion, config, `ensureSession`, prior-phase ledger complete. **C** `recall-discuss` (`when: memanto.recall_on_discuss`, into `orchestrator`): topic recall (`recall`, temporal `--as-of/--changed-since`, then `answer` for RAG synthesis). **C** `conflicts-discuss` (`when: memanto.detect_conflicts_on_discuss`): run `detect-conflicts --agent <id>` for the phase topic window, then `conflicts` dialogue with the owner via AskUserQuestion; resolutions written back (`conflicts/resolve`). | R (recall, answer), R/W (conflict report + resolve) | Conflicts resolved BEFORE planning consumes memory (PROJECT.md decision). `conflicts` is interactive: CLI-headless mode must record "conflicts unresolved" in ledger and let the gate at `plan:pre` block. |
| `discuss:post` | G, S | **S** `memanto-capture-decisions` (`when: memanto.capture_decisions`, `consumes: ["CONTEXT.md"]`, `produces: []`) | W `remember --type decision` (tags: phase, source file) | `produces: []` so it always runs (not skipped by fingerprint). Ledger row `{point, kind: decisions}`. |
| `plan:pre` | G, C, S | **G** preflight + "no unresolved conflicts" ledger check. **C** `recall-plan` into `planner` (`when: memanto.recall_on_plan`). Optional **S** `memanto-recall` producing `MEMANTO-RECALL.md` (`consumes: ["CONTEXT.md"]`). | R | Mirrors mempalace's `MEMORY-RECALL.md` (`L/capability-registry.cjs:2773`) but name it `MEMANTO-RECALL.md`: duplicate-producer rule is per artifact name per point (`L/capability-validator.cjs:3267-3295`) and the two capabilities are mutually exclusive anyway. |
| `plan:post` | G, S | **S** capture plan rationale (`consumes: ["PLAN.md"]`) | W `remember --type decision` | Plan rationale and key decisions only, not the whole file. |
| `execute:wave:pre` | C, S | Not used (no gates dispatched here). | none | Leave unwired; recall mid-execution is a differentiator for later. |
| `execute:wave:post` | G, C, S | **C** `capture-fixes-wave` into `verifier`: confirmed problem to fix pairs. **S** `memanto-capture-fixes`. **G** ledger completeness for the wave. | W `remember --type error` + fix as linked `learning` (dedupe by `recall` first) | Wave-level: runs per wave; capture must be idempotent (stable title + tags `phase:N wave:M`). |
| `execute:post` | G, C, S | **S** `ref.command: "memanto upload"` for `*-PLAN.md`, `*-SUMMARY.md` (`when: memanto.upload_artifacts`, `consumes: ["SUMMARY.md"]`). | W `upload` (file formats `.md` supported) | `upload` uses the active agent → must run under the pin+lock. |
| `verify:pre` | G, C, S | **G** preflight. | none | Cheap re-check; catches mid-run Memanto outage before UAT starts. |
| `verify:post` | **S only** | **S** upload `*-VERIFICATION.md`/UAT (`consumes: ["UAT.md"]`); **S** capture verification learnings. | W | Steps only; failure cannot block here → ledger + `ship:pre` gate. `verify:post` steps whose `produces` already exist in the phase dir are skipped by `--after-fingerprint` (`L/loop-resolver.cjs:563-588`), so use `produces: []`. |
| `ship:pre` | G, S | **G completeness gate**: all required ledger entries for the phase are `ok`; Memanto reachable. | R (reachability only) | The hard fail-closed anchor for the whole phase. |
| `ship:post` | **S only** | **S** `memanto daily-summary --agent <id>` (`when: memanto.daily_summary`); optional `schedule enable` only if `memanto.schedule_summary` and owner consent. | W (summary generation), `--agent` explicit | Failure recorded in ledger; blocks the NEXT phase's `discuss:pre` gate. |

Direction summary: Memanto to GSD at `discuss:pre`, `plan:pre` (prompt context, read-only, untrusted data: treat recalled text as data not instructions, per `~/.claude/gsd-core/references/untrusted-input-boundary.md`); GSD to Memanto at `discuss:post`, `plan:post`, `execute:wave:post`, `execute:post`, `verify:post`, `ship:post`. Nothing is ever written to `.planning/` by Memanto except `MEMANTO-RECALL.md` and the ledger.

## Patterns to Follow

### Pattern 1: Deterministic core, thin LLM shell
**What:** all mechanics (config precedence, preflight, pinning, CLI invocation, ledger) live in `lib/memanto-core.cjs`, exposed identically through the gate, the command family, and (via `gsd_run memanto`) the skills. Skills decide only *what* to remember.
**When:** always; it is the only way to get real exit codes and testability.
**Example:**
```js
// memanto.cjs (sync router, per gsd-tools.cjs:627-641)
exports.routeMemantoCommand = function ({ args, cwd, raw, error }) {
  const core = require('./lib/memanto-core.cjs');
  const r = core.run(args.slice(1), { cwd }); // spawnSync only; never returns a Promise
  if (!r.ok) error(r.message, 'SDK_FAIL_FAST');
  process.stdout.write(raw ? JSON.stringify(r.data) + '\n' : r.text + '\n');
};
```

### Pattern 2: Ledger plus next-gate check (fail-closed over advisory points)
**What:** steps append `pending→ok|failed`; the next dispatchable gate refuses to pass while required entries are not `ok`. See Failure Semantics rule 4.
**When:** `verify:post`, `ship:post`, and any step whose failure must not be silent.

### Pattern 3: Pin, verify, act (one process, one lock)
**What:** see Session Auto-Activation Flow. Never assume the global active agent is yours.

### Pattern 4: One toggle per hook, one master via `activationKey`
**What:** the master cascades at capability level; per-hook `when` keys are independent. Verified by `capability state` parity (`L/capability-state.cjs:187-195`).

### Pattern 5: Version envelope
`engines.gsd` is a hard gate at install and load (`L/capability-loader.cjs:723-728`). Use `">=1.20.1"` and avoid `execute:pre` so the capability works on the installed version. If `execute:pre` hooks become valuable, raise to `">=1.22.0"` (declare via `compatVersions` for graceful downgrade: `"0.1.0": ">=1.20.1"`).

## Anti-Patterns to Avoid

### Anti-Pattern 1: Halting via step `onError: "halt"`
**Why bad:** steps are advisory; the dispatcher may log and continue. Produces a false sense of fail-closed.
**Instead:** gate + ledger.

### Anti-Pattern 2: Hooks at undispatched kinds
**Why bad:** loader accepts them silently (no `validateHooksWired` at load); they never run. E.g. a gate at `verify:post`/`ship:post`, a contribution at `ship:post`, a gate at `execute:wave:pre`, anything at `execute:pre` on 1.20.1.
**Instead:** a conformance test that computes `getWiredKinds` from the gsd-core under test and asserts every declared hook is wired (see Test Harness).

### Anti-Pattern 3: `when: "memanto.agent_id"` or any "required config" in `when`
**Why bad:** converts misconfiguration into silent no-op (the opposite of fail-closed).
**Instead:** unconditioned gates that check it.

### Anti-Pattern 4: Using the machine-global active agent without verifying
**Why bad:** cross-project memory contamination; undetectable afterwards.
**Instead:** Pattern 3 plus `--agent` wherever the CLI offers it.

### Anti-Pattern 5: Relying on `${GSD_CAP_DIR}` or `gsd_run` inside a gate command
**Why bad:** `GSD_CAP_DIR` is undefined; `gsd_run` is a workflow shell function, not on `sh -c`'s PATH.
**Instead:** self-resolving `node` path (see above); share code through `lib/`.

### Anti-Pattern 6: `agents[]` (curator agent at `ship:post` like mempalace)
**Why bad:** never staged for third-party capabilities.
**Instead:** a skill (`ref.skill`) or a command step.

### Anti-Pattern 7: Auto-mutating machine-global Memanto state (`auto-activate on`, `schedule enable`, `use`, `connect`, `login`)
**Why bad:** affects every other tool/project on the machine; outside "never configures the backend" scope.
**Instead:** read-only check plus remediation text; mutation only behind an explicit owner-set key (`schedule_summary`).

## Test Harness: loading the manifest through gsd-core's real loader

Add `@opengsd/gsd-core` as a **devDependency** (package has no `exports` restriction, `SRC/package.json`: deep-require works) and also support `GSD_CORE_DIR` to point at `~/.claude/gsd-core`. CI matrix: pinned minimum (1.20.1) and latest.

```js
const lib = (p) => require(path.join(GSD_CORE, 'gsd-core/bin/lib', p));   // @opengsd/gsd-core/gsd-core/bin/lib/…
const { loadRegistry, readHostVersion } = lib('capability-loader.cjs');   // L/capability-loader.cjs:958
// Global-scope fixture: no consent record required (L/capability-loader.cjs:770 gates project scope only)
fs.cpSync(BUNDLE, path.join(tmpHome, '.gsd/capabilities/memanto'), { recursive: true });
const reg = loadRegistry({ includeInstalled: true, cwd: tmpProject, gsdHome: tmpHome, hostVersion: '1.20.1' });
assert.deepEqual(reg._overlay?.warnings ?? [], []);        // skip() reasons land here (L/capability-loader.cjs:655-662)
assert.ok(reg.capabilities.memanto);                       // accepted, composed by buildRegistry
```

Test tiers:
1. **Schema/load (real loader).** Zero `_overlay.warnings`, `blockedGates` empty; capability present in `reg.capabilities`, `reg.byLoopPoint[<point>]` has the expected hook counts; `reg.configSchema` contains every `memanto.*` key with the expected defaults (and `memanto.agent_id.default === ""`). Negative fixtures: both id collision, reserved prefix, hook at invalid point, `when` naming undeclared key, `agentVerdict` + `blocking:true`, all must produce skip warnings (proves the harness actually detects loader rejection).
2. **Resolution (real resolver).** Run the real CLI with `GSD_HOME=<tmpHome>` in a fixture project: `node <gsd-core>/bin/gsd-tools.cjs loop render-hooks <point> --raw` (resolver reads `GSD_HOME`: `L/loop-resolver.cjs:481`) with config variants: master off ⇒ zero hooks; master on ⇒ gates present at expected points; per-hook toggle off ⇒ only that hook absent. Requires the skills to be staged or `skills: []` fixture (finding 6): the harness must also run `gsd capability state --raw` and assert `active:true`; this is the test that detects the dead-on-arrival project-scope case.
3. **Wired-kinds conformance.** `require('<gsd-core>/scripts/gen-loop-host-contract.cjs').getWiredKinds(root)` (1.22.0 source ships `scripts/`; on installed 1.20.1 this function cannot be run as-is: its host file list references step files absent from the installed tree. Fall back to a grep-based table pinned per supported gsd version, and assert it against the manifest).
4. **Gate/command behavior.** Execute `gate.cjs` / `memanto.cjs` against a **stub `memanto` binary** on `PATH` (shell script driven by env vars: unreachable, no agent, wrong active agent, activate fails, success) and assert exit codes and messages; assert mutual-exclusion matrix; assert ledger completeness logic. Run each gate through the real predicate evaluator: `gsd_run check predicate --predicate '<json from manifest>' --phase-dir … --raw` (`SRC/docs/how-to/command-exit-zero-gate.md` Step 4) so the exact manifest command string, `sh -c` quoting and path resolution are tested, not a paraphrase.
5. **Consent/install (project scope).** Use real `capability-consent.recordProjectConsent` + `bundleContentHash` (`L/capability-consent.cjs` exports) to test project-scope activation, and assert that tampering a bundle file flips the capability to inactive (hash binding).
6. **Live (opt-in, `MEMANTO_LIVE=1`).** Agent id comes only from env (e.g. `MEMANTO_TEST_AGENT=memanto-dev`); the suite refuses to run if it is unset (no default); asserts remember/recall/upload round trip and cleanup by `forget`.
7. **COVERAGE.md conformance.** Parse the matrix with gsd's own validator (`L/api-coverage.cjs`, `check api-coverage.verify-pre`) plus an inventory test that enumerates `memanto --help` commands, REST routes (OpenAPI at `localhost:8000/docs`), and MCP tool names, failing when any is missing from the matrix.

## Suggested Build Order (dependencies)

**Phase 0 (spike, blocks everything): platform reality checks.** Minimal manifest (1 gate, 1 skill, 1 command) installed with `gsd capability install` into (a) global and (b) project scope against 1.20.1. Determine: are skills staged and `capability state` `active:true` in project scope; does `gsd_run memanto <sub>` dispatch; does a `command-exit-zero` gate block `discuss:pre` and `ship:pre`; what exit/stdout surfaces; where `error()` output lands. Output decides install-scope guidance, whether skills are shipped, and whether `ref.command` steps are viable.

**Phase 1: manifest + config + load harness.** `capability.json` skeleton with real config slice, harness tiers 1-2, wired-kinds table. No Memanto calls yet. Depends on: nothing. Delivers: loader-accepted bundle with correct activation semantics.

**Phase 2: `lib/memanto-core.cjs` + stub memanto + preflight/pin/ledger.** Pure logic, fully unit-testable; resolves session/pin race decision. Depends on: Phase 0 findings (agent pinning), Memanto CLI contract.

**Phase 3: gate layer (`gate.cjs`) + mutual exclusion + fail-closed gates.** Depends on 1, 2. Delivers the core value ("reliable, blocks on failure").

**Phase 4: command family (`memanto.cjs`) and read path.** Recall, answer, temporal queries, `detect-conflicts` + conflict-resolution skill/contribution at `discuss:pre`; `plan:pre` recall. Depends on 2, 3.

**Phase 5: write path.** Decisions (`discuss:post`, `plan:post`), problem to fix pairs (`execute:wave:post`), uploads, `daily-summary`, ledger + completeness gates, `schedule` opt-in. Depends on 3, 4.

**Phase 6: COVERAGE.md.** Can start after Phase 0 (enumeration) but is finalized after 5, since every INTEGRATE must map to a landed hook and every OPT-OUT to a reason. Include the inventory conformance test.

**Phase 7: end-to-end.** Full GSD cycle in a throwaway project against the dev agent; assert memories, uploads, summaries; failure-injection (stop server, wrong agent, enable mempalace) proves each block. Publish docs (`README`, install, verification commands, fail-open caveats).

## Scalability Considerations

| Concern | One dev, one project | Many projects / one machine | CI / headless cron |
|---------|----------------------|------------------------------|---------------------|
| Active-agent race | none | pin+verify+lock; `--agent` where available; prefer MCP | no MCP: CLI under lock |
| Gate latency (each gate runs `sh` + `node` + `memanto status`) | ~1s | same | keep preflight to one `status` + one `activate`; cache "verified at" for N seconds in `.planning/memanto/` to avoid repeating at back-to-back gates |
| Ledger growth | trivial | per-project file | trivial; rotate per milestone |
| Recall volume into prompts | cap results (`--limit`), summarise via `answer` | same | same |

## Integration Points

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| Memanto CLI 0.3.0 | `spawnSync` with timeout; parse stdout; verify via `status` | `agent activate`/`auto-activate` nested `--help` does not render on this install (typer quirk); verify real arg shapes by running read-only subcommands in the spike. |
| Memanto local REST (`localhost:8000`) | Optional, for health/status and agent-scoped calls; needs session token from activate | Not required in v1; CLI covers it. |
| `memanto-mcp` | Used by interactive agent when present; pinned by `MEMANTO_DEFAULT_AGENT_ID` | Registered by owner (`memanto connect`), not by the capability. |
| gsd-core | Overlay loader, resolver, gate dispatch, command family dispatch | Zero modification; version-gated via `engines.gsd`. |

## Open Questions / Research Flags

- **HIGH:** project-scope install + skills staging (finding 6). May force global install guidance or `skills: []` with command/contribution-only design.
- **HIGH:** whether `ref.command` step dispatch and the third-party command family work end to end on 1.20.1 (code path read at `gsd-tools.cjs:575-643`, not exercised).
- **MEDIUM:** exact `memanto agent activate` arg shape and `status` output format (parse robustly; prefer REST `/status` if stable).
- **MEDIUM:** how headless runs surface a gate's `message` (stdout of the `check predicate` JSON vs stderr).
- **MEDIUM:** `conflicts` is interactive (TTY); define the headless degraded behavior.
- **LOW:** Memanto MCP tool names (`mcp__memanto__*` inferred from `CLAUDE_TOOL_PERMISSION = "mcp__memanto"`, `M/cli/connect/mcp_setup.py:28`); enumerate in the spike for COVERAGE.md.

## Sources

- gsd-core 1.20.1 installed: `L/capability-loader.cjs`, `L/capability-validator.cjs`, `L/capability-state.cjs`, `L/capability-activation.cjs`, `L/loop-resolver.cjs`, `L/gate-predicate-evaluator.cjs`, `L/gate-predicate.cjs`, `L/capability-registry.cjs` (mempalace at :2673-2846), `~/.claude/gsd-core/bin/gsd-tools.cjs:550-643`, `~/.claude/gsd-core/references/loop-hook-dispatch.md`, installed workflows (`execute-phase.md`, `discuss-phase.md`, `ship.md`, `verify-work.md`): HIGH
- gsd-core 1.22.0 source: `SRC/docs/reference/capability-manifest.md`, `SRC/docs/how-to/develop-a-capability.md`, `SRC/docs/how-to/command-exit-zero-gate.md`, `SRC/docs/explanation/capability-trust-model.md`, `SRC/src/install-profiles.cts:754-783`, `SRC/scripts/gen-loop-host-contract.cjs` (`getWiredKinds`, run to produce the per-point kind table), `SRC/CHANGELOG.md:29`: HIGH
- Memanto 0.3.0 installed package source (`M/cli/commands/agent.py`, `M/cli/commands/_shared.py`, `M/cli/connect/mcp_setup.py`, `M/app/routes/*.py`) and read-only `memanto --help` output: HIGH for what is read, MEDIUM for runtime behavior (not exercised)
- https://github.com/moorcheh-ai/memanto README (architecture overview only; no tool names or endpoint list): LOW-MEDIUM
