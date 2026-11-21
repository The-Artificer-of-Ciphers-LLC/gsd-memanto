# Phase 1: Walking Skeleton - Context

**Gathered:** 2026-11-20
**Status:** Ready for planning

<domain>
## Phase Boundary

The capability is installed once, globally, into `$GSD_HOME/.gsd/capabilities/memanto` and enabled in one project. In that project, a real `/gsd-discuss-phase` run either passes or halts at a single blocking `discuss:pre` gate. The gate checks three things: `memanto.agent_id` is not empty, both configured endpoints report healthy, and MemPalace is not enabled. A `doctor` command reports every state in which the capability silently fails open. A `node:test` suite drives gsd-core's real validator, loader and `loop render-hooks` against a stubbed Memanto. The platform spike answers three questions before anything is built on top of them: does a gate halt the run at `discuss:pre` and `ship:pre`, including headless runs; does a `ref.command` step dispatch the `memanto` command family; are global-scope skills staged.

Requirements: INST-01..05, CONF-01..03, GATE-03, GATE-06, TEST-01, TEST-02.

Out of this phase (already scheduled later): agent existence and session checks, the canary, gates at the other lifecycle points, and `setup` (Phase 2). Recall, capture, conflicts and uploads come in Phases 3-5.

</domain>

<decisions>
## Implementation Decisions

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project scope and requirements
- `.planning/PROJECT.md` — core value, constraints, out-of-scope list, key decisions (global install + per-project enable)
- `.planning/REQUIREMENTS.md` — INST-01..05, CONF-01..03, GATE-03, GATE-06, TEST-01, TEST-02
- `.planning/ROADMAP.md` §Phase 1 — goal, five success criteria, research flags (the spike)
- `.planning/research/STACK.md`, `.planning/research/ARCHITECTURE.md`, `.planning/research/PITFALLS.md`, `.planning/research/SUMMARY.md` — manifest contract, loader traps, dispatch matrix, test harness design
- `.claude/CLAUDE.md` — technology stack and "What NOT to use". Caution: some of its install notes assume project scope, but PROJECT.md's global-install decision supersedes them.

### gsd-core capability contract (installed v1.20.1)
- `~/.claude/gsd-core/bin/lib/capability-source.cjs` §`parseSpec` (~:760-811) — supported install source kinds (D-11)
- `~/.claude/gsd-core/bin/lib/capability-loader.cjs`, `capability-validator.cjs`, `capability-consent.cjs`, `capability-lifecycle.cjs`, `capability-activation.cjs` — loader, consent hash, activation, config resolution (D-05)
- `~/.claude/gsd-core/bin/lib/gate-predicate-evaluator.cjs` — `command-exit-zero` semantics, 30s default, 2000-char stderr tail (D-04)
- `~/.claude/gsd-core/bin/lib/capability-registry.cjs` :2673-2846 — first-party mempalace analog; `mempalace.enabled` default false (D-06)
- `~/.claude/gsd-core/references/loop-hook-dispatch.md` — how hooks are dispatched per kind
- Upstream docs at tag v1.20.1, `github.com/open-gsd/gsd-core`: `docs/how-to/publish-a-capability.md`, `docs/how-to/develop-a-capability.md`, `docs/tutorials/build-your-first-capability.md`, `docs/reference/capability-manifest.md`, `docs/explanation/capability-trust-model.md`

### Packaging and release conventions (owner-referenced)
- `~/projects/pi-mlx-models/package.json` — `@taoc` scope, author, license, `files` whitelist, publishConfig (D-12, D-13)
- `~/projects/pi-mlx-models/.github/workflows/publish.yml` — OIDC trusted publishing + `npm stage publish` release pattern (D-15)
- `~/projects/pi-mlx-models/.github/workflows/ci.yml` — ubuntu+macOS matrix, more-than-one-test assertion (D-16)
- `~/projects/pi-mlx-models/.npmrc`, `.gitignore`, `CHANGELOG.md` — repo hygiene conventions

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None in this repo. It is greenfield: only `.planning/` and `.claude/CLAUDE.md` exist.
- gsd-core's own validator and loader can be `require()`d by tests via `GSD_CORE_DIR` (default `~/.claude/gsd-core`) or a devDependency on `@opengsd/gsd-core`.

### Established Patterns
- First-party `mempalace` (in `capability-registry.cjs`) is the shape to mirror for config keys, `when` toggles and lifecycle wiring.
- The pi-mlx-models repo sets the release and CI pattern (see canonical refs).

### Integration Points
- The `discuss:pre` gate is rendered by `workflows/discuss-phase.md` via `gsd_run loop render-hooks discuss:pre --raw`.
- Command family routing goes through `gsd-tools.cjs` (synchronous router, `{args, cwd, raw, error}`) and works only with a committed ledger entry.
- Runtime state belongs in `<root>/.gsd/capability-data/memanto/`, never inside the bundle.

</code_context>

<specifics>
## Specific Ideas

- Live endpoints for development: backend `http://plex2.nomorestars.com:8080`, REST `http://localhost:8000`. Both answered healthy on 2026-11-20. These are dev values only, never shipped defaults.
- The gate message format is one line per failing check, each with the exact fix command, followed by the break-glass line.
- The doctor fallback is the direct `node …/memanto.cjs doctor` invocation, documented for the case where gsd-core will not route the family.

</specifics>

<deferred>
## Deferred Ideas

- Doctor warning when MemPalace is installed or active elsewhere on the machine. This was considered and not chosen for Phase 1, and could be added with the Phase 2 full doctor if wanted.
- Doctor `--fix`, for example re-consent. It was rejected for now because consent writes are a trust decision.

None of the discussion added new capabilities to the phase.

</deferred>

---

*Phase: 01-walking-skeleton*
*Context gathered: 2026-11-20*
