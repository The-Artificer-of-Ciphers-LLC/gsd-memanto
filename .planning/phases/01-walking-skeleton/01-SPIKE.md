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

Answer: PARTIAL (source level POSITIVE; installer/surface-apply run is plan 01-07, OD-2)

Evidence (temp capability `memanto` with `skills: ["memanto-probe"]` and `skills/memanto-probe/SKILL.md` (frontmatter `name: memanto-probe`), installed globally into a temp home; in-process with `process.env.GSD_HOME` set to that home):

```
> readInstalledCapabilitySkill('memanto-probe', loadRegistry({includeInstalled: true, cwd: <proj>, gsdHome: <tmp home>}))
{"capId":"memanto","content":"---\nname: memanto-probe\ndescription: probe\n---\nbody\n"}
> installed skill path exists: true   (<tmp home>/.gsd/capabilities/memanto/skills/memanto-probe/SKILL.md)
```

`readInstalledCapabilitySkill(stem, registry)` (`bin/lib/install-profiles.cjs:727`) reads only `${GSD_HOME:-~}/.gsd/capabilities/<capId>/skills/<stem>/SKILL.md`, binds the stem to its declaring capId, and refuses symlinks. It is the reader `stageSkillsForRuntimeAsSkills` (`:867`) calls during the product installer / `applySurface`; it is not called by `capability install`. So a global install makes the skill reachable to the staging pass, and a project-scope install does not (path is under `$GSD_HOME`, not the project).

Not run here (OD-2): the installer or surface re-apply that copies the skill into a runtime skills directory. Plan 01-07 runs it after an owner approval checkpoint and fills the section below.

Regression test: `Q3 source level: readInstalledCapabilitySkill reads a skill shipped in a global install`.

Bundle impact: none in Phase 1 (`skills: []`). Stems must not start with `gsd-`.

### Q3 installer run (plan 01-07)

Pending: plan 01-07.

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

pending — plan 01-09
