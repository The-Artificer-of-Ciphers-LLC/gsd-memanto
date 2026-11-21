# Walking Skeleton — gsd-memanto

**Phase:** 1
**Generated:** 2026-11-20

## Capability Proven End-to-End

With the capability installed globally from the release file set and enabled in one project, the `discuss:pre` gate halts `/gsd-discuss-phase` with an actionable `memanto: BLOCKED [...]` message when the project's Memanto configuration is not usable, and lets the run continue once every check passes.

The skeleton path, end to end:

1. `tools/stage-bundle.cjs` stages exactly the `npm pack --dry-run --json` file set (the `files` whitelist) into a temp directory.
2. `gsd-tools capability install <stagedDir> --yes` installs it globally into `$GSD_HOME/.gsd/capabilities/memanto` and writes the gsd-core capability ledger entry.
3. The project sets `memanto.enabled: true` in `.planning/config.json` (the manifest `activationKey`).
4. `gsd_run loop render-hooks discuss:pre --raw` returns the blocking memanto gate.
5. `gsd_run check predicate ...` runs the gate command (`sh -c` → `node "${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/scripts/gate.cjs"`), which resolves config in-process, runs every check, and exits 1 with one stderr line per failure plus the break-glass line, or exits 0.
6. The host workflow reads `block` and halts or continues.
7. `gsd_run memanto doctor` (or `node "${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/memanto.cjs" doctor`) reports the fail-open states.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Framework | gsd-core 1.20.1 third-party capability bundle: `capability.json` at the repo root (source root), `role: "feature"`, `tier: "full"`, `engines.gsd ">=1.20.1 <2.0.0"`, `runtimeCompat.supported ["*"]`, `skills: []`, `agents: []`, no `hooks`/`mcpServers` | Only the surface gsd-core already supports; gsd-core is never modified (PROJECT constraint, D-11). |
| Runtime | Node `>=24` CommonJS, zero runtime dependencies, synchronous command router | Install is copy-only and hash-bound; symlinks and `node_modules` abort install; async routers are rejected. |
| Enforcement | One blocking gate: `predicate.kind "command-exit-zero"`, `blocking: true`, `onError: "halt"`, `timeout: 20`; command uses `${GSD_HOME:-$HOME}` with a project-scope fallback and never inlines config values | Gates are the only fail-closed primitive; bare `$GSD_HOME` resolves to `/` when unset. |
| Configuration (the "data read") | `memanto.enabled` (activationKey, default `false`), `memanto.agent_id`, `memanto.backend_url`, `memanto.api_url` (default `""`), resolved in-process by `lib/config.cjs` the same way gsd-core does (workstream config, then root config, then manifest default; `defaults.json` is not consulted) | D-01, D-02, D-05; contract-tested against `gsd_run config-get`. |
| Check library | One `lib/checks.cjs` returning records `{id, status: ok|warn|error, message, fix}`, rendered by the gate (failures only, D-04 format) and by doctor (all checks, text or `--raw` JSON) | One source of truth for gate and doctor (Pattern 2). |
| External I/O | `GET <url>/health` on both endpoints, 5 s timeout, one attempt, 2xx + JSON `status === "ok"`; no Memanto memory reads or writes and no `memanto` CLI spawns in Phase 1 | D-03; the capability only connects to pre-running servers (CONF-03). |
| Host write (the "data write") | The gsd-core capability ledger entry written by `capability install`; the capability itself writes nothing. Runtime state, when later phases need it, lives in `<root>/.gsd/capability-data/memanto/`, never in the bundle | Bundle bytes must stay identical after use. |
| Deployment target | npm package `@taoc/gsd-memanto` (manifest id stays `memanto`), `files` whitelist `capability.json, memanto.cjs, lib, scripts, fragments, README.md, LICENSE`; dev installs go through `tools/stage-bundle.cjs` from a local staged directory; release via `workflow_dispatch` `publish.yml` (OIDC trusted publishing, `npm stage publish`, owner 2FA approval) | D-11 to D-15. |
| Directory layout | Shipped: `capability.json`, `memanto.cjs`, `lib/*.cjs`, `scripts/*.cjs`, `fragments/*.md` (only if the spike fallback needs one). Not shipped: `tools/`, `test/`, `.github/`, `.planning/`, `.claude/` | Dev scripts live in `tools/` so the `scripts` whitelist entry cannot ship them. |
| Test harness | `node:test` + `node:assert/strict`; gsd-core's real CLI, loader, validator and `getWiredKinds` located by `GSD_CORE_DIR` (default `~/.claude/gsd-core`); every spawn gets a temp `GSD_HOME`; fake REST (`node:http`, port 0) and fake `memanto` argv recorder on a temp `PATH` | Tests call the host oracle instead of restating its rules (TEST-01, TEST-02). |
| CI | GitHub Actions, `ubuntu-latest` and `macos-latest` × gsd-core `1.20.1` and `1.22.0` (exact pins, `--ignore-scripts`), Node 24, `test (<os>, <gsd>)` check names, more-than-one-test assertion | D-16. |

## Stack Touched in Phase 1

- [ ] Project scaffold — `package.json` (`@taoc/gsd-memanto`, `engines.node >=24`, `files` whitelist, `test` script via `tools/run-tests.cjs`), `capability.json`, `node:test` runner (plan 01-01)
- [ ] Routing — the `discuss:pre` gate rendered by `loop render-hooks` and evaluated by `check predicate`; the `memanto` command family routed by `gsd-tools` (`doctor`) (plans 01-01, 01-06)
- [ ] Data read and write — project config read in-process; `GET /health` on both endpoints; host ledger entry written by install (plans 01-01, 01-02, 01-03)
- [ ] UI — the `memanto: BLOCKED [<check-id>] <problem> -> <fix>` gate message ending with the break-glass line, and the doctor report (plans 01-02, 01-06)
- [ ] Deployment — global install from the staged release file set into a temp `GSD_HOME` (every test) and into the real home for the D-08 acceptance run; first npm publish by the owner (plans 01-01, 01-08, 01-09)

## Out of Scope (Deferred to Later Slices)

- Agent existence, session activation and identity, the canary write-and-read, `memanto setup` (Phase 2)
- Gates at `discuss:post`, `plan:pre/post`, `execute:wave:post`, `execute:post`, `verify:pre`, `ship:pre` (Phase 2; the spike only probes `ship:pre`)
- Any Memanto memory read or write: recall, answer, bootstrap, capture, uploads, conflicts, daily summary (Phases 3-5)
- The ledger for step-only points (Phase 5); temporal recall, policy, schedule, export, per-feature toggles (Phase 6)
- `COVERAGE.md` conformance, fault-injection suite, live suite, full-cycle E2E, full README (Phase 7)
- Doctor warning for MemPalace installed elsewhere on the machine, and doctor `--fix` (CONTEXT.md deferred ideas)
- Skills and agents in the bundle (`skills: []` regardless of the Q3 spike answer; V2-01, V2-02); `execute:pre` hooks (V2-03)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without altering its architectural decisions:

- Phase 2: verified identity at every gate-capable point (agent exists, session live, canary lands), `setup`, full doctor
- Phase 3: memory-informed discuss and plan (`MEMANTO-RECALL.md`, RAG answer brief, bootstrap priming, MCP-directed prompts, on-demand recall)
- Phase 4: decisions remembered and conflicts resolved
- Phase 5: execution, verification and ship leave a trail behind a fail-closed ledger
- Phase 6: memory stays current over time
- Phase 7: coverage and full-cycle proof
