---
phase: "1"
slug: "walking-skeleton"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-20"
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (built in; Node >=24) |
| **Config file** | none — `package.json` `test` script only (Wave 0 installs) |
| **Quick run command** | `node --test test/gate.test.cjs test/manifest.test.cjs` |
| **Full suite command** | `node --test --test-reporter=tap "test/**/*.test.cjs"` |
| **Host selection** | `GSD_CORE_DIR` env (default `~/.claude/gsd-core`); phase gate runs on 1.20.1 and 1.22.0 |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run the quick command for the touched area
- **After every plan wave:** Run the full suite against installed gsd-core 1.20.1
- **Before `/gsd-verify-work`:** Full suite green on 1.20.1 and 1.22.0, then the D-08 acceptance run
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Requirement-level map (task IDs are filled in by the planner/executor):

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| INST-01 | real CLI install into temp `GSD_HOME`; ledger entry; no gsd-core file changed | integration | `node --test test/install.test.cjs` | ❌ W0 | ⬜ pending |
| INST-02 | `loadRegistry` has `memanto`; zero warnings with `id === 'memanto'`; zero diagnostics | integration | `node --test test/manifest.test.cjs` | ❌ W0 | ⬜ pending |
| INST-03 | `validateHooksWired(manifest, getWiredKinds(root))` empty; negative fixtures error | unit/integration | `node --test test/dispatch.test.cjs` | ❌ W0 | ⬜ pending |
| INST-04 | each loader-trap fixture produces a warning; shipped manifest has none | unit | `node --test test/traps.test.cjs` | ❌ W0 | ⬜ pending |
| INST-05 | builtins-only requires, no symlinks/`node_modules`, sync router, bundle digest unchanged after gate+doctor, pack list = whitelist | unit | `node --test test/bundle.test.cjs` | ❌ W0 | ⬜ pending |
| CONF-01 | `render-hooks discuss:pre` returns 0 memanto hooks unless `memanto.enabled === true` | integration | `node --test test/activation.test.cjs` | ❌ W0 | ⬜ pending |
| CONF-02 | gate blocks on empty/whitespace/missing `memanto.agent_id` | integration | `node --test test/gate.test.cjs` | ❌ W0 | ⬜ pending |
| CONF-03 | both `/health` endpoints checked; each failure mode blocks with its own id | integration (fake REST) | `node --test test/health.test.cjs` | ❌ W0 | ⬜ pending |
| GATE-03 | `mempalace.enabled === true` blocks naming Memanto and MemPalace | integration | `node --test test/gate.test.cjs` | ❌ W0 | ⬜ pending |
| GATE-06 | doctor errors on enabled-not-loaded, not-consented, engines mismatch, not-rendering; no writes; zero memanto spawns | integration | `node --test test/doctor.test.cjs` | ❌ W0 | ⬜ pending |
| TEST-01 | temp `GSD_HOME`, real loader, real `render-hooks`; real `~/.gsd` untouched | infra | full suite | ❌ W0 | ⬜ pending |
| TEST-02 | fake REST server + fake `memanto` argv recorder on temp `PATH` | integration | `node --test test/gate.test.cjs test/doctor.test.cjs` | ❌ W0 | ⬜ pending |
| D-05 contract | gate config resolver equals `gsd_run config-get` | integration | `node --test test/config-contract.test.cjs` | ❌ W0 | ⬜ pending |
| D-04 budget | all checks failing: message ≤ 2000 chars, break-glass line survives | integration | `node --test test/gate.test.cjs` | ❌ W0 | ⬜ pending |
| D-10 spike regressions | render/predicate/ref.command/prose guards/skill reachability | integration | `node --test test/spike-regression.test.cjs` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` (`files` whitelist, `engines.node >=24`, tap `test` script), `.npmrc`, `.gitignore`, `LICENSE`, `CHANGELOG.md`
- [ ] `test/helpers/gsd-env.cjs` — temp `GSD_HOME`, temp project, install, `gsd()` spawner, registry oracle
- [ ] `test/helpers/fake-api.cjs` — `node:http` fake REST, port 0, scripted status/body/delay
- [ ] `test/helpers/fake-memanto.cjs` — argv recorder on a temp `PATH`
- [ ] All test files above, RED first (TDD mode)
- [ ] `tools/stage-bundle.cjs` — stage + install into a temp `GSD_HOME`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real global install + headless `/gsd-discuss-phase` halts on a failing check, then proceeds when all pass | SC1, SC2 (D-08) | Needs a live LLM run and the real `~/.claude` | Recorded in `01-SPIKE.md` / acceptance log |
| Live gate halt at `discuss:pre` and `ship:pre` (spike Q1) | SC5 | LLM behaviour cannot be asserted in CI | Spike procedure in `01-RESEARCH.md` § Spike Designs |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
