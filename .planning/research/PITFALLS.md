# Pitfalls Research

**Domain:** Third-party, installable opengsd/gsd-core capability that integrates Memanto (v0.3.0) as the GSD project-memory provider
**Researched:** 2026-11-20
**Confidence:** MEDIUM-HIGH. gsd-core loader/validator behavior is HIGH (installed v1.20.1 source read directly: `~/.claude/gsd-core/bin/lib/capability-{loader,validator,trust,lock,lifecycle}.cjs`, plus docs and ADR-2008 in the source checkout `/Users/trekkie/projects/gsd-core`). Memanto CLI surface is HIGH (v0.3.0 `--help` and `memanto status` only). Memanto internals are MEDIUM (upstream docs are dated Dec 2025 and have already drifted from v0.3.0; some behavior is inferred from upstream source and closed issues). Items tagged `[VERIFY]` must be proven by a spike before any phase depends on them.

**Provisional phase labels used in the mapping** (the roadmapper may rename):
- **A** Capability skeleton, install, consent and loader proof
- **B** Memanto adapter: identity, session, interface selection, preflight
- **C** Failure semantics and MemPalace exclusivity (gates)
- **D** Recall and conflicts (discuss, plan)
- **E** Capture (decisions, fixes, uploads, summaries, schedule)
- **F** Test harness and end-to-end cycle
- **G** COVERAGE.md, packaging, docs

---

## Critical Pitfalls

### P-01: Assuming "block always" is enforceable with steps (it is only enforceable with gates, and only while the capability loads)

**What goes wrong:** The design says every Memanto failure blocks the workflow. In gsd-core a `step` is "advisory by construction": it "never blocks or redirects the host workflow"; on error the dispatcher "records a warning and continues" (`gsd-core/references/loop-hook-dispatch.md`, step section; `reference/capability-manifest.md` `onError` row: "Steps are purely additive - they never halt"). The enum value `onError: "halt"` on a step does not change that. Only a `gate` with `blocking: true` can stop the loop. A capture/recall skill that fails mid-way therefore cannot fail the workflow; the LLM following the dispatch prose simply continues.

