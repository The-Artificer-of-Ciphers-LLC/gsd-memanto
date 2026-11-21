# Phase 1: Walking Skeleton - Research

**Researched:** 2026-11-20
**Domain:** third-party gsd-core capability bundle (Node CJS, zero dependencies), global install, one blocking `command-exit-zero` gate, read-only doctor, `node:test` harness against the real loader
**Confidence:** HIGH on loader, gate, doctor and test mechanics (all exercised by scratch runs on gsd-core 1.20.1 and 1.22.0). MEDIUM on spike question 1 (the deterministic half is proven; whether a live LLM obeys the gate at `discuss:pre` is not observed). MEDIUM on spike question 3 (source path proven, installer run not performed).

Provenance legend used below: `[VERIFIED: scratch run]` means the agent ran it this session in a throwaway `GSD_HOME` (`$SCRATCH` = `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/81802dd7-f7a2-40ae-b3a5-982d76145ce0/scratchpad`) against gsd-core 1.20.1 (installed `~/.claude/gsd-core`, plus `npm i @opengsd/gsd-core@1.20.1`) and 1.22.0 (npm). The real `~/.gsd` was confirmed untouched afterwards. `[VERIFIED: file:lines]` means the file was opened this session and the value is quoted. `[ASSUMED]` means not verified.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Endpoint config and health
- **D-01:** Config keys are `memanto.backend_url` and `memanto.api_url`. Both are full URLs with a scheme (`http://plex2.nomorestars.com:8080`, `http://localhost:8000`), so https cloud endpoints need no extra key. — **Reversibility:** costly — key names live in every enabled project's `.planning/config.json`, in docs and in tests, and renaming them later requires a config migration.
- **D-02:** Both keys default to `""`. An empty value blocks with "set memanto.<key>". The capability has no implicit endpoint, the same rule as `agent_id`.
- **D-03:** Health is checked the same way for both endpoints and for every backend kind: `GET <url>/health`, which must return 2xx with a JSON body whose `status` is `"ok"`. Each endpoint gets a 5s timeout and one attempt with no retry. There is no backend-kind switch and no cloud-specific code path (this is consistent with CONF-06). If a cloud backend cannot answer this, it is reported as unhealthy, and the owner points `backend_url` at a reachable health base. Verified live on 2026-11-20: both `plex2:8080/health` and `localhost:8000/health` return 200 with `"status":"ok"` in under 10ms.

### Gate behavior (discuss:pre)
- **D-04:** The gate evaluates every check before it exits and prints one line per failed check to stderr, in the form `memanto: BLOCKED [<check-id>] <what is wrong> -> <exact fix command>`. The output ends with the break-glass note `(memanto.enabled=false disables Memanto for this project)`. The output must stay inside gsd-core's 2000-character stderr tail.
- **D-05:** The gate script reads `.planning/config.json` in-process (plain node, nested JSON, manifest defaults applied) and does not shell out to `gsd_run config-get`. Research must confirm which parts of gsd-core's resolution apply, such as workstream configs and `~/.gsd/defaults.json` precedence, so the gate resolves the same value gsd-core does. A contract test should compare the gate's resolution with `gsd_run config-get` for the `memanto.*` keys.
- **D-06:** The MemPalace exclusion blocks only when the resolved `mempalace.enabled` is true. The first-party default is `false` (`capability-registry.cjs:2699-2702`), so a project with the key absent or set to false passes. The message names both capabilities.

### Spike scope and handling
- **D-07:** Every spike probe (install, consent, render-hooks, gate halting, `ref.command` dispatch, global skill staging and its surface re-apply) runs against a throwaway `GSD_HOME` and a throwaway runtime config dir such as `CLAUDE_CONFIG_DIR`. Spike probes never write the owner's real `~/.gsd/consent.json` or `~/.claude`.
- **D-08:** The final acceptance check (success criteria 1-2: install, enable, watch `/gsd-discuss-phase` halt and pass) is performed **by the agent, headless**, against the owner's real global home. That run writes the real consent store, and the owner has approved this. Spike probes stay temp-only; only the acceptance run touches the real home.
- **D-09:** When a spike answer is negative, the agent applies the fallback the roadmap already names in this phase. For example, if `ref.command` steps do not dispatch, step logic moves into gates and contributions. The agent records the change and continues. The phase stops for an owner decision only if a gate cannot halt the run, because that breaks the core value.
- **D-10:** Spike outcomes go in `01-SPIKE.md` in the phase directory. Each of the three questions gets an answer with evidence (commands and output). Every positive answer also becomes a `node:test` regression test, so a gsd-core update that changes the behavior fails CI.

### Bundle layout, dev loop and publishing
- **D-11:** The project follows gsd-core's capability standards, per the upstream `docs/how-to/publish-a-capability.md` at v1.20.1 and `capability-source.cjs` `parseSpec`. `capability.json` sits at the **source root**, which is the repo root. Supported install sources are a local directory, `npm:<pkg>@<ver>` (optionally with `--integrity sha512-…`), an https `.tgz` URL and a git URL/ref. A local `.tgz` file is not a supported source, and the `registry` kind is unimplemented.
- **D-12:** The distribution channel is **npm**, package name **`@taoc/gsd-memanto`**. The manifest `id` stays `memanto`. — **Reversibility:** one-way — after 0.1.0 is published, consumers' install specs and integrity pins reference this name, and npm names cannot be reclaimed or renamed.
- **D-13:** Package conventions copy the owner's existing `@taoc` package `~/projects/pi-mlx-models`. Author is "The Artificer of Ciphers LLC", license MIT, `publishConfig.access: public`, and `repository`, `bugs` and `homepage` point to `github.com/The-Artificer-of-Ciphers-LLC/gsd-memanto` (already the git remote). The package uses a `files` whitelist that ships only the bundle (`capability.json`, `memanto.cjs`, lib/scripts/fragments, README, LICENSE), never tests or `.planning`. It also uses `.npmrc` with `save-exact=true`, a `CHANGELOG.md` with an `## Unreleased` section, and a `test` script that asserts more than one test ran. The package has no build step, since it is plain CJS.
- **D-14:** The dev install uses a supported source. A script stages exactly the `files`-whitelisted set into a temp directory, which matches what `npm pack` would ship, and installs from that **local directory** with `capability install <dir> --yes`. Every dev install therefore exercises the release file set (INST-05). The same script re-runs consent for the new bundle hash. It targets a temp `GSD_HOME` by default and touches the real `~/.gsd` only with an explicit `--real` flag.
- **D-15:** The first npm publish happens **at the end of Phase 1**, and the owner performs it. Following the pi-mlx-models model, publishing uses a manual `workflow_dispatch` Release workflow (`publish.yml`) with npm trusted publishing (OIDC, no token) and `npm stage publish`. The owner approves the staged version with 2FA. Owner prerequisites: the `@taoc` npm scope access and a trusted publisher on npmjs.com bound to `publish.yml` and the `npm-publish` environment. The acceptance run (D-08) should install from `npm:@taoc/gsd-memanto@0.1.0` once it is live. Until then it installs from the staged local directory.
- **D-16:** CI runs on ubuntu-latest and macos-latest against two gsd-core versions: the 1.20.1 floor and the latest release. It uses Node 24, the floor from gsd-core's `engines`. CI asserts that more than one test ran (pi-mlx-models pattern). The Release workflow requires the CI checks to have passed on the commit being released.

### Doctor contract
- **D-17:** Doctor is part of `memanto.cjs`. It runs as `gsd_run memanto doctor` when the capability is loaded. It also runs directly as `node $GSD_HOME/.gsd/capabilities/memanto/memanto.cjs doctor`, using the same code, for the not-loaded cases (not consented, engines mismatch, failed validation) in which gsd-core does not route the command family. The README and doctor's own output document the direct form.
- **D-18:** Doctor prints human text by default: one line per check with `ok`, `warn` or `error`, plus the owner's next step. With `--raw` it emits JSON `{checks:[{id,status,message,fix}]}`.
- **D-19:** Doctor exits non-zero when any check is `error` and exits 0 when the worst result is a warning.
- **D-20:** Doctor is strictly read-only. It reads config, the capability ledger, consent and versions, and makes `GET /health` calls. It never activates a session, writes capability-data, re-consents or creates anything.
- **D-21:** Phase 1 reports four fail-open cases as errors: enabled in config but not loaded, not consented, outside `engines.gsd`, and not rendering at a declared point. Doctor also runs the gate's own checks (agent_id empty, health, MemPalace) as errors. Later phases add more checks.

### Claude's Discretion
- File layout within the root bundle (lib/ vs scripts/ split, fragment naming), the doctor check ids, the fake-memanto CLI and fake REST server design, and the gate script's internal structure.

### Deferred Ideas (OUT OF SCOPE)
- Doctor warning when MemPalace is installed or active elsewhere on the machine. This was considered and not chosen for Phase 1, and could be added with the Phase 2 full doctor if wanted.
- Doctor `--fix`, for example re-consent. It was rejected for now because consent writes are a trust decision.

