# Phase 1 Spike Outcomes (D-07 to D-10)

Host under test: gsd-core **1.20.1** at `~/.claude/gsd-core` (`package.json` version), Node v26.13.0, macOS.
Every deterministic probe below ran against a fresh temp `GSD_HOME` and a temp project; the owner's real `~/.gsd` was only `stat()`ed.
Regression tests live in `test/spike-regression.test.cjs` (`node --test --test-reporter=tap test/spike-regression.test.cjs`: 9 tests, `# pass 9`, `# fail 0`).

## Q1 — Gate halts a real run (discuss:pre, ship:pre, headless)

Answer: POSITIVE (host layer and live headless layer; 5/5 discuss runs and 2/2 ship runs halted on the memanto gate; variant A only, so the D-09 fallback was not needed)

Caveat that later phases must carry: in all 5 discuss runs the LLM evaluated the gate by running the predicate's `command` itself (`timeout 20 node "$d/scripts/gate.cjs"` or `sh -c '<command>'`), never through `gsd_run check predicate`, because `discuss-phase.md` does not name the verb (F10). In both ship runs it used `gsd_run check predicate`, which `ship.md` spells out. In every run the LLM also read `scripts/gate.cjs` (and once grepped `lib/` for network/spawn/write calls) before running it. A gate whose script looks risky to an LLM reviewer may therefore be refused rather than run; keep the gate script small and legible, and re-observe in the 01-09 acceptance run once the 01-02 health checks (network calls) land.

### Host layer (deterministic)

Evidence (temp home, project config `{"memanto":{"enabled":true,"agent_id":""}}`):

```
$ node tools/stage-bundle.cjs --home <tmp home> --json
{"status":"installed","id":"memanto"}

$ gsd_run loop render-hooks discuss:pre --raw     (memanto entries only)
[{"capId":"memanto","kind":"gate","blocking":true,"onError":"halt"}]

$ gsd_run check predicate --predicate '<rendered check.predicate>' --phase-dir .planning/phases/01-test --phase-number 01 --raw
{
  "block": true,
  "message": "command exited 1: memanto: BLOCKED [agent-id] memanto.agent_id is empty -> gsd_run config-set memanto.agent_id <agent-id>\n(memanto.enabled=false disables Memanto for this project)",
  "details": { "kind": "command-exit-zero", "exitCode": 1, "signal": null }
}
exit=0
```

Missing gate script (installed `<home>/.gsd/capabilities/memanto/scripts/gate.cjs` moved away), same predicate:

```
{
  "block": true,
  "message": "command exited 1: node:internal/modules/cjs/loader:1607\n  throw err; ... Error: Cannot find module '<project>/.gsd/capabilities/memanto/scripts/gate.cjs' ...",
  "details": { "kind": "command-exit-zero", "exitCode": 1, "signal": null }
}
exit=0
```

The gate command falls back to the project-scope path when the global script is absent; with neither present `node` exits 1, so a damaged bundle blocks (fail closed).

`ship:pre` variant (staged bundle copy with a second gate identical to the shipped one except `point: "ship:pre"`, installed into another temp home): `render-hooks ship:pre` returns the memanto gate with `blocking: true`, and `check predicate` returns `block: true` with a message starting `command exited 1: memanto: BLOCKED`.

Host prose that makes the LLM evaluate the gate:
- `workflows/discuss-phase.md:296-301` step `dispatch_discuss_pre_hooks`: runs `gsd_run loop render-hooks discuss:pre --raw`, then "Apply each entry in `activeHooks` per loop-hook-dispatch.md". It does **not** name `gsd_run check predicate` (Pitfall 1 / F10); the LLM must infer it from `references/loop-hook-dispatch.md` § `gate` ("Evaluate `check` ... `blocking: true` → if the check returns `block: true`, surface `check.message` to the user and stop the current step").
- `workflows/ship.md:121-204` spells the predicate call verbatim (`gsd_run check predicate --predicate '<hook.check.predicate as JSON>' --phase-dir "${PHASE_DIR}" --phase-number "${PHASE_NUMBER}" --raw`) and halts with `⚠ Ship blocked by capability gate ({hook.capId}): {message}` — "do NOT push, do NOT create a PR". It runs after preflight steps 1 (verification.status passed), 1a (ROADMAP record complete), 2 (clean tree), 3 (branch), 4 (`origin` remote) and 5 (`gh auth status`).

