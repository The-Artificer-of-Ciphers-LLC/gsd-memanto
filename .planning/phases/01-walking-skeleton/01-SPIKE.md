# Phase 1 Spike Outcomes (D-07 to D-10)

Host under test: gsd-core **1.20.1** at `~/.claude/gsd-core` (`package.json` version), Node v26.13.0, macOS.
Every deterministic probe below ran against a fresh temp `GSD_HOME` and a temp project; the owner's real `~/.gsd` was only `stat()`ed.
Regression tests live in `test/spike-regression.test.cjs` (`node --test --test-reporter=tap test/spike-regression.test.cjs`: 9 tests, `# pass 9`, `# fail 0`).

## Q1 — Gate halts a real run (discuss:pre, ship:pre, headless)

Answer: PARTIAL (host layer POSITIVE; live headless layer recorded by plan 01-05 Task 2 below)

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

Pending: recorded by plan 01-05 Task 2.

Bundle impact: pending the live layer (no change, or the D-09 fallback contribution).

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

Pending: recorded by plan 01-05 Task 2 (live headless runs).

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