None of the discussion added new capabilities to the phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INST-01 | Global install through gsd-core third-party install and consent, no gsd-core edits | Install is `capability install <dir> --yes`, default scope `global`, ledger at `$GSD_HOME/.gsd-capabilities.json`; global scope writes no consent record (see Finding F2). Test pattern in Validation Architecture. |
| INST-02 | Manifest loads through the real loader with zero overlay warnings or diagnostics | Candidate manifest below loaded with `warnings(memanto): []`, `diagnostics: []` on 1.20.1 and 1.22.0. gsd-core itself leaves an empty `.staging` dir that produces a warning with `id: ".staging"` (F3): assert on `id === 'memanto'`. |
| INST-03 | Every hook at a (point, kind) the host dispatches on 1.20.1 | The real `getWiredKinds` + `validateHooksWired` give the dispatch matrix programmatically (F4). Use them, do not hand-maintain a table. |
| INST-04 | Loader traps avoided | Each trap reproduced with exact loader warning text (F5). Negative-fixture tests prove the traps are real and that the shipped manifest avoids them. |
| INST-05 | Zero-dependency CJS, synchronous family, state outside bundle, minimal package | Sync router contract and exit-code behavior verified (F7). `files` whitelist + tree-digest and static-require tests (Validation Architecture). |
| CONF-01 | `memanto.enabled` activationKey; false means no hook runs | Verified: enabled false/absent/`"false"` gives 0 active hooks; only boolean `true` activates (F6). |
| CONF-02 | `agent_id` default `""`, empty blocks with actionable message | Manifest default + gate check `agent-id` (Architecture). |
| CONF-03 | Endpoint config for backend and REST API, capability never starts/stops them | Keys `memanto.backend_url`, `memanto.api_url` (D-01); async `fetch` with `AbortSignal.timeout(5000)`; both live endpoints return `{"status":"ok"}` (F9). |
| GATE-03 | Every gate refuses while `mempalace.enabled` is true, message names both capabilities | Strict `=== true` semantics match gsd-core activation (F6); first check in the gate. |
| GATE-06 | Doctor detects fail-open cases as errors | CLI-first detection design with exact signals for each of the four cases (F8). |
| TEST-01 | `node:test` suite on temp `GSD_HOME`, real validator/loader/`render-hooks` | Harness design, `GSD_CORE_DIR` resolution, version matrix install (Validation Architecture). |
| TEST-02 | Gates, commands, adapter against fake CLI + fake REST | Fake REST (`node:http`, port 0) and fake `memanto` argv-recorder design; the gate must spawn zero `memanto` processes in Phase 1. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Extracted from `/Users/trekkie/projects/gsd-memanto/.claude/CLAUDE.md` and `/Users/trekkie/.claude/CLAUDE.md`. The planner treats these as locked.

- Third-party capability, installed globally, enabled per project; every gate/step/contribution/config key/command lives in the capability definition. **gsd-core is never modified**; `engines.gsd >=1.20.1 <2.0.0`.
- Runtime: Node CJS, **zero runtime dependencies**; install is copy-only, **symlinks are rejected**, the bundle is hash-bound; **synchronous** command router; **runtime state outside the bundle** (`<root>/.gsd/capability-data/memanto/`).
- `memanto.agent_id` must be explicit per project; default `""`; never ship `memanto-dev` or any default agent id.
- Servers (backend, REST API) are pre-running and only connected to. Failure semantics: fail closed.
- Never use: `execute:pre` hooks, `skills[]`/`ref.skill` at project scope, `agents[]`/`ref.agent`, `hooks[]`/`mcpServers`, `query` gates for a third party, the name `MEMORY-RECALL.md`, state inside the bundle dir, async routers, `exec` promises, parsing Memanto Rich output, `memanto login|logout|use|connect|auto-activate on` from the capability, symlinks or `node_modules` in the bundle.
- Tests: `node --test`, fake `memanto` on a temp `PATH`, always set `GSD_HOME` to a temp dir in E2E; live tests opt-in (`MEMANTO_LIVE=1`).
- Read-only against the real Memanto backend: never create/delete agents or write memories (task instruction).
- GSD workflow enforcement: file edits go through a GSD command (the executor does this; research only writes `01-RESEARCH.md`).
- Global owner directive: written output refers to the actor as "the agent"; no first-person pronouns; owner decisions are asked with AskUserQuestion, never listed in prose.
- CLAUDE.md corrections found this session (the file should be amended): see F1, F3, F10 below.

## Summary

The phase is feasible on gsd-core 1.20.1 exactly as CONTEXT.md describes, and the load-bearing mechanics were proven by running them. A candidate manifest (below) installs globally with `capability install <dir> --yes`, loads with zero warnings or diagnostics for `id: memanto` on both 1.20.1 and 1.22.0, passes the real `validateHooksWired`, renders one blocking gate at `discuss:pre`, and is activated or silenced purely by `memanto.enabled`. The gate runs through `gsd_run check predicate` and a failing gate comes back as `{"block":true,"message":...}` with CLI exit 0, so the workflow must read `block`, not the exit code. A `ref.command` step dispatches the third-party `memanto` family at the CLI level on both versions.

Several facts differ from or sharpen the project CLAUDE.md and CONTEXT.md and change the plan. (1) The real gate budget is the first ~1980 characters, not a "tail": the evaluator clips the head, so the break-glass line at the end is the first thing lost when output is long. (2) Global scope has no consent record at all, so the "not consented" doctor case is only reachable for a project-scope install (or a bundle that was never committed to the ledger); the doctor design must define it that way. (3) `discuss:pre` is the least explicit gate call site in gsd-core: `discuss-phase.md` only says "apply each entry per loop-hook-dispatch.md", and that generic document never spells out the `gsd_run check predicate` verb that plan, verify, ship and execute call sites spell out. This is the single biggest risk for success criterion 2 and is exactly what the live spike must settle. (4) Three `/gsd-discuss-phase` paths never render `discuss:pre` at all (`--power`, `--assumptions`, `workflow.discuss_mode: "assumptions"`), so the gate is bypassable and doctor should warn. (5) gsd-core 1.22.0 does wire `execute:pre`; only the 1.20.1 floor lacks it.

**Primary recommendation:** Build a tracer slice first (manifest + `agent_id`-only gate + temp-`GSD_HOME` harness proving `render-hooks` then `check predicate` blocks), then widen to health, MemPalace, doctor and release scaffolding. Share one pure `lib/checks.cjs` between gate and doctor. Drive doctor through gsd-core's CLI (`capability list --raw`, `loop render-hooks --raw`) located by a documented search order, not through `require()` of gsd-core internals (tests may use internals as the oracle).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enforcement (halt discuss-phase) | gsd-core host workflow reading `render-hooks` + `check predicate` | Bundle gate script (verdict) | The host prose dispatches the gate; the script only returns exit 0/non-zero. A capability cannot halt anything itself. |
| Config resolution (`memanto.*`, `mempalace.enabled`) | Bundle `lib/config.cjs` (in-process JSON read) | gsd-core `config-get` (oracle in tests) | D-05: avoid shelling out from the gate; mirror ws then root then manifest default. |
| Endpoint health | Bundle `lib/health.cjs` (Node `fetch`) | Pre-running Memanto servers | Capability only connects; never starts or reconfigures. |
| Load/consent/engines/render diagnosis | Bundle doctor, calling gsd-core CLI | gsd-core loader (source of truth) | Doctor reports what the host decided; it does not re-implement the loader. |
| Install + consent | gsd-core `capability install` (host) | Dev staging script, owner | Copy-only, hash recorded in ledger; no bundle code runs at install. |
| Packaging + release | npm `files` whitelist, GitHub Actions (owner-approved publish) | Staging script | D-13..D-16. |
| Test oracle | gsd-core real validator/loader/CLI from `GSD_CORE_DIR` | Fake REST + fake `memanto` | Catches schema and dispatch drift when gsd-core updates. |
| Runtime state | `<root>/.gsd/capability-data/memanto/` (none in Phase 1) | — | The bundle dir must stay byte-identical after use. |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js CJS (`.cjs`) | `>=24` (dev machine Node 26.13.0) | All bundle code | Command module is `require()`d in-process; no build step possible. [VERIFIED: scratch run, Node v26.13.0; floor from gsd-core engines `node >=24.0.0` via `npm view @opengsd/gsd-core engines`] |
| `node:test` + `node:assert/strict` | built-in | Test runner | Same as gsd-core. Tap reporter prints `# tests N`. [VERIFIED: scratch run on Node 26] |
| Node global `fetch` + `AbortSignal.timeout` | built-in (Node 24) | `GET /health` with 5s budget | Zero dependencies; handles http and https. [ASSUMED: behavior identical on Node 24; verified on 26 only via the live curl-equivalent shape] |
| `node:child_process.spawnSync` | built-in | Doctor calls gsd-core CLI; sync health probe wrapper | Router must be synchronous. [VERIFIED: file gsd-tools.cjs router code read this session, "must be synchronous (returned a Promise)"] |
| gsd-core | `1.20.1` floor, `1.22.0` latest | Host under test | [VERIFIED: `npm view @opengsd/gsd-core versions`; `cat ~/.claude/gsd-core/VERSION` = `1.20.1`] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| gsd-core `capability-loader.cjs` (`loadRegistry`, `readHostVersion`), `capability-validator.cjs` (`validateHooksWired`), `scripts/gen-loop-host-contract.cjs` (`getWiredKinds`) | as host | Test oracle only | `require()` from `GSD_CORE_DIR`; never from the shipped bundle. |
| `npm pack --dry-run --json` | npm 11.20.0 | Release file list for staging + whitelist test | Dev install script and INST-05 test. [ASSUMED: output shape `[{files:[{path}]}]`; standard npm behavior, not run this session] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `npm i @opengsd/gsd-core@<ver>` into a CI temp prefix, `GSD_CORE_DIR` env | devDependency on `@opengsd/gsd-core` | devDependency drags 106 packages into `npm ci` and cannot express a two-version matrix cleanly. Temp-prefix install worked with `--ignore-scripts`. [VERIFIED: scratch run, 1.20.1 and 1.22.0] |
| Doctor via gsd-core CLI | Doctor `require()`s `capability-loader.cjs` | Internals are not a public API and move between versions; CLI contract (`capability list`, `loop render-hooks`) is what workflows themselves use. |
| Gate reads config in-process (D-05) | `gsd_run config-get` per key | Locked by D-05; the contract test bounds drift. |