Regression tests (`test/spike-regression.test.cjs`):
- `Q1 host: discuss:pre renders the memanto gate with blocking true`
- `Q1 host: check predicate blocks with exit 0 and the BLOCKED message for an empty agent_id`
- `Q1 host: a bundle whose gate script is missing still blocks (fail closed)`
- `Q1 host: a ship:pre variant of the gate renders and blocks`
- `prose guard: installed discuss-phase.md still dispatches discuss:pre hooks` (`dispatch_discuss_pre_hooks`, `render-hooks discuss:pre`)
- `prose guard: installed ship.md still halts on a blocking capability gate` (`Ship blocked by capability gate`)

### Live headless layer

CLI: Claude Code 2.1.330 (`claude --version`). Flags taken from `claude --help`: `-p/--print`, `--allowedTools <tools...>`, `--disallowedTools <tools...>`, `--permission-mode` (choices `acceptEdits, auto, bypassPermissions, manual, dontAsk, plan`), `--output-format stream-json`, `--verbose`, `--no-session-persistence`, `--max-budget-usd`. The help lists no turn-count flag, so `--max-budget-usd 5` is the cap. No skip-permissions flag (`--dangerously-skip-permissions`, `bypassPermissions`) was used. `gh auth status` was read before the runs: logged in to github.com (keyring).

Setup per run (scratchpad only): a fresh temp `GSD_HOME` with the staged bundle installed globally (`tools/stage-bundle.cjs --stage-only --json`, then `gsd_run capability install <staged> --yes` → `{"status":"installed","id":"memanto","scope":"global"}`); a throwaway project with `git init` and one commit of `.planning/{PROJECT,ROADMAP,STATE,REQUIREMENTS}.md`, `.planning/phases/01-<slug>/` and `.planning/config.json` = `{"memanto":{"enabled":true,"agent_id":""},"workflow":{"discuss_mode":"discuss","auto_advance":false,"research_before_questions":false}}`. Transcripts were written to the scratchpad (`<scratch>/live/<run>/transcript-*.jsonl`), never into the repo.

Discuss command (run from the probe project; `<prompt>` is `/gsd-discuss-phase 1` or `/gsd-discuss-phase 1 --auto`):

```
GSD_HOME=<scratch>/live/<run>/home GSD_WORKSTREAM= GSD_PROJECT= claude -p "<prompt>" --allowedTools "Bash,Read,Write,Edit,Glob,Grep,Skill" --permission-mode dontAsk --output-format stream-json --verbose --no-session-persistence --max-budget-usd 5 > ../transcript-discuss.jsonl
```

Ship command (ship:pre variant bundle; gh PR/repo/API writes denied as a second guard):

```
GSD_HOME=<scratch>/live/<run>/home GSD_WORKSTREAM= GSD_PROJECT= claude -p "/gsd-ship 1" --allowedTools "Bash,Read,Write,Edit,Glob,Grep,Skill" --disallowedTools "Bash(gh pr create:*)" "Bash(gh pr merge:*)" "Bash(gh repo:*)" "Bash(gh api:*)" --permission-mode dontAsk --output-format stream-json --verbose --no-session-persistence --max-budget-usd 5 > ../transcript-ship.jsonl
```

Env inheritance: in every run the transcript's `gsd_run loop render-hooks <point> --raw` output contained `"capId": "memanto"`, and the gate resolved `d=<scratch>/live/<run>/home/.gsd/capabilities/memanto`, so the headless Bash tool inherited the temp `GSD_HOME`. Every run was valid.

Per-run verdicts (variant A = shipped manifest, gate only):

