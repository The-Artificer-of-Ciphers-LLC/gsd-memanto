# Phase 1: Walking Skeleton - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-11-20
**Phase:** 01-walking-skeleton
**Areas discussed:** Endpoint config & health, Spike blast radius, Bundle layout & dev loop, Doctor output contract, Gate message / config read / CI / MemPalace (second round)

---

## Endpoint config & health

| Option | Description | Selected |
|--------|-------------|----------|
| backend_url + api_url | Full URLs with scheme | ✓ |
| backend_host + api_host | host:port, http assumed | |
| Agent decides | Mirror mempalace naming | |

| Option | Description | Selected |
|--------|-------------|----------|
| api_url empty, block until set | No implicit endpoint | ✓ |
| http://localhost:8000 default | Less setup, silent implicit target | |

| Option | Description | Selected |
|--------|-------------|----------|
| GET <backend_url>/health, 2xx | One rule for on-prem and cloud | ✓ |
| Trust REST for backend | backend_url informational | |
| Per-kind probe | backend_kind switch | |

| Option | Description | Selected |
|--------|-------------|----------|
| 2xx + JSON status ok, 5s, no retry | Deterministic, well under the 30s budget | ✓ |
| Any 2xx, 10s, one retry | Tolerant, slower worst case | |
| Agent decides | | |

**Notes:** The agent verified both live endpoints return `"status":"ok"` with HTTP 200.

---

## Spike blast radius

| Option | Description | Selected |
|--------|-------------|----------|
| Temp GSD_HOME + temp runtime dir only | Never write the real home | ✓ |
| Temp first, then one real install | | |
| Real environment throughout | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Owner runs from runbook | Owner keeps consent/real-home writes | |
| The agent, headless | Agent writes the real consent store | ✓ |

| Option | Description | Selected |
|--------|-------------|----------|
| Adapt in-phase, record, continue | Stop only if the gate cannot halt | ✓ |
| Stop and ask owner | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Phase-dir SPIKE.md + regression tests | | ✓ |
| /gsd-spike workflow | | |

**Notes:** Spike probes are temp-only. The final acceptance run is done by the agent, headless, against the real home.

---

## Bundle layout & dev loop

| Question | Owner's answer (free text) |
|----------|---------------------------|
| Layout (repo root + whitelist vs capability/ subdir) | "follow the gsd-core installation standards" |
| Dev install (npm-pack tarball vs local path) | "follow the capability supported options" |
| Re-consent after edits | Reinstall script also re-consents (Recommended) ✓ |
| Publish in Phase 1? | "follow the capability standards, if it supports npm, then we'll do that" |

**Follow-ups after the agent read gsd-core v1.20.1 publish docs and `parseSpec`:**

| Question | Options | Selected |
|----------|---------|----------|
| npm name | Scoped @<scope>/gsd-memanto / Unscoped gsd-memanto | Scoped |
| Publish when | End of Phase 1, owner publishes / Not until Phase 7 | End of Phase 1 ✓ |
| npm scope | @trek-e / @nomorestars / decide before publish | Free text: "@taoc/gsd-memanto (follow existing pi mlx project environment in repo)" |

**Notes:** The agent found `~/projects/pi-mlx-models` (`@taoc/pi-mlx-models`) and adopted its package, CI and OIDC staged-publish conventions.

---

## Doctor output contract

| Option | Description | Selected |
|--------|-------------|----------|
| Module also runs directly with node | Same code, reaches not-loaded cases | ✓ |
| Separate doctor script | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Human text; JSON with --raw | | ✓ |
| JSON only | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Non-zero on any error, 0 on warnings | | ✓ |
| Always 0 | | |

| Option | Description | Selected |
|--------|-------------|----------|
| Strictly read-only | | ✓ |
| --fix for safe things | | |

---

## Second round

| Question | Selected |
|----------|----------|
| Gate message | One line per failed check + fix, plus break-glass note |
| Config read | Read .planning/config.json in-process |
| CI matrix | ubuntu + macOS × gsd-core 1.20.1 + latest |
| MemPalace exclusion | Block only if mempalace.enabled is true (agent verified the default is false) |

## Claude's Discretion

- Internal file layout of the bundle, doctor check ids, fake memanto/REST design, gate script structure.

## Deferred Ideas

- Doctor warning when MemPalace is active elsewhere on the machine.
- Doctor `--fix` (re-consent).