**Installation:** no runtime packages. Dev/CI only:
```bash
# per matrix leg (CI), into a temp prefix, never into the repo
npm install --prefix "$RUNNER_TEMP/gsd-core-1.20.1" --no-audit --no-fund --ignore-scripts @opengsd/gsd-core@1.20.1
export GSD_CORE_DIR="$RUNNER_TEMP/gsd-core-1.20.1/node_modules/@opengsd/gsd-core/gsd-core"
```
Local default: `GSD_CORE_DIR=~/.claude/gsd-core`. `getWiredKinds` takes `dirname(GSD_CORE_DIR)` as its repo root (both layouts expose `<root>/gsd-core/workflows/*.md`) and `loadRegistry` finds `../../../scripts/gen-capability-registry.cjs` relative to `bin/lib`, which resolves in both layouts. [VERIFIED: scratch run]

**Version verification:** `npm view @opengsd/gsd-core version` returned `1.22.0` (latest, published 2026-11-19); `1.20.1` published 2026-11-05. [VERIFIED: npm registry]

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `@opengsd/gsd-core` (CI/test host only, not shipped) | npm | created 2026-05-30; 1.20.1 published 2026-11-05; 1.22.0 2026-11-19 | ~26.7k/wk | github.com/open-gsd/gsd-core | **SUS** (`too-new`, from the latest version's publish date) | Flagged. It is the owner's already-installed host (installed VERSION 1.20.1), `postinstall` is null, installs run with `--ignore-scripts`, versions pinned exactly. Planner adds one `checkpoint:human-verify` before the first CI wiring that fetches it. |

Seam output (verbatim signals): `exists: true`, `weeklyDownloads: 26752`, `repoUrl: git+https://github.com/open-gsd/gsd-core.git`, `postinstall: null`, `reasons: ["too-new"]`. [VERIFIED: `gsd-tools package-legitimacy check --ecosystem npm @opengsd/gsd-core`]

**Packages removed due to SLOP verdict:** none.
**Packages flagged SUS:** `@opengsd/gsd-core` (host, CI only).
No runtime or dev package is added to the shipped bundle. `@taoc/gsd-memanto` is the capability's own name: `npm view @taoc/gsd-memanto` returned E404 (unclaimed) and `@taoc/pi-mlx-models` resolves (the `@taoc` scope is used by the owner). [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```
 OWNER / CI
   |  stage-bundle script (npm pack --dry-run --json file list -> temp dir)
   v
 gsd-tools capability install <tempdir> --yes   (global scope default)
   |  copy-only; ledger $GSD_HOME/.gsd-capabilities.json ; NO consent.json record for global
   v
 $GSD_HOME/.gsd/capabilities/memanto/{capability.json, memanto.cjs, lib/, scripts/}

 /gsd-discuss-phase N  (host workflow prose, run by the LLM)
   |  step dispatch_discuss_pre_hooks:  gsd_run loop render-hooks discuss:pre --raw
   v
 loader: loadRegistry(includeInstalled) -> accepted? -> activationKey memanto.enabled === true? -> activeHooks
   |        (not accepted: stderr "failed to load ... FAILING OPEN" or silent for unconsented project overlay)
   v
 activeHooks[ gate{ predicate command-exit-zero, blocking:true, onError:halt } ]
   |  LLM runs: gsd_run check predicate --predicate '<json>' --phase-dir .. --phase-number N --raw
   v
 sh -c  d="${GSD_HOME:-$HOME}/.gsd/capabilities/memanto"; exec node "$d/scripts/gate.cjs"   (cwd = project root, 30s default, manifest sets 20)
   |
   v  scripts/gate.cjs
      lib/config.cjs   (ws config -> root config -> manifest default)
      lib/checks.cjs   mempalace | agent-id | backend-url | api-url | backend-health | api-health
      lib/health.cjs   fetch GET <url>/health, 5s, 1 attempt, status==="ok"
      all checks evaluated -> stderr lines + break-glass -> exit 1, or exit 0
   |
   v
 {"block":true,"message":"command exited 1: <stderr first <=2000 chars>"}  (CLI exit 0)
   -> host: blocking && block -> STOP discuss-phase, surface message
   -> {"block":false} -> discuss continues

 gsd_run memanto doctor   (or: node $GSD_HOME/.gsd/capabilities/memanto/memanto.cjs doctor)
   locate gsd-tools -> capability list --raw / loop render-hooks <point> --raw / VERSION / ledger
   + same lib/checks.cjs as the gate  -> human text or --raw JSON ; exit 1 if any error
```

### Recommended Project Structure
```
capability.json            # manifest at repo root (source root, D-11)
memanto.cjs                # command module: exports route({args,cwd,raw,error}); require.main shim for direct doctor
lib/config.cjs             # config resolution (mirrors host) ; no I/O besides reading config.json
lib/health.cjs             # async checkHealth(url,{timeoutMs}) + userinfo redaction
lib/checks.cjs             # pure check definitions returning {id,status,message,fix}; used by gate and doctor
lib/gsd-host.cjs           # locate gsd-tools/VERSION; spawnSync capability list / loop render-hooks; parse
scripts/gate.cjs           # blocking gate entrypoint (the only thing the manifest executes)
scripts/health-probe.cjs   # tiny CLI so the sync doctor can call async health via spawnSync
README.md  LICENSE  CHANGELOG.md  package.json  .npmrc  .gitignore
scripts/stage-bundle.cjs   # NOT shipped (dev); lists via npm pack --dry-run --json, copies to temp, installs
test/*.test.cjs  test/helpers/{gsd-env,fake-api,fake-memanto}.cjs   # NOT shipped
.github/workflows/{ci.yml,publish.yml}
```
Note `scripts/` mixes shipped (`gate.cjs`, `health-probe.cjs`) and dev (`stage-bundle.cjs`) files: the `files` whitelist must name the shipped ones individually (or put dev scripts in `tools/`). Recommend `tools/stage-bundle.cjs` to avoid an accidental glob. [Discretion area, CONTEXT.md]

### Pattern 1: Candidate manifest (verified clean on 1.20.1 and 1.22.0)
**What:** Phase-1 shipped manifest: four config keys, one gate, no steps/contributions/skills/agents, one command family.
**Example:**
```json
{
  "id": "memanto", "role": "feature", "version": "0.1.0",
  "title": "Memanto memory",
  "description": "Memanto-backed project memory for the GSD lifecycle. Fails closed: a blocking gate halts the workflow when the configured Memanto agent or endpoints are not healthy.",
  "tier": "full", "requires": [],
  "engines": { "gsd": ">=1.20.1 <2.0.0" },
  "runtimeCompat": { "supported": ["*"], "unsupported": [] },
  "author": "The Artificer of Ciphers LLC", "license": "MIT",
  "repository": "https://github.com/The-Artificer-of-Ciphers-LLC/gsd-memanto",
  "homepage": "https://github.com/The-Artificer-of-Ciphers-LLC/gsd-memanto#readme",
  "keywords": ["memory", "memanto"],
  "skills": [], "agents": [],
  "config": {
    "memanto.enabled":     { "type": "boolean", "default": false, "description": "..." },
    "memanto.agent_id":    { "type": "string",  "default": "",    "description": "..." },
    "memanto.backend_url": { "type": "string",  "default": "",    "description": "..." },
    "memanto.api_url":     { "type": "string",  "default": "",    "description": "..." }
  },
  "activationKey": "memanto.enabled",
  "commands": [ { "family": "memanto", "module": "memanto.cjs", "router": "route", "subcommands": ["doctor"] } ],
  "steps": [], "contributions": [],
  "gates": [ {
    "point": "discuss:pre",
    "check": { "predicate": { "kind": "command-exit-zero", "timeout": 20,
      "command": "d=\"${GSD_HOME:-$HOME}/.gsd/capabilities/memanto\"; [ -f \"$d/scripts/gate.cjs\" ] || d=\".gsd/capabilities/memanto\"; exec node \"$d/scripts/gate.cjs\"" } },
    "blocking": true, "onError": "halt"
  } ]
}
```
Source: scratch run `$SCRATCH/cand/capability.json` (without `subcommands`; `subcommands` is validated as an optional array of non-empty strings, [VERIFIED: capability-validator.cjs:477-490]). Result on both versions: `loaded: true`, `warnings(memanto): []`, `diag: []`, `wired errs: []`, `render-hooks` returns `["gate/true"]`, gate command length 144 (limit 4096). Notes:
- `runtimeCompat.supported: ["*"]`. STACK.md/SUMMARY.md suggested `["claude"]`; nothing in the loader, state or lifecycle consumes `runtimeCompat` (grep of loader/state/resolver/lifecycle found no reader) and the gate is `sh -c`, so `["*"]` matches first-party mempalace and avoids needless exclusion. [VERIFIED: `validateRuntimeCompat` at capability-validator.cjs:495-556 only validates shape; consumers not found in the files searched. A consumer in install-engine/surface was not checked: low risk.]
- Use `${GSD_HOME:-$HOME}`, never bare `$GSD_HOME`: in normal use `GSD_HOME` is unset and the command would resolve `/.gsd/capabilities/...` and block with a Node stack trace. [VERIFIED: scratch run, `env -u GSD_HOME` produced `Cannot find module '/.gsd/capabilities/memanto/gate.cjs'`]
- The `${GSD_HOME:-$HOME}` text does not collide with the predicate interpolator: it only rewrites `${PHASE_NUMBER}`, `${PHASE_DIR}`, `${PHASE_REQ_IDS}`. [VERIFIED: gate-predicate-evaluator.cjs, `INTERPOLATION_RE = /\$\{(PHASE_NUMBER|PHASE_DIR|PHASE_REQ_IDS)\}/g`]
- Never put config values in the command string; the gate reads config itself (shell-injection and 4096-char limit).
- Steps run before gates inside one point (render order observed `step` then `gate`). Not relevant while Phase 1 ships no step.

### Pattern 2: One check library, two renderers
`lib/checks.cjs` exports `runGateChecks({cwd, env, fetchHealth})` returning an array of `{id, status:'ok'|'error', message, fix}`. `scripts/gate.cjs` prints only failures in D-04 format and exits 1 if any; `memanto.cjs doctor` prints every check and adds loader/consent/engines/render checks (D-21). Gate check ids (discretion): `mempalace`, `agent-id`, `backend-url`, `api-url`, `backend-health`, `api-health`. Skip a health check whose URL is empty (the url check already blocks); run the two health checks in parallel with `Promise.all` so worst case is ~5s.

### Pattern 3: Gate message format and the real output budget
Format per D-04, e.g.
```
memanto: BLOCKED [agent-id] memanto.agent_id is empty -> gsd_run config-set memanto.agent_id <agent-id>
memanto: BLOCKED [mempalace] mempalace.enabled is true; Memanto and MemPalace are mutually exclusive -> gsd_run config-set mempalace.enabled false (or memanto.enabled false)
(memanto.enabled=false disables Memanto for this project)
```
**Budget (correction to D-04's wording):** the evaluator does `trimToMax(s) = s.length > COMMAND_MAX_OUTPUT_CHARS ? s.slice(0, COMMAND_MAX_OUTPUT_CHARS) : s` with `COMMAND_MAX_OUTPUT_CHARS = 2000`, applied to stderr and then again to `command exited <code>: <stderr>`. It keeps the **head**, so the final break-glass line is the part that gets cut. The prefix `command exited 1: ` is 18 characters. Keep total stderr at or below about 1900 characters by capping each message (truncate URLs and any echoed value to roughly 160 characters, redact `user:pass@`). Add a test with all six checks failing at once and long URLs, asserting the `message` still ends with the break-glass line. [VERIFIED: gate-predicate-evaluator.cjs `trimToMax`, `COMMAND_MAX_OUTPUT_CHARS`, and scratch run output `command exited 1: memanto: BLOCKED [probe] test -> fix`]

### Pattern 4: Config resolution the gate must mirror (D-05 answer)
What the host does (all `[VERIFIED: scratch run]` plus `capability-activation.cjs` `resolveConfigKey` doc comment and `config.cjs` `cmdConfigGet`):
1. Directory: `planningDir(cwd)` = `<cwd>/.planning[/<GSD_PROJECT>][/workstreams/<GSD_WORKSTREAM>]`, driven by **environment** variables `GSD_PROJECT` and `GSD_WORKSTREAM` (the `--ws` flag sets the workstream for the CLI; a gate subprocess inherits only env). Root dir is `<cwd>/.planning`.
2. Lookup order: workstream config.json, then root config.json (if the path differs), then the manifest `config.<key>.default`. Nested own-property lookup with a guard against `__proto__`, `constructor`, `prototype`.
3. `~/.gsd/defaults.json` (and `$GSD_HOME/.gsd/defaults.json`) is **not** consulted for `memanto.*`: `GLOBAL_DEFAULTS_RESOLUTION_KEYS` lists only core keys. Writing `{"memanto":{"agent_id":"fromdefaults","enabled":true}}` into `$GSD_HOME/.gsd/defaults.json` left `config-get memanto.agent_id` at `""` and `memanto.enabled` at `false`. The gate must not read it either.
4. `config-get` on a declared key whose value is absent returns the manifest default (`false`, `""`); an undeclared key errors `Key not found`; a missing config.json with a schema default still resolves via the schema.
5. **Boolean semantics:** only the literal boolean `true` activates a capability's `when`/`activationKey`. For `mempalace.enabled`: `true` gives 1 active mempalace hook at `plan:pre`; `"true"`, `"false"`, `1`, `0`, `"yes"`, `null` all give 0. `memanto.enabled: "false"` also gives 0 hooks. So the gate's MemPalace check must be strict `value === true` (a string `"true"` does not enable MemPalace in gsd-core, so it must not block Memanto).
6. Malformed JSON: the host treats it as key-absent (with one stderr warning). The gate should do the opposite and **fail closed** with a distinct check id (`config-unreadable`), since a project that cannot be read cannot prove MemPalace is off.
7. `gsd_run config-set memanto.<key> <value>` works only while the capability is loaded (declared keys); with the capability not loaded it errors `Unknown config key`. Fix hints in gate messages are therefore valid (the gate only runs when loaded); doctor fix hints for not-loaded states must say to edit `.planning/config.json` or reinstall, not `config-set`. It coerces `true`/`false` to booleans. [VERIFIED: scratch run]

Contract test matrix (compare the gate's resolver with `gsd_run config-get` and with `render-hooks` activity): no config file; root only; workstream only via `GSD_WORKSTREAM`; both, workstream wins; `enabled` as `"false"`; `mempalace.enabled` as `true`/`"true"`/`null`; malformed JSON (documented divergence: gate blocks).

### Pattern 5: Doctor detection mechanics (D-17..D-21)
Locating gsd-core, in order: env `GSD_CORE_DIR`; `require.main.filename` when its basename is `gsd-tools.cjs` (true under `gsd_run memanto doctor`); `<root>/gsd-core/bin/gsd-tools.cjs`, `<root>/.claude/gsd-core/...` for the project root; then the config homes the workflows search (`CLAUDE_CONFIG_DIR` or `~/.claude`, `OPENCODE_CONFIG_DIR` or `~/.config/opencode`, and the rest of the list in the workflow `initialize` step). If none is found, emit an `error` check `gsd-core-located` and still run the config/health checks.

Signals for the four cases, all spawned as CLI processes with the inherited environment (`GSD_HOME` included) and cwd = project root:

| Case | Signal | Verified behavior |
|------|--------|-------------------|
| enabled in config but not loaded | resolved `memanto.enabled === true` (raw config read) AND `loop render-hooks <point> --raw` has no `capId == "memanto"` entry | Unconsented/skipped: `activeHooks: []`; stderr also prints `gsd-tools: warning: unknown config key(s) in .planning/config.json: memanto — these will be ignored`; `gsd_run memanto ...` answers `Error: Unknown command: memanto`. |
| not consented | `capability list --raw` row for `memanto` with `status: "inactive"` and `reason: "discovered — no user consent record (inactive)"` (project scope); or no row at all (bundle present but not in a ledger) | Project scope: `capability trust revoke memanto` flipped it to inactive and emptied `activeHooks` **silently** (no stderr load warning). Hand-copied global bundle with no ledger: hooks still render but `gsd_run memanto` is `Unknown command`. **Global installs have no consent record** (loader comment: "GLOBAL scope is under the user's own home and is trusted as before (no consent record required)"; install into a temp home wrote no `consent.json`). |
| outside `engines.gsd` | `capability list --raw` `status: "incompatible"`; render-hooks stderr and envelope `warnings[]`: `capability "memanto" failed to load (incompatible with GSD 1.20.1 (requires engines.gsd ">=9.0.0")); its gate at discuss:pre is SKIPPED and NOT enforced (failing open). Run \`gsd capability remove memanto\` ...` | Edited installed manifest to `>=9.0.0`: `activeHooks: []` plus the warning; host VERSION read from `<core>/VERSION`. |
| does not render at a declared point | for each point in the installed manifest's `gates/steps/contributions`, `render-hooks <point> --raw` lacks the memanto entry while enabled | Residual bucket: validation failure, id collision, pending install, and anything else; attach any stderr `gsd: warning — capability "memanto" failed to load (<reason>)` text as the reason. |

Semantics to hand the planner (this is a SC3 interpretation that needs one line of owner awareness): "not consented" is a **project-scope** state, plus "bundle not committed to a ledger" for global. Test it with a project-scope fixture install followed by `capability trust revoke memanto`, and a hand-copied global bundle. If memanto is installed in both scopes the loader keeps the global one and skips the other with `id collides with an already-registered capability`; doctor should warn on a duplicate.
Other doctor details: `--raw` output is `{checks:[{id,status,message,fix}]}` (D-18); `process.exitCode = 1` from inside the router exits 1 through `gsd_run` (verified) and when run directly. `ctx.args[0]` is the family name `memanto`, so the subcommand is `args[1]` (verified: router received `["memanto","probe","--phase","1"]`, `--raw` is stripped and surfaces as `ctx.raw`). The direct entry shim must prepend `'memanto'` itself, guarded by `if (require.main === module)`. The sync health check from doctor must go through `spawnSync(process.execPath, [probe, ...urls])` because the router cannot await.
Add one `warn` check (not in D-21, within discretion): `discuss-bypass` when `workflow.discuss_mode` is `"assumptions"` (F11).

### Anti-Patterns to Avoid
- **Bare `$GSD_HOME` in the gate command.** Use `${GSD_HOME:-$HOME}`.
- **Declaring a hook at an undispatched pair and trusting install success.** `execute:pre` gate installed cleanly with `loaded=true` and zero warnings on 1.20.1; only `validateHooksWired` catches it. [VERIFIED: scratch run `traps.cjs`]
- **Asserting zero loader warnings globally.** gsd-core leaves an empty `.staging` directory after every install that surfaces as `{"id":".staging","reason":"capability.json missing, non-regular (FIFO/device), or exceeds the size cap — skipped"}`. Filter by `id === 'memanto'` (F3).
- **Reading the exit code of `check predicate` as the verdict.** A blocked gate exits 0 with `block:true`; a non-zero exit means the check itself failed and routes by `onError`.
- **Putting runtime files in the bundle dir** (changes the sha512 for project scope and breaks "no runtime state").
- **Using `gsd_run config-set` in doctor fix hints for not-loaded states** (errors `Unknown config key`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Dispatch-coverage table of (point, kind) | A hand-maintained matrix | `getWiredKinds(dirname(GSD_CORE_DIR))` + `validateHooksWired(cap, wired)` from the host | Reads the real workflow prose per version; reproduced 11 points on 1.20.1 and 12 on 1.22.0. |
| Manifest validation / trap detection | Custom schema checks | `loadRegistry({includeInstalled:true,cwd,gsdHome})` and `_overlay.warnings` | The real loader runs `validateCapability`, contract roles, consumes-satisfiability, duplicate-producer and engines. |
| Install / consent | Copying into `.gsd/capabilities` | `capability install <dir> --yes` | Writes the ledger the command family needs; hand copies leave `Unknown command`. |
| Semver range check for engines | A mini semver parser in the bundle | `capability list` `status` / host `loadRegistry` | Zero-dependency bundle; the host already decides. |
| Release file list | A second whitelist in the staging script | `npm pack --dry-run --json` | One source of truth equal to what publish ships (D-14). |
| Health parsing of Memanto CLI output | Rich-text scraping | REST `GET /health` JSON | CLAUDE.md "What NOT to use". |

**Key insight:** every question of the form "would gsd-core accept or dispatch this" already has an executable oracle in the host. The phase's tests should call the oracle on a temp `GSD_HOME`, not restate its rules.

## Common Pitfalls

### Pitfall 1: The gate may never run, or may run unevaluated, at `discuss:pre`
**What goes wrong:** `discuss-phase.md` step `dispatch_discuss_pre_hooks` says only `DISCUSS_PRE_HOOKS_JSON=$(gsd_run loop render-hooks discuss:pre --raw)` then "Apply each entry in `activeHooks` per `loop-hook-dispatch.md`" (discuss-phase.md:296-301). The generic reference tells the LLM to "Evaluate `check` (one of `query`, `predicate`, or `agentVerdict`)" and to pass `check.predicate` "as a single argv element", but never names `gsd_run check predicate`. Plan, verify, ship, wave-post and execute:post call sites spell the verb out (plan-phase.md:1479, verify-work.md:96, ship.md predicate arm, `wave-post-gate-hooks.md:20`). Discuss is the one point where the LLM must infer it.
**Why it happens:** the host dispatch is prose followed by an LLM, not code.
**How to avoid:** the live spike (Open Questions Q1) must run a real headless `/gsd-discuss-phase` against a gate that always blocks. If the LLM does not evaluate the gate, the D-09 fallback is a reinforcing `contribution` into `orchestrator` at `discuss:pre` whose inline text spells out the exact `gsd_run check predicate --predicate '<json>' --phase-dir "${PHASE_DIR}" --phase-number "${PHASE_NUMBER}" --raw` call and the stop rule. Ship that variant only if the gate-only variant fails to halt.
**Warning signs:** headless run reaches `analyze_phase` or writes a CONTEXT.md while the gate script always exits 1.

### Pitfall 2: Documented bypass paths for `discuss:pre`
**What goes wrong:** `/gsd-discuss-phase --power`, `--assumptions`, and `workflow.discuss_mode: "assumptions"` route to `discuss-phase-power.md`, `list-phase-assumptions.md` and `discuss-phase-assumptions.md`, none of which contain `render-hooks` (counts 0). Verified in `~/.claude/skills/gsd-discuss-phase/SKILL.md:56-61` and by grep. The gate never fires on those paths.
**How to avoid:** add the doctor `warn` (`discuss-bypass`), state the bypass in README and `01-SPIKE.md`, and have the Phase 2 owner decision (GATE-05 says "no other bypass") see it. Not fixable inside the capability.

### Pitfall 3: Output budget cuts the break-glass line
Covered in Pattern 3. Test with maximal failures.

### Pitfall 4: `.staging` warning breaks a naive "zero warnings" assertion
gsd-core's installer leaves `$GSD_HOME/.gsd/capabilities/.staging/` (empty). Assert `warnings.filter(w => w.id === 'memanto')` is empty and `diagnostics` is empty, and separately tolerate id `.staging`. [VERIFIED: scratch run on 1.20.1 and 1.22.0]

### Pitfall 5: "Not consented" cannot happen for a global install
Planning a doctor test that revokes consent for a global install will find nothing to revoke. See Pattern 5.

### Pitfall 6: `capability install` without `--yes` reports `status: "aborted"` and exits 1
Scripts and tests must assert `status === "installed"` from the JSON, not only the exit code. Re-install of the same or a bumped version overwrites and returns `installed`; `capability remove memanto` leaves an empty ledger and no files. [VERIFIED: scratch run]

### Pitfall 7: Env contamination of tests
Every spawned gsd-tools must get `GSD_HOME=<tmp>` and an empty/controlled `GSD_WORKSTREAM`/`GSD_PROJECT`; `capability state` reads the runtime config dir (`~/.claude` or the configured runtime) read-only. Do not set `HOME` to the temp dir for the host (some host code uses `os.homedir()`); set `GSD_HOME` only. Confirm `~/.gsd/consent.json` mtime unchanged in a final test or in the spike log.

### Pitfall 8: Bundle hash and the dev loop
Project scope binds consent to a recomputed sha512 of the whole bundle; any runtime-written byte deactivates it. Global scope has no hash binding (editing the installed manifest to `>=9.0.0` took effect immediately and was not detected as tamper). Consequence: do not rely on consent to detect an edited global bundle; doctor can compare the ledger entry version with the installed manifest version as a cheap drift hint (optional).

### Pitfall 9: Repo-controlled endpoints
`.planning/config.json` is repo content, so a cloned repo can set `memanto.enabled: true` plus any `api_url`. Phase 1 only issues a GET to `/health`; Phases 2-5 will send memories to that URL. See Security Domain; carry forward as an owner decision for Phase 2.

## Code Examples

### Gate skeleton (sketch of structure, not final code)
```js
// scripts/gate.cjs  -- Source: structure derived from verified predicate contract
'use strict';
const { runGateChecks } = require('../lib/checks.cjs');
(async () => {
  const results = await runGateChecks({ cwd: process.cwd(), env: process.env });
  const failed = results.filter(r => r.status === 'error');
  if (failed.length === 0) process.exit(0);
  const lines = failed.map(r => `memanto: BLOCKED [${r.id}] ${r.message} -> ${r.fix}`);
  lines.push('(memanto.enabled=false disables Memanto for this project)');
  process.stderr.write(lines.join('\n').slice(0, 1900) + '\n'); // keep the whole text inside the host clip
  process.exit(1);
})().catch(e => { process.stderr.write(`memanto: BLOCKED [gate-internal] ${String(e && e.message).slice(0,300)} -> gsd_run memanto doctor\n(memanto.enabled=false disables Memanto for this project)\n`); process.exit(1); });
```
An uncaught exception must also exit non-zero (fail closed); `process.exit(1)` in `catch` covers async errors. Truncating with a blind `.slice` would again cut the break-glass line: cap each message first, then join, so the last line is always present.

### Command module shape
```js
// memanto.cjs
'use strict';
function route(ctx) {            // ctx = { args, cwd, raw, error }; args[0] === 'memanto'
  const sub = ctx.args[1];
  if (sub === 'doctor') return runDoctor(ctx);   // MUST NOT return a Promise
  ctx.error('Usage: gsd_run memanto doctor [--raw]');
}
module.exports = { route };
if (require.main === module) {
  route({ args: ['memanto', ...process.argv.slice(2)], cwd: process.cwd(),
          raw: process.argv.includes('--raw'),
          error: (m) => { process.stderr.write(m + '\n'); process.exit(1); } });
}
```
Verified: `process.exitCode = 1` plus a printed report exits 1 under `gsd_run memanto` and directly; `ctx.error(msg)` exits 1 with `Error: <msg>`. [VERIFIED: scratch run `probe2`]

### Real-loader harness fragment (test helper)
```js
// test/helpers/gsd-env.cjs
const coreDir = process.env.GSD_CORE_DIR || path.join(os.homedir(), '.claude', 'gsd-core');
const tools = path.join(coreDir, 'bin', 'gsd-tools.cjs');
function gsd(args, { cwd, home, env } = {}) {
  return spawnSync(process.execPath, [tools, ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, GSD_HOME: home, GSD_WORKSTREAM: '', GSD_PROJECT: '', ...env },
  });
}
// registry oracle
const loader = require(path.join(coreDir, 'bin/lib/capability-loader.cjs'));
const reg = loader.loadRegistry({ includeInstalled: true, cwd: proj, gsdHome: home });
const own = reg._overlay.warnings.filter(w => w.id === 'memanto');   // must be []
// dispatch oracle
const gen = require(path.join(path.dirname(coreDir), 'scripts/gen-loop-host-contract.cjs'));
const val = require(path.join(coreDir, 'bin/lib/capability-validator.cjs'));
val.validateHooksWired(reg.capabilities.memanto, gen.getWiredKinds(path.dirname(coreDir))); // must be []
```
Source: all calls executed in scratch runs against both versions. `loop render-hooks` writes load-failure warnings to stderr, so parse stdout only.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Third-party gates skipped on load failure inject a blocking synthetic gate | Load-failed capability gates **fail open** with a loud stderr warning (#2009) | gsd-core ADR-1244 D2 | This is why GATE-06 doctor exists. [VERIFIED: loop-resolver.cjs comment block, scratch run] |
| `execute:pre` undispatched | wired in 1.22.0 (`execute-phase.md:430`: "execute:pre (#5848): read and execute `execute-phase/steps/pre-execute-gate-hooks.md`; a gate block HALTS here") | 1.22.0 | Corrects CLAUDE.md "not dispatched by any released gsd-core (<=1.22.0)". Still unusable at the 1.20.1 floor (0 call sites). [VERIFIED: grep on npm 1.22.0 tree; `getWiredKinds` lists `execute:pre contribution,gate,step` for 1.22.0 only] |

**Observed dispatch matrix from the real scanner (point: kinds):**
- 1.20.1: `discuss:pre|post`, `plan:pre|post`, `execute:wave:post`, `verify:pre`: contribution, gate, step. `execute:post`, `ship:pre`: gate, step. `execute:wave:pre`: contribution, step. `verify:post`, `ship:post`: step only. `execute:pre`: absent.
- 1.22.0: identical plus `execute:pre`: contribution, gate, step.
(`execute:post` has no `contribution` coverage in the scanner, narrower than CLAUDE.md §1.5 prose.) [VERIFIED: scratch run]

**Deprecated/outdated:** the project CLAUDE.md `execute:pre` claim for 1.22.0; the SUMMARY.md suggestion `runtimeCompat ["claude"]`; the D-04 phrase "stderr tail".

## Findings the Planner Must Honor (numbered, referenced above)

- **F1** `execute:pre` is wired in 1.22.0 but not at the 1.20.1 floor; the dispatch test must compute the matrix per host version, and CI "latest" leg will see `execute:pre` as dispatchable while the floor leg does not. Manifest rule: declare only pairs wired on **both** (floor governs).
- **F2** Global scope needs no consent record; project scope needs a record bound to a recomputed bundle hash. [VERIFIED: loader comment text; scratch: global install wrote no `consent.json`, project install wrote one with `contentHash`]
- **F3** Every install leaves `.gsd/capabilities/.staging/`; loader emits a warning for id `.staging`. Zero-warning assertion is by id.
- **F4** Use `getWiredKinds` + `validateHooksWired`.
- **F5** Loader trap reproduction (exact reasons, 1.20.1):
  - `MEMORY-RECALL.md` produced at `plan:pre`: `cross-capability validation error: duplicate-producer invariant violated: artifact "MEMORY-RECALL.md" is produced by two or more capability steps at the same Loop Extensi...` (capability dropped, `loaded=false`).
  - non-host `consumes`: `cross-capability validation failed: capability "memanto" step at point "verify:post" consumes "VERIFICATION.md" which is never produced by any host artifact or capability`.
  - invalid `into`: `contribution.into "planner" at point "discuss:pre" is not in the step's agentRoles [orchestrator]`.
  - `when` on undeclared key: `step.when "memanto.nope" is not defined in capability config keys`.
  - `execute:pre` gate: **loads with no warning or diagnostic**; only the wired-kinds check catches it.
  - reserved prefix: loader rejects ids starting `gsd-`, `gsd-core-`, `anthropic-` (`RESERVED_ID_PREFIX` test at the top of per-candidate processing, loader source read this session); a `skills[]` stem `gsd-memanto-x` did **not** warn, so assert the prefix on `id`, on `ref.skill` stems and by absence of `skills`/`agents` entries.
- **F6** Boolean activation is literal `true` only (see Pattern 4 item 5).
- **F7** Router contract: sync, `{args, cwd, raw, error}`, `args[0]` is the family, `--raw` stripped, `process.exitCode` honored, `error()` exits 1.
- **F8** Doctor signals (table in Pattern 5).
- **F9** Both live endpoints answer `GET /health` 200: `localhost:8000` returns `{"status":"ok"}` in ~3 ms; `plex2.nomorestars.com:8080` returns a larger JSON object whose `status` is `"ok"` (with additional model/provider fields that doctor must not echo). `GET /nonexistent` on `:8000` is 404. [VERIFIED: curl, read-only]
- **F10** The explicit gate-evaluation verb is missing from the discuss call site (Pitfall 1). CLAUDE.md §1.4 treats gates as proven by "the skeleton"; that proof is at the CLI level, not the LLM level.
- **F11** Discuss bypass modes (Pitfall 2).
- **F12** `capability install` default scope is `global`; `--scope project` writes `<project>/.gsd/capabilities/memanto`, `<project>/.gsd-capabilities.json` and a `consent.json` record under `$GSD_HOME/.gsd/`. Global ledger path: `$GSD_HOME/.gsd-capabilities.json`.

## Spike Designs (for `01-SPIKE.md`; D-07..D-10)

Evidence already gathered by this research (starting point; the executor must reproduce into `01-SPIKE.md` and convert each positive into a regression test):

**Q2 `ref.command` step dispatches the third-party family: POSITIVE at the CLI level on 1.20.1 and 1.22.0.** Probe manifest step `{"point":"discuss:pre","ref":{"command":"memanto probe"},"produces":[],"consumes":[],"onError":"skip"}` rendered as `{"capId":"memanto","kind":"step","ref":{"command":"memanto probe"},"onError":"skip"}`; `gsd_run memanto probe --phase 1 --raw` returned `{"probe":"ok","args":["memanto","probe","--phase","1"],...,"raw":true}`, exit 0, on both versions; the value passes `^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$`. The `getWiredKinds` scanner reports `step` as covered at every wired point on both versions. The only unobserved half is an LLM actually executing the step (advisory by design). Phase 1 ships **no** step, so the bundle needs no change; the fallback in D-09 is not triggered.

**Q1 gate halts a real run at `discuss:pre` and `ship:pre`:**
- Deterministic layer (proven): `loop render-hooks` emits the gate; `check predicate` returns `{"block":true,"message":"command exited 1: ...","details":{...}}` with exit 0; a missing bundle also blocks (non-zero from `node`, `block:true`). `ship.md` spells the full evaluation (`Step 1`, `Step 1a`, `Step 2`) and `blocking == true and block == true` halts "do NOT push, do NOT create a PR". Order in `ship.md`: remote check and `gh auth status` come **before** the capability gates, so a ship probe needs a throwaway repo with a local bare `origin` and an authenticated `gh` (the gate blocks before push/PR).
- Live layer (not observed; required by SC5): run `claude -p` headlessly in a throwaway project containing `.planning/{PROJECT,ROADMAP,STATE,config}` for a one-phase project, with the memanto gate that always exits 1, once per variant: A gate only; B gate plus reinforcing `orchestrator` contribution. Record: whether the LLM ran the predicate, whether it stopped before `analyze_phase`, and whether any `*-CONTEXT.md` was written. Repeat for `ship:pre` in the bare-origin repo (assert the bare repo received no branch). Also run `--auto` (headless-safe) and note that `--power` and `--assumptions` bypass (Pitfall 2).
- Constraints found: a throwaway `CLAUDE_CONFIG_DIR` cannot run the real skill (skills live in `~/.claude/skills`, and credentials are per config dir; `ANTHROPIC_API_KEY` is unset here), so the live run necessarily uses the real `~/.claude` and writes session transcripts there. That conflicts with D-07's "never write `~/.claude`" for probes. Resolution to ask the owner (Open Question Q1): treat the live headless run as part of the D-08-approved acceptance run, keep every other probe temp-only. Headless permissions need an explicit allow-list (`--allowedTools` for Bash/Read/Write/Skill) or a permission mode; the exact flag set is `[ASSUMED]` from `claude --help` (`-p/--print`, `--permission-mode`, `--output-format`, `--add-dir` exist; verified by help text only).
- Regression tests that survive without an LLM: (1) `render-hooks discuss:pre` returns the memanto gate; (2) `check predicate` of the rendered predicate returns `block:true` when a check fails and `block:false` when all pass; (3) workflow prose guard: the installed `discuss-phase.md` still contains `dispatch_discuss_pre_hooks` and `render-hooks discuss:pre`, and `ship.md` still contains `Ship blocked by capability gate`; a gsd-core update that removes them fails CI.

**Q3 global-scope skills staged:** source-level answer is **yes, reachable**: `readInstalledCapabilitySkill(stem, registry)` returned `{"capId":"memanto","content":"---\nname: memanto-probe..."}` for a skill shipped at `$GSD_HOME/.gsd/capabilities/memanto/skills/memanto-probe/SKILL.md` in a **global** install (the function is exported from `install-profiles.cjs`; it reads only `$GSD_HOME/.gsd/capabilities/<capId>/skills/<stem>/SKILL.md`, per its docstring read this session). Whether the installer/surface apply copies it into a runtime skills directory was **not** run: running gsd-core's `install.js` was blocked by this environment's permission classifier, so the end-to-end staging (`install.js --claude --global --config-dir <tmp>` or `applySurface` against a temp config dir) is an open spike step requiring owner permission to execute the installer. Phase 1 ships `skills: []` regardless; the answer matters for Phase 3+ and goes into `01-SPIKE.md` with the in-process evidence plus the installer step flagged. Skill stems must not start with `gsd-`.

## Runtime State Inventory

Not a rename/refactor/migration phase; omitted.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node 24's `fetch`/`AbortSignal.timeout` and `--test-reporter=tap` behave as on Node 26 (only 26 was run locally) | Standard Stack, Validation | CI leg fails on Node 24; mitigation: matrix already pins Node 24. |
| A2 | A live headless LLM run follows or ignores the `discuss:pre` gate (not observed) | Pitfall 1, Spike Q1 | Core value risk; the reinforcing-contribution fallback exists. |
| A3 | `claude -p` flags (`--allowedTools`, `--permission-mode`) suffice to let the headless LLM run `gsd_run` | Spike Q1 | Live spike needs rework; help text only. |
| A4 | `npm pack --dry-run --json` returns `files[].path` and the staged set equals `npm pack` output | Standard Stack | Staging script copies the wrong set; verify when `package.json` exists. |
| A5 | `execute:post` contribution coverage on 1.20.1 is absent (scanner result) while CLAUDE.md says code-reviewer contributions are consumed elsewhere | State of the Art | Only matters in later phases. |
| A6 | Nothing in `install-engine`/`surface` consumes `runtimeCompat` in a way that makes `["*"]` worse than `["claude"]` | Pattern 1 | Wrong choice would only add or remove an unused restriction. |
| A7 | npm trusted publishing and `npm stage publish` work for a new package name under the `@taoc` scope with the owner's trusted-publisher setup (copied from pi-mlx-models, not run) | CI/Release | Publish step needs owner debugging; owner-run per D-15. |
| A8 | GitHub check-run names for the release gate (`test (` prefix) will be `test (ubuntu-latest, 1.20.1)` style once a gsd-core version matrix axis is added, so the release workflow's "at least 2 checks" threshold must become 4 | CI | Release workflow refuses or passes incorrectly. |

## Open Questions

1. **Live headless proof vs D-07.** (Needs an owner decision at plan time.)
   - Known: the real skill and credentials live under `~/.claude`; a throwaway config dir cannot run `/gsd-discuss-phase`. The live run writes transcripts to `~/.claude/projects/...`.
   - Unclear: whether the owner accepts that the spike's live gate probe (not only the final acceptance run) touches the real `~/.claude`.
   - Recommendation: run the live gate probe in a temp project and temp `GSD_HOME` but with the real `~/.claude`, and record this in `01-SPIKE.md`; ask the owner once with AskUserQuestion.
2. **Installer run for Q3.** gsd-core's `install.js` could not be executed here (permission classifier). The planner needs an owner-approved step to run it with a throwaway `--config-dir`, or accept the source-level answer.
3. **"Not consented" for a global install.** The roadmap wording presumes consent. Recommendation in Pattern 5 (project-scope record or missing ledger entry); confirm with the owner that this interpretation satisfies SC3.
4. **Repo-controlled `api_url`.** Not a Phase 1 blocker; owner decision before Phase 2 whether to add a user-level endpoint allow-list.
5. **`ship:pre` in the shipped manifest.** CONTEXT.md scopes one gate at `discuss:pre`; the spike probes `ship:pre` only. Recommendation: do not ship a `ship:pre` gate in 0.1.0 (Phase 2 adds gates at every gate-capable point), unless the spike result demands it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | bundle, tests | yes | v26.13.0 (CI floor Node 24) | — |
| npm | pack/staging/CI | yes | 11.20.0 | — |
| gsd-core (installed) | all tests/spike | yes | 1.20.1 at `~/.claude/gsd-core` | — |
| gsd-core 1.22.0 | latest-leg tests | yes (npm install into temp prefix worked) | 1.22.0 | — |
| `memanto` CLI | Phase 2+, fake in Phase 1 | yes | 0.3.0 | fake on PATH |
| Memanto backend `plex2.nomorestars.com:8080` | live acceptance, doctor | yes | `/health` 200 `status:"ok"` | fake REST |
| Memanto REST `localhost:8000` | live acceptance, doctor | yes | `/health` 200 `{"status":"ok"}` | fake REST |
| `claude` CLI (headless live spike) | Spike Q1 live | yes | 2.1.330 | none: deterministic layer only |
| `gh` | ship:pre live probe, CI | yes | 2.103.3 | — |
| `sh` | gate predicate | yes | `/bin/sh` (bash 3.2 posix on macOS) | — |
| git remote | release | yes | `git@github.com:The-Artificer-of-Ciphers-LLC/gsd-memanto.git` | — |
| `@taoc` npm scope access, trusted publisher | D-15 publish | not probed | — | owner prerequisite |

**Missing dependencies with no fallback:** none for planning. Owner-gated: npm scope/trusted publisher (D-15), permission to run the gsd-core installer for Q3, permission posture for the headless live run.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (built in; Node >=24) |
| Config file | none; `package.json` script only (Wave 0) |
| Quick run command | `node --test test/gate.test.cjs test/manifest.test.cjs` |
| Full suite command | `node --test --test-reporter=tap "test/**/*.test.cjs"` (prints `# tests N`; CI awk asserts N > 1, D-13/D-16) |
| Host selection | `GSD_CORE_DIR` env (default `~/.claude/gsd-core`); CI sets it per matrix leg |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INST-01 | staged bundle installs via real CLI into temp `GSD_HOME`; ledger entry; files at `.gsd/capabilities/memanto`; no gsd-core file changed (stat snapshot of `GSD_CORE_DIR/bin` + `workflows` before/after) | integration | `node --test test/install.test.cjs` | Wave 0 |
| INST-02 | `loadRegistry` has `memanto`, `_overlay.warnings` filtered by id empty, `diagnostics` empty; `capability list` status `active` | integration | `node --test test/manifest.test.cjs` | Wave 0 |
| INST-03 | `validateHooksWired(manifest, getWiredKinds(root))` empty; negative: add `execute:pre` gate (1.20.1) or `verify:post` gate and assert errors | unit/integration | `node --test test/dispatch.test.cjs` | Wave 0 |
| INST-04 | negative fixtures from `traps.cjs`-style variants each produce a loader warning for `memanto` (proves the trap), and the shipped manifest has none; manifest has no `gsd-` skill stems, no `MEMORY-RECALL.md`, `consumes` subset of host artifacts | unit | `node --test test/traps.test.cjs` | Wave 0 |
| INST-05 | static scan: all bundle `require()` targets are `node:` builtins or relative; no symlinks, no `node_modules`; `route()` return is not thenable; bundle tree digest identical before and after running gate + doctor (no runtime state); `npm pack --dry-run --json` file list equals staged list and excludes `test/`, `.planning/`, `tools/` | unit | `node --test test/bundle.test.cjs` | Wave 0 |
| CONF-01 | `render-hooks discuss:pre` returns 0 hooks for `enabled` false/absent/`"false"`, 1 gate for `true`; no memanto process when disabled | integration | `node --test test/activation.test.cjs` | Wave 0 |
| CONF-02 | gate blocks `[agent-id]` for `""`, whitespace, missing; passes with a value | integration (gate via `check predicate`) | `node --test test/gate.test.cjs` | Wave 0 |
| CONF-03 | health: fake REST 200+ok passes; non-2xx, `status != "ok"`, invalid JSON, timeout (5s budget, use a short injected timeout in tests), connection refused, empty URL, no scheme: each blocks with its own id; both URLs checked | integration with fake REST | `node --test test/health.test.cjs` | Wave 0 |
| GATE-03 | `mempalace.enabled: true` blocks naming both "Memanto" and "MemPalace"; `"true"`/absent/false pass | integration | `node --test test/gate.test.cjs` | Wave 0 |
| GATE-06 | doctor errors: enabled-not-loaded (empty home), project-scope consent revoked, engines `>=9.0.0`, not-rendering; exit non-zero; `--raw` shape `{checks:[{id,status,message,fix}]}`; exit 0 on warn-only; doctor performs no writes (digest of home + project unchanged) and zero `memanto` spawns | integration | `node --test test/doctor.test.cjs` | Wave 0 |
| TEST-01 | the helpers themselves: temp `GSD_HOME`, real loader, real `render-hooks`; real `~/.gsd` untouched assertion | infra | covered by the above | Wave 0 |
| TEST-02 | fake REST (`node:http`, port 0, scripted status/body/delay) and fake `memanto` argv recorder on temp `PATH`; assertion that gate and doctor spawn it zero times in Phase 1 | integration | `node --test test/gate.test.cjs test/doctor.test.cjs` | Wave 0 |
| contract (D-05) | gate resolver equals `gsd_run config-get` for `memanto.*` and `mempalace.enabled` across the matrix in Pattern 4 | integration | `node --test test/config-contract.test.cjs` | Wave 0 |
| budget (D-04) | all six checks failing with long URLs: `check predicate` `message.length <= 2000` and ends with the break-glass line | integration | `node --test test/gate.test.cjs` | Wave 0 |
| spike regressions (D-10) | render-hooks gate present; `check predicate` block/pass; `memanto probe`-style `ref.command` dispatch against a temp probe bundle; workflow prose guard (`dispatch_discuss_pre_hooks`, `Ship blocked by capability gate`); in-process `readInstalledCapabilitySkill` for a global probe skill | integration | `node --test test/spike-regression.test.cjs` | Wave 0 |
| acceptance (SC1/SC2, D-08) | real global install + headless `/gsd-discuss-phase` halts then passes | manual/agent-run, not CI | recorded in `01-SPIKE.md` / acceptance log | n/a |

### Sampling Rate
- **Per task commit:** the quick command for the touched area (each test file runs in a few seconds; each CLI spawn about 0.1-0.3 s)
- **Per wave merge:** full suite against the installed 1.20.1
- **Phase gate:** full suite green on 1.20.1 and 1.22.0 (`GSD_CORE_DIR` swap), then the D-08 acceptance run, before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `package.json` (`name @taoc/gsd-memanto`, `engines.node >=24`, `files` whitelist, `test` script with tap reporter), `.npmrc` (`save-exact=true`), `.gitignore`, `LICENSE`, `CHANGELOG.md` with `## Unreleased`
- [ ] `test/helpers/gsd-env.cjs` (temp `GSD_HOME`, temp project, install, `gsd()` spawner, registry oracle), `test/helpers/fake-api.cjs`, `test/helpers/fake-memanto.cjs`
- [ ] All test files above (RED first; TDD mode is on)
- [ ] `tools/stage-bundle.cjs` (stage + install to temp `GSD_HOME`; `--real` flag for the real home)
- [ ] CI: `.github/workflows/ci.yml` (matrix `os x gsd-core` with check names `test (<os>, <ver>)`), `publish.yml` adapted from pi-mlx-models (release gate threshold updated for the extra axis)

## Security Domain

`security_enforcement` is enabled (absent in config means enabled; `security_asvs_level: 1`).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no credentials in Phase 1) | — |
| V3 Session Management | no | — |
| V4 Access Control | partial | Consent/ledger is the host's; the capability must not widen it (no `hooks`, no `mcpServers`, no shared-file edits) |
| V5 Input Validation | yes | `new URL()` parse, scheme allow-list (`http:`/`https:`), reject userinfo in output, trim and type-check config values; never interpolate config into a shell string |
| V6 Cryptography | no | — |
| V7 Error handling/logging | yes | Redact `user:pass@` in URLs; never print the health response body; cap message lengths |
| V10 Malicious code / supply chain | yes | Zero runtime dependencies; copy-only install; static scan test; exact-pinned CI host version |
| V14 Configuration | yes | Defaults `""` (no implicit endpoint/agent); break-glass is the single documented switch |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection through config into the `sh -c` predicate | Tampering / Elevation | Static command string; gate reads config in-process |
| Repo-planted `.planning/config.json` pointing `api_url` at an internal or attacker host | Info disclosure / SSRF | Phase 1: GET `/health` only, no body echoed; Phase 2 owner decision on an allow-list; doctor prints resolved URLs |
| Tampered installed bundle | Tampering | Global scope has no hash binding (documented); `--integrity sha512-` for npm installs; project scope is hash-bound |
| Fail-open when capability not loaded | Elevation / DoS of guarantee | Doctor GATE-06 signals; README caveat; stderr warnings from the host |
| Secrets in messages | Info disclosure | No tokens exist in Phase 1; URL userinfo redacted; cap lengths |
| Gate bypass modes (`--power`, `--assumptions`) | Elevation | Documented, doctor `warn`, owner decision later |
| Typosquat / hostile package | Spoofing | No new runtime packages; CI host SUS flag above |