| Run | Prompt | Project content | render-hooks had memanto | How the gate was evaluated | Block surfaced | `*-CONTEXT.md` / commits | Verdict |
|-----|--------|-----------------|--------------------------|----------------------------|----------------|--------------------------|---------|
| a1 | `/gsd-discuss-phase 1` | probe (mentions the gate) | yes | ran the predicate command via `sh -c` under `perl -e 'alarm 20'`, EXIT=1 | yes | none / none (`git log`: only `init probe project`) | HALT |
| a2 | `/gsd-discuss-phase 1 --auto` | probe | yes | `timeout 20 node "$d/scripts/gate.cjs"`, EXIT=1 | yes | none / none | HALT |
| a3 | `/gsd-discuss-phase 1` | probe | yes | `timeout 20 node "$d/scripts/gate.cjs"`, EXIT=1 | yes | none / none | HALT |
| n1 | `/gsd-discuss-phase 1` | neutral ("Tally" CLI; no mention of memanto or gates) | yes | `timeout 20 node "$d/scripts/gate.cjs"`, EXIT=1 | yes | none / none | HALT |
| n2 | `/gsd-discuss-phase 1 --auto` | neutral | yes | `timeout 20 sh -c '<predicate command>'`, EXIT=1 | yes | none / none | HALT |
| s1 | `/gsd-ship 1` | ship repo, `security_enforcement` default (on) | yes (`ship:pre`) | `gsd_run check predicate --predicate '<json>' --phase-dir ... --phase-number 01 --raw` → `{"block": true, ...}` | yes, plus first-party `security` gate (`SECURITY_SHIP_GATE_NO_REVIEW`) | origin branches before `* main`, after `* main` | HALT (confounded by the security gate) |
| s2 | `/gsd-ship 1` | ship repo, `workflow.security_enforcement: false` (memanto the only `ship:pre` hook) | yes | `gsd_run check predicate ...` → `CHECK_EXIT=0`, `{"block": true, ...}` | yes: `⚠ Ship blocked by capability gate (memanto): memanto: BLOCKED [agent-id] ...` | origin branches before `* main`, after `* main`; `refs/heads/main` only | HALT |

Trimmed transcript lines:

```
a1 #9 CALL Bash: cd "$(git rev-parse --show-toplevel)" && perl -e 'alarm 20; exec @ARGV' sh -c 'd="${GSD_HOME:-$HOME}/.gsd/capabilities/memanto"; ...; exec node "$d/scripts/gate.cjs"'; echo "EXIT=$?"
   RESULT: memanto: BLOCKED [agent-id] memanto.agent_id is empty -> gsd_run config-set memanto.agent_id <agent-id> (memanto.enabled=false disables Memanto for this project) EXIT=1
   FINAL: The memanto gate blocked the discussion for Phase 1 (Probe), and the workflow stopped there. No gray areas were presented, no files were written and nothing was committed.
a2 FINAL: Discuss-phase for Phase 1 (Probe) was halted by the memanto gate at `discuss:pre`, so nothing was written.
n1 FINAL: The agent stopped Phase 1 (Core counter) discussion before asking any questions, because a required pre-discussion check failed.
n2 FINAL: The discussion for Phase 1 (Core counter) did not run. A required check (the memanto gate) failed before it could start, so no `01-CONTEXT.md` was written and nothing was committed.
s2 #4 CALL Bash: ... GATE_RESULT=$(node $T check predicate --predicate "$P" --phase-dir "$PWD/.planning/phases/01-probe" --phase-number 01 --raw) && CHECK_EXIT=0 || CHECK_EXIT=$?
   RESULT: CHECK_EXIT=0 { "block": true, "message": "command exited 1: memanto: BLOCKED [agent-id] memanto.agent_id is empty -> ...", "details": { "kind": "command-exit-zero", "exitCode": 1, "signal": null } }
   FINAL: Ship stopped at the memanto ship gate. Nothing was pushed, no PR was created, and STATE.md was not changed.
```