Second, the block disappears whenever the capability does not load. The loader skips the capability on: failed validation, id/skill/agent/config/command-family collision, `engines.gsd` mismatch, an in-flight `_pending` install, a `buildRegistry` compose failure, or (project scope) no consent record. For a skipped capability that declared a gate, the loop "fails open, but loudly" (ADR #2009: a stderr warning plus `warnings[]` in the `loop render-hooks` envelope; `capability-loader.cjs` lines 655-662 and 927-955). For an unconsented project overlay it is quieter still: `kind: 'unconsented'` is recorded but explicitly "NOT a gate block" (loader line 783-793), so nothing is rendered at all.

**Why it happens:** MemPalace is the mental model (skip-on-error steps); "fail closed" is then bolted on as an `onError` flag without checking what the dispatcher honors. The loader's own comments say gates are fail-open on skip.

**Consequences:** The owner believes memory is authoritative; in reality a GSD upgrade (engines mismatch), a fresh worktree (no consent), or a manifest typo turns Memanto off with one stderr line and the workflow runs memory-less. Worse, partial writes: step 1 of a capture succeeds, step 2 fails silently, and the next recall returns half a story.

**How to avoid:**
1. Express every block as a gate: `check.predicate = { kind: "command-exit-zero", command, timeout }` with `blocking: true` AND `onError: "halt"` (ADR-2008 maps non-zero exit, timeout, and `sh` ENOENT/127 all to `block: true`; a malformed predicate or exit 69 goes through `onError`, so `halt` is the only safe value).
2. Place gates both before (preflight: agent resolvable, session live, canary round-trip) and after (postcondition: the capture ledger shows the expected write landed) each memory-touching point. The post-gate is what converts "step failed silently" into a block.
3. Treat the capability's own load status as a first-class check: a global/`SessionStart`-independent check cannot exist inside a skipped capability, so ship a documented `gsd capability list` + `loop render-hooks <point>` smoke check as a Phase A/F test and in the user docs. State plainly in docs that "block always" means "block while loaded".
4. Do not put `halt` semantics in the COVERAGE.md or SUMMARY as a guarantee; call it "gate-enforced, load-conditional".

**Warning signs:** A capture skill returns an error string and the workflow keeps going. `gsd capability list` shows `inactive` or a warning for `memanto`. `loop render-hooks plan:pre` returns no `memanto` gate.

**Phase to address:** C (design the gate set), A (load-status smoke test), F (fault-injection tests: kill Memanto, bump engines, remove consent, assert behavior).

---

### P-02: Third-party `agents[]` are never staged, so any `ref.agent` step is dead on arrival

**What goes wrong:** The MemPalace analog uses `agents: ["gsd-mempalace-curator"]` dispatched at `ship:post`. For a third-party capability this cannot work: "a third-party capability's `agents[]` are never staged into the agent's instruction context - the staging path that unions third-party skills into a runtime's skills directory has no equivalent for agents" (`docs/reference/capability-manifest.md`, `capability-trust-model.md` line 254, ADR-2363 line 141). The manifest validates, installs, renders in `activeHooks`, and then the Agent tool is asked for a `subagent_type` that does not exist.

**Why it happens:** Copying the first-party manifest shape; docs state the limitation only in the trust section, not in "develop a capability".

**Consequences:** `ship:post` curation and any "curator agent" design silently never runs (step errors are warn-and-continue per P-01).

**How to avoid:** Use `ref.skill` only. Put the curator logic in a skill body and, if isolation is wanted, have the skill spawn its own subagent. Do not declare `agents[]` at all (a declared-but-unstaged agent still counts toward stem ownership and consent semantics). `[VERIFY]` in Phase A: install a stub capability with one skill and one `plan:pre` step, run `/gsd-plan-phase`, confirm the dispatcher resolves the skill. The dispatcher calls `Skill(skill="gsd-" + ref.skill)`; confirm how a third-party stem is named once staged so the `gsd-` prefix expectation is satisfied.

**Warning signs:** `◆ Spawning <agent>...` banner appears and nothing returns; "agent type not found".

**Phase to address:** A (spike proves skill dispatch end to end), then every phase that adds a step.

---

### P-03: A single validation error skips the entire capability (artifact names, `consumes`, `into` roles, `when` keys, produces collisions)

**What goes wrong:** Per-candidate validation is all-or-nothing (`capability-loader.cjs` 677-841). Concrete traps found in the validator:
- **`consumes` must be satisfiable.** Host artifacts are only `CONTEXT.md` (available from `discuss:post`), `PLAN.md` (`plan:post`), `SUMMARY.md` (`execute:post`), `UAT.md` (`verify:post`) (`capability-validator.cjs` 43-65). The project plan wants to upload "PLAN, SUMMARY, VERIFICATION". `VERIFICATION.md` is not a host artifact; a step with `consumes: ["VERIFICATION.md"]` fails `validateConsumesGlobal` and the whole capability is skipped. A `SUMMARY.md` consumer at `execute:wave:post` fails (earliest availability is `execute:post`).
- **`produces` must be unique per point across first-party plus overlay.** MemPalace already produces `MEMORY-RECALL.md` at `plan:pre` and is always in the merged set regardless of `mempalace.enabled`. If Memanto's recall step also produces `MEMORY-RECALL.md` at `plan:pre`, Memanto is rejected on every machine. Use a distinct name (for example `MEMANTO-RECALL.md`).
- **`when` must name a key in the capability's own `config`.** `when: "memanto.agent_id"` is truthy only when non-empty; with the "no implicit default" rule (empty string) every step guarded by it is silently inactive. Guard on a boolean `memanto.enabled`; validate agent id inside the gate.
- **`contribution.into` must be a role the point publishes**, and delivery is landing-site-specific: `discuss:*`, `verify:*`, `ship:*` publish only `orchestrator`; `execute:*` only `executor`/`verifier`/`code-reviewer`; a `verifier` contribution is delivered only at `execute:post`, a `code-reviewer` only at the review step's point. Wrong combos validate but never render.
- **Contributions are static text** (`fragment.path` is read at load time and inlined). They cannot carry live recall results. Recall must be a step that writes an artifact, plus a contribution that tells the role to read it.
- **Reserved prefixes:** `gsd-`, `gsd-core-`, `anthropic-` ids are rejected, and the publish doc says not to use them for the npm package name either. The repo is named `gsd-memanto`; the capability folder, `id`, and package must NOT be (`memanto` / `gsd-cap-memanto` style; note `gsd-cap-*` is the doc's own example, but the rule is on the `id`).
- Capability folder name must equal `id`; `version` and `runtimeCompat` (feature role) are mandatory; `tier` and `requires: []` too.
- The `wired kinds` check (a manifest registering a kind at a point whose host workflow never dispatches it) runs only in the first-party generator (`validateHooksWired`, `gen-capability-registry.cjs`); the overlay loader path read above never invokes it. A third-party gate or step at an unwired (point, kind) installs cleanly and is silently never dispatched. `[VERIFY]` per point.

**Why it happens:** The first-party generator surfaces these as build errors; a third-party author only sees them as a `warnings[]` entry at load time, and only if they look.

**Consequences:** "Installed but nothing happens" (and per P-01, gates fail open).

**How to avoid:** Phase A test = call `loadRegistry({ includeInstalled: true, cwd, gsdHome: <temp dir>, hostVersion })` against the real loader, assert `_overlay.warnings` has no entry for `memanto` and `memanto` appears in the composed registry. Run it in CI against the installed gsd-core version AND the lowest `engines.gsd` version claimed. Then run `gsd loop render-hooks <point> --raw` for every declared point and assert each declared hook appears. Add a lint over the manifest for the specific traps above.

**Warning signs:** `capability list` shows a warning reason beginning "failed validation:" or "cross-capability validation failed:". Hook not present in `render-hooks` output.

**Phase to address:** A (manifest + loader test), then re-run on every manifest edit (F).

---

### P-04: Project-scope consent is per machine, per realpath, per bundle hash (worktrees, clones, CI and in-place edits make the capability inactive)

**What goes wrong:** A project-scope overlay (`.gsd/capabilities/memanto`) activates only if the user-owned consent store (`~/.gsd/consent.json`, outside any repo) has a record keyed by `(realpath(projectRoot), id)` bound to the RECOMPUTED content hash of the whole bundle (`capability-loader.cjs` 770-794, `project-root.cjs consentProjectRoot`). Consequences:
- A git worktree, a fresh clone, a CI runner, a second machine, or a moved directory has a different realpath: capability is "discovered but inactive". Heavy worktree use (this owner uses `.claude/worktrees/*`) means each worktree needs its own `gsd capability install --yes`.
- Any byte change in the bundle (a README edit, a test file, a script tweak, `node_modules` if shipped) changes the hash and deactivates it. The bundle hash excludes only `__pycache__` `.pyc/.pyo` files. Editing the installed copy during development silently deactivates it.
- Install and update need `--yes` when the manifest has executable surfaces (`hooks`, `commands`, `mcpServers`); without a TTY the router prints "Re-run with --yes" and does not install (`capability-command-router.cjs` 288-319).
- A crashed install leaves `_pending` in the ledger and the capability is "deferred until reconciliation"; reconcile only runs as a side effect of the next install/update/remove (no standalone command, `capability-lifecycle.cjs` ~1214), so users get stuck on "install/upgrade in progress".
- Staging lock `.gsd/capabilities/.lock` has a 60 s stale window and pid-liveness logic (`capability-lock.cjs`); two concurrent `gsd capability` runs (for example a script that installs per worktree in parallel) contend.

**Why it happens:** Consent is a security feature (TRUST-1/TRUST-3), not an install-state flag, so "installed" and "active" are different facts.

**Consequences:** Intermittent "Memanto isn't recording in this worktree" with no loud signal (see P-01).

**How to avoid:** Decide scope deliberately in Phase A. Global scope (`$GSD_HOME/.gsd/capabilities`) needs no per-project consent and is robust to worktrees/clones; because every key defaults `memanto.enabled=false`, a global install is inert until a project opts in via config. Recommend global install as the default path and project scope as an option (flag as owner decision: PROJECT.md says "a project's `.gsd/capabilities/memanto`"). If project scope stays, ship a `scripts/install-here.sh` that runs `gsd capability install <src> --scope project --yes`, and document the per-worktree step. Never edit files under the installed dir; develop in the source repo and `gsd capability update`/reinstall. Keep the bundle minimal (exclude tests, node_modules, docs from the published bundle) so the hash and the consent surface stay small. Document `gsd capability trust list` / `revoke`.

**Warning signs:** `capability list` shows `status: inactive`, reason "discovered - no user consent record (inactive)". Capability works in the main checkout but not in a worktree.

**Phase to address:** A (scope decision, install script), G (docs), F (test: install into a temp project and a second path, assert activation each time).

---

### P-05: `engines.gsd` range is a hard gate at install AND at every load; too tight silently removes the capability on GSD upgrade

**What goes wrong:** A range such as `>=1.20.1 <1.21.0` means the next minor GSD upgrade skips the capability at load with a warning (`capability-loader.cjs` 723-728) and, per P-01, any gate it declared fails open. Too loose (`>=1.6.0`) promises compatibility with versions that lack `command-exit-zero` gate evaluation (ADR-2008, 2026-07) or the gate dispatch at some points.

**Why it happens:** Pinning to "what is installed" feels safe; nobody tests the lower bound.

**How to avoid:** Set the lower bound to the first GSD version where every used feature exists (at minimum the version that added `check predicate` and the `version` field, 1.6.0+ ecosystem; verify the exact floor against release notes), upper bound open-ended or next major, and use `compatVersions` for graceful downgrade. CI matrix: lowest supported GSD, installed 1.20.1, latest. Re-run the P-03 loader test per version. Note `loadRegistry` returns the frozen first-party registry unless `includeInstalled` is truthy, so any host consumer that omits it never sees overlay keys. `[VERIFY]` that `gsd config-set memanto.enabled true` and `gsd config-get` accept federated overlay keys on the installed version.

**Warning signs:** "incompatible with GSD x.y.z (requires engines.gsd ...)" in warnings after `gsd update`.

**Phase to address:** A (set range), F (matrix), G (release checklist: bump check on every gsd-core release).

---

### P-06: The Memanto "active agent" is machine-global, CLI memory commands have no `--agent`, and `auto-activate` resumes the LAST active agent (cross-project leakage)

**What goes wrong:** The active agent is the `~/.memanto/sessions/active` marker "shared by the CLI, coding-tool hooks, the MCP server, the desktop widget and the editor extensions" (upstream `docs/CLI_USER_GUIDE.md`). In v0.3.0 `remember`, `recall`, `answer`, `upload`, `edit`, `forget` take no `--agent` flag (only `detect-conflicts`, `conflicts`, `daily-summary` do). `memanto status` on the development machine showed the active agent was an unrelated test agent, not `memanto-dev`. Therefore:
- Project A and project B (or two worktrees, or an interactive session and a cron run) share one active-agent pointer. A write made after another process switched it lands in the wrong namespace (`memanto_agent_<id>`), invisibly.
- `memanto agent create` "creates a new agent and activates it immediately" and `agent activate` switches the global pointer: a capability that bootstraps or "ensures the session" mutates every other tool's target on the machine.
- `agent auto-activate on` "applies to every tool on this computer" and "resumes the last active agent when none is active": with it on, a write with no explicit agent goes to whichever agent was last used, possibly another project's.
- The MCP server resolves an omitted `agent_id` to the machine-active agent, else `MEMANTO_DEFAULT_AGENT_ID`, and `MEMANTO_AGENT_AUTO_CREATE` defaults to `true`: a typo in the configured id silently creates a new empty agent and recall returns nothing (looks like "no memories", not an error).
- Namespace is `memanto_agent_<agent_id>` and is isolated by Moorcheh API key only; the same `agent_id` under the same key is the same namespace for every project and every teammate sharing the key. A generic id like `my-assistant`, `project`, or `memanto-dev` collides.
- Upstream history shows this class of bug is live: #884 (shared client session token mutated per agent id leaked memories across concurrent users, closed), #1940 (cross-tenant leak fix).

**Why it happens:** Memanto's UX is "one active agent per computer"; a per-project capability fights that model.

**Consequences:** Cross-project memory pollution (decisions from project A recalled into project B's plan), or writes into the dev agent, both undetectable by exit code.

**How to avoid:**
1. Config key `memanto.agent_id` (default empty, gate fails on empty) with a deterministic recommended form `<project_code>-<short-hash-of-project-identity>` (the reserved `gsd-` prefix applies to capability ids, not Memanto agent ids, but avoid it to prevent confusion). Never ship `memanto-dev` anywhere except test fixtures.
2. Prefer the MCP path with an explicit `agent_id` on every call (no global pointer). Disable `MEMANTO_AGENT_AUTO_CREATE` for the capability's MCP entry so a typo is an error.
3. For the CLI path, wrap every operation in a verify-then-act helper: read the active agent, compare to `memanto.agent_id`, activate only if different, and re-verify immediately before the write; serialize with a lockfile so two capability runs do not interleave; never call `agent create` implicitly (provision once via an explicit, documented command; fail the gate if the agent does not exist).
4. Do not run `agent auto-activate on` from the capability; detect its state and document it as the owner's global choice. `[VERIFY]`: whether an env var or flag selects the agent per process (`MEMANTO_*`), which would remove the whole race.
5. Add a canary: write a memory tagged `gsd-canary:<run-id>`, recall by that tag, assert the namespace in the response equals `memanto_agent_<configured id>`, then `memory expire` it.

**Warning signs:** `memanto status` active agent differs from the configured one. Recall returns another project's decisions. A new, empty agent appears in `memanto agent list`.

**Phase to address:** B (identity + verify helper + canary), C (gate uses it), F (concurrency test: two projects, two agents, interleaved runs).

---

### P-07: Session expiry vs. global side effects (activation duration, auto-activate, long GSD runs)

**What goes wrong:** Sessions are JWTs, 6 h default (`agent activate --hours`, note upstream docs say `--duration-hours` but v0.3.0 `--help` shows `--hours/-h`: documentation drift). A multi-wave execute-phase or an overnight autonomous run outlives 6 h. With auto-activate off, "a lapsed session returns an error asking you to run `memanto agent activate`" (MCP README). The tempting fix (turn `auto-activate on`) is a machine-global switch that also enables the "resume last agent" leak in P-06. The other tempting fix (activate before every call) mutates the global pointer (P-06) and, with the per-agent concurrency history (#1453 agent creation race, #1478 on-prem 403 from a token mismatch), can race.

**How to avoid:** Own the session explicitly: the preflight gate checks `memanto status` remaining time for the configured agent and re-activates (with `--hours` sized to the run) only when below a threshold, then re-verifies identity. Put the threshold and duration in config (`memanto.session_hours`, `memanto.session_min_remaining_minutes`). Treat "session expired mid-capture" as a retry-once-then-block condition, never as a silent skip. The PROJECT.md requirement "auto-activates the configured agent session (`agent activate` / `auto-activate`) so expiry is invisible" must be narrowed to "activate the configured agent" unless the owner accepts the global switch; flag for decision. `[VERIFY]` that parsing "Remaining 5h 29m" from the dashboard is the only way to read the expiry (see P-08).

**Warning signs:** "session expired" errors after hour 6; status shows Remaining under an hour at wave boundaries.

**Phase to address:** B (session helper), C (gate threshold), F (test with a short `--hours` and a stubbed clock).

---

### P-08: Memanto CLI output is not machine-parseable, and exit code 0 does not mean healthy

**What goes wrong:** v0.3.0 has no `--json` or `--quiet` on any command. Even piped (non-TTY), `memanto status` prints a Unicode box-drawn Rich dashboard. It exited 0 while the dashboard showed "Moorcheh: disconnected" under the local REST API panel, and it prints a session-token prefix. `remember`, `upload`, `recall`, `answer` print human panels ("OK File uploaded successfully!"). `conflicts` is interactive. Command help text and upstream docs already diverge (`--duration-hours` vs `--hours`; `memanto agent activate` vs docs' `python -m cli.main`).

**Why it happens:** The CLI targets humans; the machine interface is the REST API (`/api/v2/...`, session token header) and the MCP server.

**Consequences:** Regex-scraping the CLI breaks on the next Memanto release; "success" is inferred from absence of an error string; the 2000-char gate-message tail (ADR-2008) pipes a token prefix into the LLM context and logs.

**How to avoid:** Single adapter boundary (one script, one place that knows Memanto) with contract tests that pin the supported Memanto version range and fail loudly when output shape changes. Prefer MCP tool results (structured) interactively; for headless prefer the REST API with `curl`-level JSON when `memanto serve` is the chosen deployment, else the CLI with strict, narrow parsers (match one anchored line per fact, never the whole panel). Verify by effect, not by exit code: canary round-trip (P-06), and for uploads recall a unique token from the uploaded file. Redact `Session Token` lines before they reach stdout/stderr of any gate. Gate `memanto --version` against a supported range (`memanto version: 0.3.0` is the single-line format). `[VERIFY]` the exit-code contract for each command against a throwaway dev agent in Phase B (research was read-only).

**Warning signs:** Parser tests pass on a fixture but fail after `uv tool upgrade memanto`. A gate "passes" with Moorcheh disconnected.

**Phase to address:** B (adapter + contract tests), F (golden-output fixtures, version-bump canary).

---

### P-09: MCP availability: separate package, narrower tool set, headless denial, and a non-first-party manifest field

**What goes wrong:**
- Memanto's MCP server is a separate pip package (`memanto-mcp`, requires `memanto>=0.2.13`), registered by the user's runtime config. Its 7 default tools are `remember`, `batch_remember` (max 100), `recall`, `recall_recent`, `recall_as_of`, `recall_changed_since`, `answer`. There is NO MCP tool for `upload`, `detect-conflicts`/`conflicts`, `daily-summary`, `edit`, `forget`, `memory expire/restore`, `policy`, `schedule`. Four admin tools exist only with `MEMANTO_EXPOSE_ADMIN=true`. So even interactive runs need the CLI for uploads, conflicts, summaries, and expiry, which contradicts "MCP interactive / CLI headless" as a clean split.
- `capability.json` has no first-party `mcpServers` field; the trust module says a third-party manifest "may declare it" and it is disclosed, but nothing in the reviewed code shows it is written into the runtime's MCP config. Do not assume the capability can register the MCP server. `[VERIFY]` in Phase A.
- Headless runs (`claude -p`, cron, CI): project-scoped MCP servers typically need approval, and tools not on the allowlist are denied non-interactively; the model then proceeds without memory and no error reaches GSD. MCP stdio also dies if anything writes to stdout.
- Putting `MOORCHEH_API_KEY` in a committed `.mcp.json` env block leaks the key; the MCP server does not authenticate inbound clients if run over HTTP/SSE with `--host 0.0.0.0`.
- Upstream `memanto connect claude-code` installs its own SessionStart hook and agent instructions (CLAUDE.md edits). #2120 reported that integration's CLAUDE.md made Claude return only reasoning-extraction errors (closed); #1910 reported the SessionStart hook injects expired and superseded memories unlabeled (closed). Running `connect` in addition to this capability gives duplicate, uncontrolled injection and writes that bypass the capability's idempotency and redaction.

**How to avoid:** Make the interface a runtime-detected adapter choice with a single capability contract (`recall`, `remember`, `upload`, `conflicts-list`, `summary`, `expire`), MCP where the tool exists and the CLI otherwise, and a preflight that proves the chosen path works in this run mode (headless preflight must include a real tool call, not tool-listing). Document required Claude Code permissions (`mcp__memanto__*` allowlist) for headless. Never run, recommend, or depend on `memanto connect`; COVERAGE.md marks `connect` OPT-OUT with that reason, and a doctor check warns if a Memanto SessionStart hook or CLAUDE.md block is present. Keep API keys out of repo files (the CLI already stores an encrypted key under `~/.memanto`).

**Warning signs:** Interactive session recalls but headless session "has no memory". Duplicate memory blocks at session start. Agent says "no memanto tools available" and carries on.

**Phase to address:** A (MCP registration spike), B (adapter + headless preflight), G (COVERAGE.md rows, doctor check, docs).

---

### P-10: No idempotency: re-runs, re-plans and re-uploads create duplicate and contradictory memories

**What goes wrong:** `remember` has no dedupe key. GSD re-runs are normal (`/gsd-plan-phase` revisions, `/gsd-execute-phase` resume, gap-closure waves, re-verify). Each re-run re-captures the same decisions. `upload` chunks and embeds the file ("file-sourced results are labelled `file upload - summary/chunk`"); there is no documented replace-by-name, and the CLI output returns no memory ids to delete later. Upstream confirms contradiction handling is thin: #1418 reported the validation/supersede path was dead code (store "deadline April 15" then "April 22" and both stay active; closed, but verify behavior on v0.3.0). The nightly job's `detect-conflicts` is a report, not a writer.

**Consequences:** Recall returns near-duplicates and stale values; `answer` (RAG) averages contradictions; prompt context bloats; users lose trust.

**How to avoid:**
1. Deterministic identity per memory: tags like `gsd:p=<project_code>,phase=<N>,kind=decision,key=<sha1 of normalized text>` and a pre-write `recall --tags ...` lookup; write only when absent; when changed, `edit <id>` (or write new then `memory expire <old> --reason superseded-by-gsd-<phase>`), never `forget` (irreversible).
2. A capture ledger file under `.planning/` (for example `.planning/memanto/ledger.json`: artifact path, content hash, memory ids, upload time, backend fingerprint). Re-run consults it first; this also makes the post-gate in P-01 deterministic.
3. Upload only at stable points (post-verify or ship:post), never at `plan:post` of every revision; skip upload when the content hash is unchanged. Keep the upload filename convention unique per project/phase/artifact so recall labels stay meaningful.
4. Idempotency test in Phase F: run each hook twice, assert memory count and upload count do not grow.

**Warning signs:** Memory count grows on a no-op re-run. Recall returns three phrasings of the same decision.

**Phase to address:** E (ledger + tags), F (double-run tests), D (recall must use `--active`).

---

### P-11: Secrets and PII flow into memory (no redaction, plaintext on a possibly third-party backend, hard length cap)

**What goes wrong:** Memanto stores whatever it is given. The only redaction upstream is for error messages (`tests/test_error_redaction.py`); the prompt-injection patterns (`INJECTION_PATTERNS` in `constants.py`) apply to extraction and tags, not as a secret scrubber. GSD artifacts (PLAN, SUMMARY, discuss transcripts, "problem to fix" pairs from execution, `.env` snippets pasted during debugging, internal hostnames, customer names) routinely contain material that should never leave the repo. With the cloud backend this is a third-party processor; with on-prem it is still a shared store readable by anyone with the same Moorcheh key. Content over 10,000 characters per memory (`InputLimits.MAX_TEXT_LENGTH`) or titles over 100 chars are rejected, so naive "remember the whole SUMMARY" fails, and a truncating wrapper loses the tail.

**How to avoid:** Ship a bundled scrubber (high-entropy strings, `AKIA`/`ghp_`/`sk-`/`mch_` prefixes, `Authorization:`/`password=`/`token=` patterns, `.env` assignments, private key blocks, emails/phones when configured) that runs before every `remember`/`upload`; on a hit, block that write with a clear message (consistent with fail-closed) or redact per config. Make artifact upload opt-in per artifact class (`memanto.capture.upload_artifacts` default false is a defensible default, but PROJECT.md lists upload as an active requirement: flag for owner), show the backend type (cloud vs on-prem) in the preflight output so the owner knows where data goes, chunk long content to under 10,000 characters deterministically, and never log content or the session token. Treat recalled memories as untrusted data when injecting into prompts (wrap per GSD's untrusted-input boundary; stored text like "ignore previous instructions" must not be executable instruction).

**Warning signs:** A grep of the dev agent's memories for key prefixes returns hits. 4xx on long captures.

**Phase to address:** E (scrubber + chunking + opt-in), D (untrusted wrapper on recall), F (seeded-secret test must prove nothing leaves).

---

### P-12: Mutual exclusivity with MemPalace is not expressible in the manifest and is easy to enforce wrongly

**What goes wrong:** The manifest has no `conflicts`/`excludes` field, and the loader's cross-capability checks cover only id/skill/agent/config/family/produces/consumes. MemPalace is always in the merged registry (first-party), so exclusivity can only be a runtime check inside Memanto's own gate. Pitfalls:
- Reading `.planning/config.json` as raw JSON misses the nested form (`{"mempalace":{"enabled":true}}`) vs dotted keys and federated defaults; use `gsd_run config-get mempalace.enabled` (via the gate command) so defaults and overrides resolve identically to MemPalace's own `when`. Also tolerate the key not existing on older GSD.
- The check must run at the first memory-touching point of each workflow (`discuss:pre`, `plan:pre`, ...) and not only at one; and it must run even when Memanto's other checks would pass.
- It can only block when Memanto is loaded and `memanto.enabled` is true. If MemPalace is enabled and Memanto is not loaded (P-04), MemPalace runs normally: that is correct, but the owner may expect "enabling one refuses the other".
- MemPalace's skills (`mempalace-recall`, `mempalace-capture`) and its MCP server remain user-invocable; the agent can still call them mid-workflow. The refusal only covers GSD loop hooks. Memanto skill bodies must never instruct the use of MemPalace tools, and vice versa cannot be enforced.
- Switching providers leaves residue: `MEMORY-RECALL.md` and palace content from before; Memanto starts empty by owner decision (no migration), so the first `discuss` after a switch will report "no prior memories". Make that explicit rather than an error.
- Artifact collision (P-03): do not reuse `MEMORY-RECALL.md`.

**How to avoid:** One gate `exclusive-with-mempalace` at every point Memanto registers anything, `when: memanto.enabled`, `blocking: true`, `onError: halt`, command = a bundled script calling `gsd_run config-get mempalace.enabled`, with an error message that names both config keys and the fix (`gsd config-set mempalace.enabled false` or `memanto.enabled false`). Add a Phase F matrix test: (memanto on, mempalace on) blocks at every point; (on, off) passes; (off, on) is untouched; older-GSD with no mempalace key passes.

**Warning signs:** Both capabilities' steps rendering at the same point in `render-hooks`. Duplicate recall blocks in a prompt.

**Phase to address:** C (gate + matrix test), G (docs: switching providers, what residue to expect).

---

### P-13: Block-always creates its own failure modes in a workflow engine (stranded work, lockout, false positives, retry storms)

**What goes wrong:**
- **Late blocks strand completed work.** A `ship:pre` or `verify:post` gate failing after hours of execution blocks shipping because a memory store is down, though the code is done. Blocking at `*:post` after the work exists should never discard or invalidate that work.
- **No break-glass.** If the backend is down (on-prem host asleep, cloud outage, rate limit, expired API key), every GSD command that hits a gate stops, including hotfix and unrelated phases. The only exits are editing config or removing the capability.
- **Gate flakiness trains users to disable the capability.** Gate commands run in `sh -c` inheriting the process env; `memanto` installed under `~/.local/bin` (uv tool) may not be on the PATH of a non-login shell, cron, or a hook subprocess: exit 127 becomes `block: true` ("sh missing (ENOENT, exit 127) => block"). The default gate timeout is 30 s, shorter than a cold on-prem embedding or LLM call. Windows without POSIX `sh` fails closed with 127.
- **Gate output is untrusted context.** Up to 2000 chars of stdout/stderr tail is embedded in the gate `message` and shown to the agent/user.
- **Retry storms.** Under an autonomous/`--auto` loop a persistent block can cause repeated re-dispatch and token burn. `[VERIFY]` autonomous behavior on `block: true`.
- **Gates are LLM-dispatched prose**, "best-effort" per the dispatch contract (only `execute:task` resolvers are hard-wired). A model that skips the gate step is not stopped by the engine.
- **Predicate dispatch is explicitly wired at 7 points** by workflow text (`plan:pre`, `plan:post`, `execute:pre`, `execute:wave:post`, `execute:post`, `verify:pre`, `ship:pre` have `gsd_run check predicate` in the workflow files). `discuss:pre/post`, `execute:wave:pre`, `verify:post`, `ship:post` defer to the generic reference. `[VERIFY]` each point you rely on.
- `/gsd-quick`, `/gsd-fast`, direct skill use, and other entry points do not traverse all points; "every lifecycle stage" is true only for the full discuss-plan-execute-verify-ship path.

**How to avoid:** Define operation tiers (owner decision, record in PROJECT.md): Tier 1 core read/write and identity (always blocks when enabled); Tier 2 enrichments (`detect-conflicts`, `daily-summary`, `schedule`, uploads) block only when the matching `memanto.require.<op>` config is true. Block early (pre-points) and make post-points durable: write captures to a local outbox (`.planning/memanto/outbox/`), flush it at the next gate, and block the NEXT pre-gate while the outbox is non-empty, instead of throwing away the finished phase. Provide one documented break-glass: `memanto.enabled=false` (audited by a line in STATE.md or the ledger), not a hidden degrade mode. Make gate commands self-sufficient: absolute path resolution (`command -v memanto || ~/.local/bin/memanto`, configurable `memanto.bin`), explicit `timeout` per gate sized for the slowest backend, sanitized and truncated output, a PATH-independent error message that says "memanto not found at X". Document the `sh` requirement.

**Warning signs:** Users set `memanto.enabled=false` "just for today" and forget. Gate blocks citing `command not found` or `timed out after 30s`.

**Phase to address:** C (tiers, outbox, break-glass, gate hardening), F (fault-injection: offline backend, missing binary, slow backend).

---

### P-14: Conflict detection does not do what the plan assumes (day-scoped, global report, interactive resolver, backend-sensitive, costly)

**What goes wrong:** PROJECT.md says `detect-conflicts` "runs for the phase topic" and conflicts are resolved with the owner in discuss. v0.3.0's `detect-conflicts` accepts only `--date` and `--agent`: it runs an LLM pass over "the day's session memories" and writes a JSON report to `~/.memanto/conflicts/` (machine-global). It has no topic or phase filter. `memanto conflicts` is an interactive walk-through (needs a TTY; Claude Code's Bash tool is not one); `conflicts --list` is the non-interactive reader. On the on-prem backend, upstream #1329 showed `detect-conflicts` fails for any busy day because the whole day's text is passed as one retrieval query that exceeds the embedding model's 2048-token context (`nomic-embed-text` default) and the server returns HTTP 400 (closed; `[VERIFY]` fixed in 0.3.0 on this on-prem backend). Each run is an LLM/embedding spend (cloud ops quota: free tier is 100K ops/month per upstream MCP README) and re-processes the same day, so calling it at every discuss multiplies cost and re-surfaces already-reviewed conflicts. The nightly `schedule` job also runs it plus an expiry sweep (P-17).

**How to avoid:** Re-scope the requirement to what the tool does: after capture, run `detect-conflicts --agent <id> --date <today>` at most once per phase per day (ledger-guarded), read results with `conflicts --list` and parse narrowly, filter to conflicts whose memories carry this phase's tags, and present them to the owner through GSD's own discuss interaction (the skill asks the owner, then applies the decision with `memory expire <id> --reason ...`). Never drive `memanto conflicts` interactively from an agent. Classify detect-conflicts as Tier 2 (P-13) with an explicit failure message for the on-prem context-limit case. In non-interactive/autonomous discuss there is no owner: record "unresolved conflicts" in CONTEXT.md and block only if `memanto.require.conflict_resolution` is set.

**Warning signs:** HTTP 400 `ollama embeddings request returned error status`. Report file contains conflicts from unrelated phases. Repeated identical conflict prompts.

**Phase to address:** D (conflict flow), B (backend capability probe), F (on-prem and cloud variants).

---

## Moderate Pitfalls

### P-15: Recall returns expired memories by default and can overfetch (stale context injected as truth)

**What goes wrong:** `recall` returns active and expired together unless `--active`; #1910 showed upstream's own SessionStart renderer injected expired memories unlabeled. #2106 (open) documents recall latency from overfetching up to 100 candidates regardless of limit; `answer` is an LLM call (cloud default model `anthropic.claude-sonnet-4-6`, on-prem local model) with different quality between backends.
**Prevention:** Context injection always uses `--active` (or filters on the `[EXPIRED]` label); use `--as-of`/`--changed-since` deliberately; cap `--limit` and `--min-similarity`; label output with memory ids and dates; prefer `recall` over `answer` for planning inputs (deterministic, citable) and use `answer` only as a labeled summary. Budget recall latency inside any gate (do not recall inside a gate).
**Phase to address:** D.

### P-16: Backend differences (cloud vs on-prem vs local) change behavior and where data lives

**What goes wrong:** The capability must be backend-agnostic, but: on-prem embedding context is 2048 tokens (P-14); cloud has an ops quota and different `answer` model; on-prem needs a reachable host (the research machine's on-prem server is a network host, so laptop-offline equals total block per P-13); `memanto use` can switch backends mid-project and recall silently returns a different, possibly empty, store; upstream has export-during-outage data-loss history (#1340, `memory export` silently overwrote MEMORY.md with empty data) so avoid `memory export`/`sync` against a flaky backend.
**Prevention:** Record a backend fingerprint (backend name, on-prem URL hash) in the ledger at first capture; on mismatch, block with "backend changed since last capture" (Tier 1 identity check) unless acknowledged via config; run the contract suite against at least on-prem and a stub cloud shape; never call `login`/`logout`/`use`.
**Phase to address:** B (fingerprint + probe), F (backend matrix).

### P-17: Expiry policy and `schedule` are machine-global and can silently expire or summarize project memory

**What goes wrong:** "Nothing expires until a sweep runs - `memanto policy apply` or the nightly `memanto schedule` job." `schedule enable` installs a nightly job for daily-summary + conflict-detection + expiry-sweep on the whole machine/active agent, not per project. A policy preset that expires `decision`/`context` memories after N days will silently age out GSD project decisions. The scheduled job uses whatever agent is active at run time (P-06). `policy purge` hard-deletes.
**Prevention:** Capability never applies a policy preset or purge. For `schedule`, only detect and report status and require `memanto.schedule.manage=true` plus an explicit agent; document that it is a global side effect. Capture decisions with tags and (if the policy table supports it) a pin rule such as `expire_after: never` for `gsd:` tagged memories; verify with `policy show`. COVERAGE.md marks `policy purge` OPT-OUT.
**Phase to address:** E (schedule), G (COVERAGE).

### P-18: Upload constraints and semantics

**What goes wrong:** Allowed extensions are `.pdf .docx .xlsx .json .txt .csv .md` (server rejects others); server cap is 5 GB (not a practical constraint, but timeouts are); upload is chunked and embedded asynchronously from the user's view ("Completed in 3.21 s"); the file basename becomes the label, so identical `PLAN.md` names across phases/projects blur provenance; uploading `.planning` files containing secrets (P-11) is the real limit.
**Prevention:** Upload a scrubbed copy to a temp path named `<project>-<phase>-<kind>.md`, hash-gate (P-10), verify via recall of a unique sentinel line, delete the temp copy.
**Phase to address:** E.

### P-19: Rate limits, quotas and latency compound across gates and waves

**What goes wrong:** Cloud free tier is 100K ops/month; every recall/remember/answer/upload/status counts; per-wave capture plus preflight at every point plus canaries multiplies calls. Upstream issue #1438 reported a rate limiter that failed open and validation inconsistencies (closed), so limits cannot be predicted from local behavior.
**Prevention:** One preflight per workflow invocation with a short TTL cache file (agent, backend fingerprint, session expiry; invalidated on config change), batch writes (`remember --batch`, MCP `batch_remember`, max 100), summarize per wave not per task, expose `memanto.capture.granularity`. Handle 429 with bounded backoff then block.
**Phase to address:** B (preflight cache), E (batching).

### P-20: REST server confusion (CLI does not need `memanto serve`; status "ok" is not backend health)

**What goes wrong:** The CLI uses an in-process direct client for memory commands (upstream `memanto/cli/client/direct_client.py`); the local REST API (`http://localhost:8000`, `memanto serve`) is "optional, only if using HTTP endpoints". `memanto status` can show REST "ok" while "Moorcheh disconnected". A preflight that probes `localhost:8000` can fail-close on a server the CLI does not need, or pass while the backend is down. `memanto serve`/`ui` are long-running; a capability must not start daemons.
**Prevention:** Gate on an effect-based canary through the chosen interface (P-06/P-08), not on port liveness. Probe REST only if the adapter selected REST. `[VERIFY]` with the server stopped (on a scratch machine) that CLI `recall` still works.
**Phase to address:** B.

### P-21: `onError` / `blocking` semantics table is misremembered

**What goes wrong:** Mixed up values produce silent passes. Facts: steps never halt (P-01). Gate `blocking: true` + check returns `block: true` stops the step; gate `onError` applies only when the check command itself fails (non-zero exit of `gsd_run check ...`, including exit 69 = "could not look"); `skip` treats it as non-blocking. A `command-exit-zero` non-zero or timeout is a verdict (`block: true`), not an error. `agentVerdict` gates are forced advisory (`blocking: false` required). Contribution `onError` is optional and advisory.
**Prevention:** Every memory gate: `blocking: true`, `onError: "halt"`, `check.predicate.kind = command-exit-zero`, explicit `timeout`. Unit test that asserts this exact shape for every gate in the manifest.
**Phase to address:** C.

### P-22: COVERAGE.md goes stale or over-integrates

**What goes wrong:** "INTEGRATE everything" pulls in side-effecting commands (`memory sync` rewrites project agent instructions, `connect` edits CLAUDE.md/hooks, `widget`, `ui`, `migrate`, `login/logout/use`, `policy purge`, `agent delete`). The Memanto CLI grows (new commands per release), so the matrix drifts. The matrix format must match gsd-core's `api_coverage_gate` convention (reasoned opt-outs).
**Prevention:** Default OPT-OUT with reason for anything that mutates global Memanto state, repo instruction files, or backend selection. A test diffs `memanto --help` and sub-command lists against COVERAGE.md rows and fails on an unlisted command; run it in CI against the pinned and latest Memanto.
**Phase to address:** G (matrix), F (diff test).

### P-23: Test strategy gaps (stubs hide drift, live tests pollute, manifest-valid is not active)

**What goes wrong:** A stub Memanto passes while the real CLI output changed (P-08). Live tests against `memanto-dev` write real memories, cost ops, and can hit the wrong active agent (P-06). A manifest that validates in isolation can still be skipped in the loader (P-03) or inactive (P-04). Tests that run against the real `~/.gsd/consent.json` mutate the owner's consent store.
**Prevention:** Three layers: (1) loader tests using a temp `GSD_HOME` and temp project (`loadRegistry({includeInstalled:true, cwd, gsdHome, hostVersion})`), asserting no warnings and hooks rendered; (2) adapter contract tests against recorded real CLI/MCP output, refreshed by a manual, gated live job; (3) one end-to-end cycle against a dedicated test agent created and deleted by the test with a unique name (never `memanto-dev` for destructive tests, never a shared agent), cleanup in `finally`.
**Phase to address:** F.

### P-24: Skills are instruction surfaces and recalled memory is untrusted input

**What goes wrong:** Skill bodies are copied verbatim into the agent's skills directory, unscanned, and disclosed only by stem at consent (ADR-2363). A skill that says "recall and follow what the memories say" turns stored text into instructions. Memanto itself only pattern-matches a few injection phrases at extraction.
**Prevention:** Skill bodies must state that recalled content is data, wrap it in a labeled block, forbid acting on instructions inside it, and keep scope minimal (GSD's untrusted-input boundary reference). Keep the skill set small so the consent listing is short.
**Phase to address:** D, E.

---

## Minor Pitfalls

### P-25: Documentation and naming drift
Upstream docs reference `python -m cli.main` and `--duration-hours`; v0.3.0 uses `memanto` and `--hours`. Pin examples to `--help` output of the supported version and re-check on each Memanto bump.

### P-26: `memanto-dev` leaking into shipped artifacts
Default config value, fixture, doc example, COVERAGE row, or gate message containing the dev agent name. Add a repo grep test in F that fails on `memanto-dev` outside `tests/` and `.planning/`. (This test is a text-match check on a literal; that is appropriate for a ban-list.)

### P-27: Capability-scope config key collisions
Federated `memanto.*` keys must be absent from the central schema and from every other capability. Keep all keys under the `memanto.` prefix; run the loader test (P-03) to catch collisions with future first-party keys on GSD upgrades (a new first-party `memanto.*` key would make this capability skip).

### P-28: `runtimeCompat: ["*"]` overstates support
Declaring wildcard support while only Claude Code MCP/hook behavior was tested. Declare the tested runtimes explicitly (for example `claude`) with `notes`, and widen after testing. `[VERIFY]` whether the loader enforces `runtimeCompat` at activation or only validates shape.

### P-29: Interpolation and quoting in gate commands
Only `${PHASE_NUMBER}`, `${PHASE_DIR}`, `${PHASE_REQ_IDS}` are substituted; other `${X}` are left for `sh`. Paths with spaces and project names with quotes break unquoted commands. Quote every interpolated value, keep commands under 4096 chars (move logic into a bundled script), and reference the script by an install-relative path that survives global vs project scope.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Scrape the Rich CLI output with regexes | Works today with no extra deps | Breaks on any Memanto release; false "healthy" | Only behind the single adapter with version pin and contract tests |
| Turn on `agent auto-activate` globally to hide expiry | Zero session code | Machine-global side effect plus "resume last agent" leakage | Never from the capability; owner may choose it manually |
| `agent activate` before every call | Simple CLI wrapper | Races with every other tool; clobbers other projects | Never without verify-then-act plus lock |
| Upload every artifact at every `:post` | Maximal memory | Duplicates, secrets, quota burn | Never; only at stable points with hash guard |
| One giant gate script | Easy to author | 30 s timeout, opaque failures | Never; keep gates to preflight and postcondition checks |
| Skip the capture ledger | Less state | No idempotency, no postcondition for gates | Never |
| `runtimeCompat: ["*"]` | Fewer manifest edits | False support claim | Only after multi-runtime tests |
| Tight `engines.gsd` pin | "Known good" | Capability dies on next GSD minor | Never; use floor plus tested ceiling policy |
| Ship `tests/` and `node_modules` in the installed bundle | Convenience | Larger hash/consent surface, spurious deactivation | Never; publish a minimal bundle |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| gsd-core loader | Treat `capability list` showing the id as "active" | Assert no warnings, status active, and hooks present in `loop render-hooks` |
| gsd-core gates | Use `check.query` for custom logic | Query ids are first-party code; use `check.predicate` `command-exit-zero` |
| gsd-core steps | Expect `onError: halt` to stop the run | Only gates stop; add a post-gate |
| gsd-core contributions | Put dynamic recall text in a fragment | Fragment is static at load; steps write artifacts, contributions point to them |
| gsd-core skills | Expect `agents[]` to be dispatchable | Use skills only (third-party agents are not staged) |
| gsd-core consent | Install once, expect it everywhere | Per realpath and bundle hash; prefer global scope plus per-project enable |
| MemPalace | Reuse `MEMORY-RECALL.md` or assume registry-level exclusivity | Distinct artifact name; runtime gate via `config-get mempalace.enabled` |
| Memanto agents | Rely on the active agent | Pass explicit agent id (MCP) or verify-then-act (CLI); never implicit create |
| Memanto MCP | Assume it covers upload/conflicts/summary | CLI for those; MCP is 7 memory tools plus 4 opt-in admin tools |
| Memanto recall | Inject default recall output | `--active`, bounded `--limit`, labeled and untrusted |
| Memanto backend | Assume cloud semantics everywhere | Fingerprint backend; on-prem has embedding-context and offline limits |
| Memanto status | Treat exit 0 as healthy | Canary round-trip verifies effect |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Preflight (status + canary) at every point | Seconds added per workflow step; gate timeouts | One preflight per invocation with TTL cache | Immediately on on-prem over a network; at scale on cloud ops quota |
| Recall inside gates | 30 s timeout blocks | Recall in steps only; gates do cheap checks | Cold embedding/LLM backend |
| `answer` for every planning input | Latency plus non-determinism | `recall` primary, `answer` optional | Slow local LLM on-prem |
| Overfetch (upstream #2106) | Recall latency regardless of `--limit` | Keep recalls few and targeted | Large agents (thousands of memories) |
| detect-conflicts per discuss | LLM spend, repeated reports, on-prem 400s | Once per phase-day, ledger-guarded | Busy days (query exceeds 2048 tokens) |
| Per-task capture | Quota burn, duplicate noise | Per-wave batching (`batch_remember` max 100) | Large phases |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| No secret scrubbing before `remember`/`upload` | Credentials or PII persisted in a shared or third-party store | Bundled scrubber, deny-list, block on hit, opt-in uploads |
| API key in committed `.mcp.json` env | Key leak | Use the CLI's encrypted store; document untracked MCP config |
| MCP over HTTP/SSE bound to `0.0.0.0` | Unauthenticated memory access (server does not authenticate inbound clients) | stdio only; document |
| Session token prefix in `status` output reaching gate messages/logs | Token exposure to LLM context | Redact before output; never echo `status` verbatim |
| Recalled memory treated as instructions | Stored prompt injection | Untrusted-data wrapper, explicit skill rule |
| Gate commands are not disclosed at consent (only hooks, commands, MCP, lanes are) | User consents to "declarative-only" yet a gate runs shell | Keep gate commands trivially auditable, list them in the README, avoid network calls in gates beyond Memanto |
| Cross-project namespace sharing under one Moorcheh key | One project reads another's decisions | Unique per-project agent id (P-06) |
| `forget`/`policy purge`/`agent delete` from the capability | Irreversible data loss | Never integrate; use reversible `memory expire` with reason |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Block message says only "memanto failed" | User cannot tell binary vs identity vs session vs backend | Distinct, actionable messages per cause with the exact fix command |
| Silent inactive capability (no consent/engines) | User believes memory is on | `memanto doctor`-style check script and a README "verify it's active" step |
| No visible provenance in recalled context | User cannot judge staleness | Include memory id, type, date, active/expired, source in the injected block |
| Break-glass undocumented | Users hand-edit config or uninstall | One documented switch plus an audit line |
| Conflict resolution through an agent-driven interactive TTY | Hangs or fails headless | Agent asks owner in discuss; applies `memory expire` |
| "Memanto starts empty after switching from MemPalace" surprise | Looks like a bug | Say so in the first discuss output and docs |

## "Looks Done But Isn't" Checklist

- [ ] **Manifest installs:** Often missing a clean `_overlay.warnings` - verify with the temp-`GSD_HOME` loader test for the lowest and current `engines.gsd`.
- [ ] **Capability active:** Often missing consent in a new worktree/clone - verify `capability list` shows active in a second path.
- [ ] **Hooks wired:** Often registered at a point/kind the host workflow never dispatches - verify each point in a real run (`loop render-hooks` plus observed behavior).
- [ ] **Block always:** Often only steps - verify a gate exists before and after every memory point, with `blocking:true`, `onError:halt`, explicit `timeout`.
- [ ] **Fails closed when Memanto is down:** Verify with binary missing, wrong PATH, backend offline, expired session, wrong agent id.
- [ ] **Agent identity:** Often relies on the machine-active agent - verify two projects with different agents do not cross-write under interleaving.
- [ ] **No `memanto-dev` default:** Verify grep test passes outside tests/planning.
- [ ] **Idempotent capture:** Verify running each hook twice leaves memory and upload counts unchanged.
- [ ] **Secrets blocked:** Verify a seeded fake key never reaches Memanto.
- [ ] **Recall hygiene:** Verify `--active` and untrusted-data wrapping in the rendered prompt block.
- [ ] **Headless path works:** Verify a `claude -p` run with required permissions performs a real recall and write, not just tool listing.
- [ ] **MemPalace exclusivity:** Verify the four-case matrix at every point, nested and dotted config forms.
- [ ] **Conflicts:** Verify `conflicts --list` path, no interactive TTY dependency, on-prem long-day case.
- [ ] **Session expiry:** Verify a run crossing expiry re-activates the configured agent and re-verifies identity.
- [ ] **COVERAGE.md complete:** Verify the CLI-diff test passes (no undecided command).
- [ ] **Full cycle E2E:** Verify discuss to ship against a dedicated test agent leaves the expected memories, uploads and summaries, and cleans up.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Capability skipped after GSD upgrade (P-05) | LOW | Read warning, widen/adjust `engines.gsd`, `gsd capability update`, re-consent |
| Inactive in new worktree (P-04) | LOW | `gsd capability install ... --scope project --yes` there, or switch to global scope |
| `_pending` stuck install (P-04) | LOW | Run any `gsd capability install|update|remove` to trigger reconcile; inspect `.gsd/capabilities/.staging`, ledger |
| Writes landed in the wrong agent (P-06) | HIGH | Identify by tag/time, `recall` from wrong namespace, `memory expire --reason misrouted` there, re-write in correct agent from the ledger; audit which projects shared the pointer |
| Duplicate memories (P-10) | MEDIUM | Group by tag key, expire older duplicates with a reason; rebuild ledger from tags |
| Secret stored (P-11) | HIGH | Rotate the credential first; `forget` the memory id (owner-run, irreversible); re-scan agent; add pattern to scrubber |
| Stale/contradictory memories (P-15) | MEDIUM | `conflicts --list`, expire superseded, re-run recall hygiene |
| Backend switched under the project (P-16) | MEDIUM | Compare backend fingerprint, `memanto use` back, or accept fresh store and reset the ledger |
| Blocked at ship by outage (P-13) | LOW | Outbox preserved the captures; fix backend, flush outbox, re-run gate; if urgent use documented break-glass |
| Both providers enabled (P-12) | LOW | Disable one config key; clear residual `MEMORY-RECALL.md` if needed |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| P-01 block-always not enforceable by steps; load-conditional | C (gates), A (load smoke) | Fault-injection suite: every failure mode blocks while loaded; documented warning when not loaded |
| P-02 third-party agents unstaged | A | Stub capability skill step dispatches in a real `/gsd-plan-phase` |
| P-03 validation skip, artifact/consumes/produces/when/into traps, reserved prefix, wired kinds | A | Temp-`GSD_HOME` loader test: no warnings, all hooks rendered |
| P-04 consent per realpath/hash, install `--yes`, `_pending`, lock | A, G | Activation verified in a second path; install script tested; docs |
| P-05 engines range | A, F, G | Version-matrix loader test; release checklist |
| P-06 global active agent, auto-activate leak, namespace collision | B, C, F | Interleaved two-project test; canary asserts namespace |
| P-07 session expiry vs global side effects | B, C | Short-session test with re-activate and identity re-verify |
| P-08 unparseable CLI, exit 0 not health | B, F | Contract tests with recorded outputs; effect-based canary |
| P-09 MCP package, tool coverage, headless denial, manifest `mcpServers` | A, B, G | Headless real-call preflight; COVERAGE rows; doctor check for `connect` residue |
| P-10 idempotency | E, F | Double-run test: counts stable |
| P-11 secrets/PII, 10k cap | E, D, F | Seeded-secret test; chunking test |
| P-12 MemPalace exclusivity | C, G | Four-case matrix at every point |
| P-13 block-always failure modes (stranding, lockout, PATH, timeout, tiers, outbox) | C, F | Offline/missing-binary/slow-backend tests; outbox flush test |
| P-14 conflict detection semantics and cost | D, B, F | `--list` flow test; on-prem long-day case; once-per-phase-day guard |
| P-15 recall hygiene | D | `--active` and labeled block in rendered prompt |
| P-16 backend differences | B, F | Fingerprint mismatch test; backend matrix |
| P-17 expiry policy/schedule global | E, G | Capability never applies policy; schedule opt-in test |
| P-18 upload constraints | E | Scrubbed temp upload with sentinel recall verification |
| P-19 rate limits/latency | B, E | Preflight cache; batching; call-count assertions |
| P-20 REST server confusion | B | Canary independent of port 8000 |
| P-21 onError/blocking semantics | C | Manifest-shape unit test for every gate |
| P-22 COVERAGE drift | G, F | CLI-diff test in CI |
| P-23 test strategy | F | Three-layer suite with isolated test agent and temp `GSD_HOME` |
| P-24 instruction-surface and untrusted memory | D, E | Prompt-render test shows data wrapper |
| P-25 to P-29 minor | A, F | Grep and lint tests |

## Sources

- gsd-core installed v1.20.1 source, read directly: `~/.claude/gsd-core/bin/lib/capability-loader.cjs` (skip reasons, gate fail-open, consent gate, compose fallback), `capability-validator.cjs` (`VALID_ON_ERROR`, `validateGate`, `HOST_ARTIFACT_EARLIEST_POINT_IDX`, `validateConsumesGlobal`, `validateHooksWired`), `capability-trust.cjs` (`discloseExecutableSurfaces`, `mcpServers` note), `capability-lock.cjs`, `capability-lifecycle.cjs`, `capability-command-router.cjs` (`--yes`), `project-root.cjs` (`consentProjectRoot`). Confidence HIGH.
- gsd-core source checkout `/Users/trekkie/projects/gsd-core` (docs and workflows, commit ef902f8a20): `docs/reference/capability-manifest.md`, `docs/how-to/develop-a-capability.md`, `docs/how-to/publish-a-capability.md`, `docs/explanation/capability-overlay-model.md`, `docs/explanation/capability-trust-model.md`, `docs/adr/2008-command-exit-zero-gate.md`, `docs/adr/2363-capability-instruction-surface-trust.md`, `gsd-core/references/loop-hook-dispatch.md`, `capabilities/mempalace/capability.json`, workflow files containing `check predicate`. Confidence HIGH (checkout may be newer than installed 1.20.1; `[VERIFY]` workflow wiring on the installed copy).
- Memanto v0.3.0 installed CLI: `memanto --help` and sub-command `--help` output, `memanto status` (read-only). Confidence HIGH for the CLI surface; exit-code contract not measured.
- Memanto upstream (https://github.com/moorcheh-ai/memanto), read via `gh`: `docs/SESSION_ARCHITECTURE.md`, `docs/CLI_USER_GUIDE.md`, `integrations/mcp/README.md`, `memanto/app/routes/memory.py` (upload extensions, 5 GB cap, batch 100), `memanto/app/constants.py` (`INJECTION_PATTERNS`), `memanto/app/utils/validation.py` (`MAX_TEXT_LENGTH` 10000); issues #1329, #1418, #1910, #2106, #2120, #884, #1340, #1437, #1438, #1453, #1478, #1940. Confidence MEDIUM (docs dated Dec 2025 and drifted; issue states may have changed; closed issues are not proof of a fix in 0.3.0).

---
*Pitfalls research for: third-party gsd-core capability integrating Memanto as project-memory provider*
*Researched: 2026-11-20*