## Sources

### Primary (HIGH confidence)
- Installed gsd-core 1.20.1 source read this session: `bin/lib/gate-predicate-evaluator.cjs`, `gate-predicate.cjs`, `capability-activation.cjs`, `capability-loader.cjs` (overlay roots, consent gate, skip/blockedGates), `loop-resolver.cjs` (fail-open warnings), `capability-command-router.cjs` (list/install), `capability-validator.cjs` (:277-329, :436-493, :495-556, :3770-3846), `capability-registry.cjs` (mempalace entry), `install-profiles.cjs` (`readInstalledCapabilitySkill`), `bin/gsd-tools.cjs` (overlay router :520-641), `config.cjs`/`config-loader.cjs`/`planning-workspace.cjs`, `references/loop-hook-dispatch.md`, `workflows/discuss-phase.md`, `ship.md`, `plan-phase.md`, `verify-work.md`, `discuss-phase/modes/*`, `~/.claude/skills/gsd-discuss-phase/SKILL.md`
- gsd-core 1.20.1 and 1.22.0 npm packages unpacked in `$SCRATCH/core1201`, `$SCRATCH/core1220` (`scripts/gen-loop-host-contract.cjs`, workflows)
- Scratch runs listed in this document (install, render, check predicate, doctor-signal probes, trap fixtures, candidate manifest on both versions)
- Live read-only: `curl` `/health` on both endpoints; `npm view` for `@opengsd/gsd-core` and `@taoc/*`; `gsd-tools package-legitimacy check`
- `~/projects/pi-mlx-models/{package.json,.npmrc,.github/workflows/ci.yml,publish.yml}`
- `.planning/phases/01-walking-skeleton/01-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/research/SUMMARY.md`, `.claude/CLAUDE.md`

### Secondary (MEDIUM confidence)
- `claude --help` flag names for the headless spike (help text only)

### Tertiary (LOW confidence)
- None used as authority.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, zero-dependency Node and host versions verified by running them.
- Architecture: HIGH for gate, doctor signals, manifest and harness; MEDIUM for LLM-level gate obedience at `discuss:pre`.
- Pitfalls: HIGH, each reproduced or read from source; Pitfall 1 is a source-read risk pending the live spike.

**Research date:** 2026-11-20
**Valid until:** about 2026-11-27 for host-version-specific findings (gsd-core shipped 1.20.1 to 1.22.0 in two weeks); 30 days for the Node/npm mechanics.