Run cost and size: discuss runs 7-10 turns, about 34-39 s and USD 0.57-0.67 each; ship runs 4-5 turns, about 25-31 s and USD 0.53-0.57 each (from each transcript's `result` event).

Ship preflight (ship.md steps 1-5), confirmed read-only before each ship run: `verification.status` → `passed` (`01-VERIFICATION.md` frontmatter `status: passed`); `roadmap.analyze` `roadmap_record` → `{"1": true}`; `git status --short` empty (`.memdb/`, `.memtrace/` added to `.git/info/exclude` because the owner's memtrace SessionStart hook creates them in any project); branch `feature/probe`, `is-protected` false; `origin` = local bare repo; `gh auth status` logged in. No preflight needed a network write.

The deterministic `ship:pre` evidence from Task 1 still stands alongside the live result.

Regression tests: the host-layer tests listed above pin every part that runs without an LLM. The live LLM behaviour is not regression-testable in CI; plan 01-09's acceptance run re-observes it on the owner's real home.

Bundle impact: none. Variant A halted every time, so the D-09 fallback (a `discuss:pre` contribution and `fragments/discuss-pre-gate.md`) was not shipped; `capability.json` is unchanged. Owner-facing note: the reinforcing contribution stays available if the 01-09 acceptance run or a later gsd-core release shows a discuss run that does not halt.

## Q2 — ref.command dispatches the memanto family on 1.20.1

Answer: POSITIVE (host level)

Evidence (temp capability `memanto` with `commands: [{family: "memanto", module: "memanto.cjs", router: "route", subcommands: ["probe"]}]`, one step `{point: "discuss:pre", ref: {command: "memanto probe"}, produces: [], consumes: [], onError: "skip"}`, and a synchronous `route(ctx)` that prints `{probe, args, raw}`; temp home, project config `{"memanto":{"enabled":true}}`):

```
$ gsd_run capability install <tmp>/memanto --yes
{"status":"installed","id":"memanto","scope":"global"}
exit=0

$ gsd_run loop render-hooks discuss:pre --raw     (memanto entries only)
[{"capId":"memanto","kind":"step","ref":{"command":"memanto probe"},"onError":"skip"}]
exit=0

$ gsd_run memanto probe --phase 1 --raw
{"probe":"ok","args":["memanto","probe","--phase","1"],"raw":true}
exit=0
```

`memanto probe` matches the dispatch validator `^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$` (`references/loop-hook-dispatch.md` § `step`), and the dispatch shape is exactly `gsd_run ${ref.command} --phase "${PHASE_NUMBER}" --raw`. The router receives `args[0]` = family, `--raw` stripped into `ctx.raw: true`. The unobserved half is an LLM executing the step, which is advisory by design (steps never block).

Regression test: `Q2: a ref.command step renders and gsd_run dispatches the third-party memanto family`.

Bundle impact: none. Phase 1 ships no step; D-09 is not triggered.

## Q3 — Global-scope skills are staged

Answer: POSITIVE (source level in 01-05; confirmed end to end by gsd-core's own `install.js` in plan 01-07, see "Q3 installer run" below)

Evidence (temp capability `memanto` with `skills: ["memanto-probe"]` and `skills/memanto-probe/SKILL.md` (frontmatter `name: memanto-probe`), installed globally into a temp home; in-process with `process.env.GSD_HOME` set to that home):

```
> readInstalledCapabilitySkill('memanto-probe', loadRegistry({includeInstalled: true, cwd: <proj>, gsdHome: <tmp home>}))
{"capId":"memanto","content":"---\nname: memanto-probe\ndescription: probe\n---\nbody\n"}
> installed skill path exists: true   (<tmp home>/.gsd/capabilities/memanto/skills/memanto-probe/SKILL.md)
```

`readInstalledCapabilitySkill(stem, registry)` (`bin/lib/install-profiles.cjs:727`) reads only `${GSD_HOME:-~}/.gsd/capabilities/<capId>/skills/<stem>/SKILL.md`, binds the stem to its declaring capId, and refuses symlinks. It is the reader `stageSkillsForRuntimeAsSkills` (`:867`) calls during the product installer / `applySurface`; it is not called by `capability install`. So a global install makes the skill reachable to the staging pass, and a project-scope install does not (path is under `$GSD_HOME`, not the project).

Plan 01-05 did not run the installer (OD-2). Plan 01-07 ran it after the owner approved the exact commands at a blocking-human checkpoint. Evidence is in the section below.

Regression test: `Q3 source level: readInstalledCapabilitySkill reads a skill shipped in a global install`.

Bundle impact: none in Phase 1 (`skills: []`). Stems must not start with `gsd-`.

### Q3 installer run (plan 01-07)

Answer: POSITIVE. gsd-core's product installer copies a globally installed third-party capability's skill into the runtime config dir. It renames the stem with a `gsd-` prefix.

Staged path (relative to `--config-dir`): `skills/gsd-memanto-probe/SKILL.md`. The file is byte-identical to the probe's `skills/memanto-probe/SKILL.md`. A sibling marker, `skills/gsd-memanto-probe/.gsd-capability-skill`, contains the declaring capId `memanto`. Both files are listed in the config dir's `gsd-file-manifest.json`.

Approval: the owner chose "approve" at the 01-07 Task 1 checkpoint (OD-2, gate `blocking-human`), relayed by the orchestrator. Commands ran on 2026-11-21 (UTC) in this order, and nothing else ran. `S` is `<session scratchpad>/q3-0107`. The executor used a dedicated subfolder of the session scratchpad because sibling executors share the scratchpad root and an unrelated `home/` already existed there. All paths stay inside the scratchpad.

1. `npm install --prefix "S/gsd-core-1.20.1" --no-audit --no-fund --ignore-scripts @opengsd/gsd-core@1.20.1` printed `added 106 packages in 2s` and exited 0. The installed `package.json` reads `@opengsd/gsd-core 1.20.1` and has no `postinstall`.
2. The executor built the probe `S/probe/memanto`: `capability.json` with id `memanto`, role `feature`, `skills: ["memanto-probe"]`, empty steps, contributions, gates and config, and no hooks; plus `skills/memanto-probe/SKILL.md` with frontmatter `name: memanto-probe`. It then ran `GSD_HOME="S/home" node "S/gsd-core-1.20.1/node_modules/@opengsd/gsd-core/gsd-core/bin/gsd-tools.cjs" capability install "S/probe/memanto" --yes` from cwd `S`. Exit 0, `{"status":"installed","id":"memanto","version":"0.0.1","scope":"global", ...}`. The disclosure lists `skill: memanto-probe` as an instruction surface. The bundle landed at `S/home/.gsd/capabilities/memanto/`.
3. `GSD_HOME="S/home" node "S/gsd-core-1.20.1/node_modules/@opengsd/gsd-core/bin/install.js" --claude --global --config-dir "S/claude-config"` (cwd `S`, stdin `/dev/null`) exited 0 with empty stderr. Trimmed stdout:

```
  GSD Core v1.20.1
  Installing for Claude Code to <S>/claude-config
  ✓ Installed workflow assets
  ✓ Installed 73 skills to skills/
  ↳ Agents installed via descriptor-driven layout (claude)
  ✓ Wrote VERSION (1.20.1)
  ✓ Installed hooks (bundled)
[legacy-cleanup] Removed 0 legacy artifact(s).
  ✓ Wrote file manifest (gsd-file-manifest.json)
  ✓ Configured ... hook   (19 hook lines, all written to <S>/claude-config/settings.json)
  ✓ Configured statusline
  Done! Restart Claude Code, ...
```

4. Listing: `find S/claude-config -name SKILL.md` returns 73 files. 72 are first-party `skills/gsd-*/SKILL.md`. The 73rd is `skills/gsd-memanto-probe/SKILL.md`, the only match for `memanto` in the list.

Real-home check (sha256 of file bytes; size and mtime from `stat`), taken immediately before and after step 3:

| File | Before | After |
|------|--------|-------|
| `~/.claude/settings.json` | sha256 2ff82ae13f596bb2903136856e9ca0627b0fef52693dc0b1ec378707deef38a7, 22112 B, mtime 1795058407.349579369 | identical |
| `~/.gsd/consent.json` | sha256 b47015437185a2580c20683e7ed89fae345ad02851ef298b16acd5867f78fdc0, 754 B, mtime 1794111955.273942186 | identical |

The executor also scanned for files newer than a marker touched just before step 3: `$HOME` depth 1, `~/.claude` (excluding live session dirs), `~/.gsd`, `~/.config`, `~/.cache` and `~/.local/bin`. The only hits were `~/.hermes` gateway heartbeat/state files and `~/.claude/hooks/worktree-reap.log`. Both were written at 23:43:20-22 local time, about 23 s after the installer exited at 23:42:57, by the owner's already-running Hermes gateway and worktree-reap hook. Neither came from the installer. `~/.hermes`'s own gsd install files are dated 2026-11-19 and were not touched. The shell rc files are unchanged.

Bundle impact: none in Phase 1 (`skills: []`). Phase 3 may ship skills only through a GLOBAL install followed by the product installer / surface re-apply. A project-scope install still stages nothing, because the reader only looks under `$GSD_HOME`. The runtime skill name is `gsd-<stem>`. For example, a stem `memanto-recall` would be invoked as `gsd-memanto-recall`, so stems must still not start with `gsd-`, or the result would be `gsd-gsd-...`.

Regression test: `test/spike-installer.test.cjs`, test `Q3 installer: install.js --claude --global stages a global capability skill into the config dir`. It runs only with `MEMANTO_SPIKE_INSTALLER=1` and `GSD_CORE_DIR` set to an npm layout (`<prefix>/node_modules/@opengsd/gsd-core/gsd-core`). Otherwise it skips with the stated reason. A companion test, which always runs, pins this path in this section.

## D-07 exception (OD-1)

Approved by the owner at plan time (OD-1): the live headless discuss and ship probes ran in temp projects with a temp `GSD_HOME` but used the REAL `~/.claude` (skills, credentials and user settings live there; a throwaway `CLAUDE_CONFIG_DIR` cannot run the real skill). Every other probe in this plan (all of Task 1, the evidence captures, the preflight dry checks) used a temp `GSD_HOME` and never touched `~/.claude`.

`~/.gsd/consent.json` (the owner's real consent store), measured with `fs.statSync` and sha256 of the file bytes:

| When | mtimeMs | size | sha256 |
|------|---------|------|--------|
| Before the first live run (2026-11-21T03:51:55Z) | 1794111955273.9421 | 754 | b47015437185a2580c20683e7ed89fae345ad02851ef298b16acd5867f78fdc0 |
| After the last live run (2026-11-21T04:00:36Z) | 1794111955273.9421 | 754 | b47015437185a2580c20683e7ed89fae345ad02851ef298b16acd5867f78fdc0 |

Equal: the live runs did not write the real consent store (the global-scope install into a temp `GSD_HOME` needs no consent record, F2).

Writes observed under the real `~/.claude`: with `--no-session-persistence` no session transcript was saved. Each of the 7 runs created an empty project directory `~/.claude/projects/-private-tmp-claude-501-...-scratchpad-live-<run>-proj/` containing an empty `memory/` directory; run a2 also wrote a transient `<session>/tool-results/*.txt` (persisted large tool output) that was gone after the session ended (`find -type f` under all 7 directories returns nothing). The owner's user-level hooks ran inside the headless sessions (they come with the real `~/.claude/settings.json`) and created `.memdb/` and `.memtrace/` inside the throwaway projects only. The 7 empty directories were left in place rather than deleted, because deleting them is another write to the real home; they can be removed with `rm -r ~/.claude/projects/*scratchpad-live*`.

## discuss:pre bypass paths

Observed in the installed skill and workflows (gsd-core 1.20.1). On each path below, `dispatch_discuss_pre_hooks` never runs, so the memanto gate is never evaluated:

| Path | Routing evidence | `render-hooks` count in the routed workflow |
|------|------------------|---------------------------------------------|
| `/gsd-discuss-phase --assumptions` | `~/.claude/skills/gsd-discuss-phase/SKILL.md:55-57` → `workflows/list-phase-assumptions.md`, "Stop here." | 0 |
| `workflow.discuss_mode: "assumptions"` | `SKILL.md:59-60` → `workflows/discuss-phase-assumptions.md` | 0 |
| `/gsd-discuss-phase --power` | `workflows/discuss-phase.md:150` (step `initialize`, before `dispatch_discuss_pre_hooks` at :296) → `workflows/discuss-phase/modes/power.md` "Do NOT continue with the steps below." | 0 (`modes/power.md`); legacy `workflows/discuss-phase-power.md` also 0 |

Counts: `grep -c render-hooks` → `discuss-phase.md` 2, `discuss-phase-power.md` 0, `discuss-phase-assumptions.md` 0, `list-phase-assumptions.md` 0, every file in `workflows/discuss-phase/modes/` 0. The overlay modes (`--auto`, `--all`, `--chain`, `--text`, `--batch`, `--analyze`, advisor) stay inside `discuss-phase.md` and still reach `dispatch_discuss_pre_hooks`; `modes/auto.md` overrides `check_existing` and later steps, not the hook step.

Not fixable inside a capability without modifying gsd-core (T-01-17, accepted). Surfaced by the doctor `discuss-bypass` warning (01-06) and the README (01-08); carried to the Phase 2 GATE-05 owner decision.

## Acceptance run (D-08)

Status: **PARTIAL, stopped at an owner checkpoint.** Runs (a) and (b), doctor and the gsd-core comparison are done. The headless runs (c) and (d) and the headless half of (e) were not run, because the Claude Code auto-mode permission classifier denied them (see "Blocked runs" below). Task 2 (publish) has not started.

Run by the agent on 2026-11-21 from 05:07Z, against the owner's real home (GSD_HOME unset). Transcripts and snapshots are in the session scratchpad (`<scratch>/acc0109/`), not in the repo.

### Precondition and suite gates

```
$ curl -fsS http://localhost:8000/health                -> {"status":"ok"}
$ curl -fsS http://plex2.nomorestars.com:8080/health    -> {..."status":"ok"}
$ claude --version                                      -> 2.1.330 (Claude Code)
$ npm test                                              (installed gsd-core 1.20.1)  # tests 188 / # pass 187 / # fail 0 / # skipped 1, exit 0
$ GSD_CORE_DIR=<scratch>/gsd-core-1.22.0/node_modules/@opengsd/gsd-core/gsd-core MEMANTO_SPIKE_INSTALLER=1 npm test
                                                        # tests 188 / # pass 188 / # fail 0, exit 0
```

### Install record (real home, D-08, D-14)

`~/.gsd/capabilities` was empty beforehand, so this was a fresh install rather than the reinstall path.

```
$ node tools/stage-bundle.cjs --real --json
{"stagedDir":"<tmp>/memanto-stage-NU99B3/memanto","home":null,"install":{"status":"installed","id":"memanto","version":"0.0.0","scope":"global","disclosure":[... "memanto -> memanto.cjs [router: route]" ...]}}   exit 0

~/.gsd-capabilities.json  entries.memanto = {"id":"memanto","version":"0.0.0","source":"<tmp>/memanto-stage-NU99B3/memanto","integrity":"","files":[".gsd/capabilities/memanto"],"sharedEdits":[]}

$ gsd_run capability list --raw      (memanto entry)
{"id":"memanto","role":"feature","version":"0.0.0","tier":"full","scope":"global","status":"active","reason":null,"surfaced":true}
```

Installed files: `capability.json`, `LICENSE`, `README.md`, `memanto.cjs`, `package.json`, `lib/{checks,config,gsd-host,health}.cjs`, `scripts/{check-probe,gate}.cjs`. `~/.gsd/consent.json` was not written. Its sha256 is `b47015437185...fdc0`, 754 B, the same before and after, because a global install needs no consent record (F2). D-08 expected a consent write, and none happened.

Host note: the `gsd-tools` on PATH (`/opt/homebrew/bin/gsd-tools`) is gsd-core **1.17.0**, below `engines.gsd >=1.20.1`. Every host command here used `gsd_run` (`~/.claude/gsd-core`, 1.20.1), which is also what the headless sessions resolve. README's `gsd-tools ...` commands will run against 1.17.0 on this machine.

### Throwaway project and command

`<scratch>/acc0109/proj`: `git init`, one commit of `.planning/{PROJECT,REQUIREMENTS,ROADMAP,STATE}.md` and `phases/01-core-counter/` (neutral "Tally" project), `workflow.discuss_mode: "discuss"`. Between runs only `.planning/config.json` was rewritten. The agent id for the healthy configs was `memanto-dev` (MEMANTO_TEST_AGENT unset), and it was written only into this throwaway config.

Command (the Q1 shape with the real home: GSD_HOME is not set, and there is no skip-permissions flag):

```
GSD_WORKSTREAM= GSD_PROJECT= claude -p "/gsd-discuss-phase 1 --auto" --allowedTools "Bash,Read,Write,Edit,Glob,Grep,Skill" --permission-mode dontAsk --output-format stream-json --verbose --no-session-persistence --max-budget-usd 5 > transcript-<run>.jsonl
```

### Trimmed transcript lines

```
a  render-hooks discuss:pre (host, before the run): [{"capId":"memanto","kind":"gate","blocking":true,"onError":"halt"}]
a  #9 CALL Bash: P='d="${GSD_HOME:-$HOME}/.gsd/capabilities/memanto"; ...; exec node "$d/scripts/gate.cjs"'; ( perl -e 'alarm 20; exec @ARGV' sh -c "$P" ); echo "EXIT=$?"
      RESULT: memanto: BLOCKED [agent-id] memanto.agent_id is empty -> gsd_run config-set memanto.agent_id <agent-id> (memanto.enabled=false disables Memanto for this project) EXIT=1
   FINAL (12 turns, 37 s, USD 0.69): Phase 1 discussion did not run. A blocking check that runs before the discussion stopped it, so the agent created no CONTEXT.md, made no commits ...
b  #6 CALL Bash: ...; d="${GSD_HOME:-$HOME}/.gsd/capabilities/memanto"; ...; timeout 20 node "$d/scripts/gate.cjs"; echo "EXIT=$?"
      RESULT: memanto: BLOCKED [api-health] http://127.0.0.1:9/health is not healthy (connection) -> bring the Memanto REST API at http://127.0.0.1:9 up (the capability never starts it), then check: curl -fsS http://127.0.0.1:9/health (memanto.enabled=false disables Memanto for this project) EXIT=1
   FINAL (7 turns, 32 s, USD 0.63): The phase 1 discussion stopped before any work began. The Memanto gate ... failed
e  render-hooks discuss:pre with {"memanto":{"enabled":false}}: activeHooks=[] (0 memanto entries)
```

F10 caveat re-observed: in both runs the LLM ran the predicate command itself, never `gsd_run check predicate`. In run (a) it read `scripts/gate.cjs` (`cat | head -80`) before running it, and in both runs it still ran it.

### Verdicts

| Run | Config | Expected | Observed | Verdict |
|-----|--------|----------|----------|---------|
| a | enabled, agent_id "", real URLs | halt `[agent-id]`, no CONTEXT.md (CONF-02) | halt `[agent-id]` only; `phases/01-core-counter/` holds only `.gitkeep`; `git log` = `init tally project` | pass |
| b | agent set, api_url `http://127.0.0.1:9` | halt `[api-health]` (CONF-03) | halt `[api-health]` only; no CONTEXT.md, no commit | pass |
| c | as b, real api_url, mempalace.enabled true | halt `[mempalace]` naming both (GATE-03) | not run: permission classifier denied the command | blocked |
| d | enabled, agent set, both real URLs | gate passes, discuss continues (SC2) | not run: permission classifier denied the command | blocked |
| e | memanto.enabled false | no memanto render entry, no gate in transcript (CONF-01) | render: 0 memanto entries; headless half not run (classifier) | partial |

### Doctor (GATE-06, real install)

| Project config | `gsd_run memanto doctor` | `node "$HOME/.gsd/capabilities/memanto/memanto.cjs" doctor` | Verdict |
|----------------|--------------------------|--------------------------------------------------------------|---------|
| d (healthy) | exit 0, `0 error(s), 1 warning(s)` | exit 0 (and `--raw` exit 0) | pass |
| a (agent_id "") | exit 1, `error agent-id  memanto.agent_id is empty` | exit 1, same line | pass |

Healthy doctor lines (direct form): `ok gsd-core-located` (1.20.1), `ok enabled`, `ok loaded` (memanto 0.0.0 active, global), `ok consent` (global scope needs no consent record), `ok engines`, `ok render:discuss:pre`, `ok duplicate-install`, `warn discuss-bypass`, `ok mempalace`, `ok agent-id`, `ok backend-url`, `ok api-url`, `ok backend-health`, `ok api-health`.

### gsd-core snapshot and real-Memanto reads (INST-01, T-01-29, T-01-30)

- `~/.claude/gsd-core/{bin,workflows,references}`: 627 files, aggregate sha256 `80873022e03ac60fd1ea5e4a0a14a4925210cb4fb6b13c3dc004dd1c1b8a789e`, the same before the suite gates and after the doctor runs. The two per-file lists (path, size, sha256) are byte-identical (`cmp`).
- `~/.claude/settings.json` sha256 `2ff82ae1...a38a7`, 22112 B, the same before and after.
- No `memanto` CLI command appears in either transcript. Real Memanto received only `GET /health`: from the gate in run (a) (backend and API), from run (b) (backend only), and from doctor.
- Writes under the real `~/.claude`: one project dir `~/.claude/projects/-private-tmp-...-acc0109-proj/`. Run (a) also wrote a transient `tool-results/*.txt` (persisted large output of `cat discuss-phase.md`), which was gone after the session ended (`find -type f` returns nothing). The directory is left in place.

### Blocked runs (owner decision needed)

The Claude Code auto-mode classifier denied three commands as "Destructive or Unwanted Actions". The agent did not retry any of them or work around them:
1. Headless run (c) (`mempalace.enabled: true`). A read-only check afterwards found the likely reason: with MemPalace enabled, gsd-core renders a first-party `discuss:pre` **contribution** (`capability-registry.cjs` mempalace entry) that tells the headless agent to run `mempalace wake-up --wing <wing>` and `mempalace search ...`. `mempalace` is not on PATH and `~/.mempalace` does not exist, so the calls would fail, and the contribution says to continue. Even so, the run asks an LLM to touch a second memory system that the plan never mentioned.
2. Headless run (d) (healthy). If it ran, the gate would pass and `/gsd-discuss-phase --auto` would continue inside the throwaway project. That means writing and committing CONTEXT.md there, under `--permission-mode dontAsk`.
3. A host-layer `gsd_run check predicate` for config (d). It was meant only as supplementary evidence, and the agent dropped it after the denial.

Published package: pending (Task 3).
