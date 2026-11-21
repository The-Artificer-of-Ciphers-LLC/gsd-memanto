# Phase 1: Walking Skeleton - Pattern Map

**Mapped:** 2026-11-20
**Files analyzed:** 22 (greenfield repo; all analogs are external, read-only)
**Analogs found:** 19 / 22

All analog paths below are git-tracked sources, or installed gsd-core artifacts used as read-only contract references (no gitignored capability mirrors cited). Prefer the tracked checkout `~/projects/gsd-core` for tests; `~/.claude/gsd-core/bin/` for the installed runtime contract.

## File Classification

| New File | Role | Data Flow | Closest Analog | Match |
|----------|------|-----------|----------------|-------|
| `capability.json` | config (manifest) | n/a | `~/.claude/gsd-core/bin/lib/capability-registry.cjs:2673-2720` (mempalace) + RESEARCH Pattern 1 | role-match |
| `memanto.cjs` | command module / router | request-response (sync) | `gsd-tools.cjs:625-645` router contract + RESEARCH "Command module shape" | role-match |
| `lib/config.cjs` | utility | file-I/O | RESEARCH Pattern 4 (host `resolveConfigKey` in `capability-activation.cjs`) | role-match |
| `lib/health.cjs` | utility | request-response | none in repo (RESEARCH Pitfall 9) | no analog |
| `lib/checks.cjs` | service | transform | RESEARCH Pattern 2 | no analog (new) |
| `lib/gsd-host.cjs` | utility | request-response (spawnSync) | `gsd-tools.cjs` CLI surface | partial |
| `scripts/gate.cjs` | gate entrypoint | request-response | `gate-predicate-evaluator.cjs:34-106` + RESEARCH gate skeleton | role-match |
| `scripts/health-probe.cjs` | utility CLI | request-response | none | no analog |
| `tools/stage-bundle.cjs` | dev script | file-I/O | none (uses `npm pack --dry-run --json`) | no analog |
| `package.json` | config | n/a | `~/projects/pi-mlx-models/package.json` | exact |
| `.npmrc` | config | n/a | `~/projects/pi-mlx-models/.npmrc` | exact |
| `.gitignore` | config | n/a | `~/projects/pi-mlx-models/.gitignore` | exact |
| `CHANGELOG.md` | doc | n/a | `~/projects/pi-mlx-models/CHANGELOG.md` | exact |
| `LICENSE`, `README.md` | doc | n/a | `~/projects/pi-mlx-models/LICENSE`, `README.md` | exact |
| `.github/workflows/ci.yml` | config | batch | `~/projects/pi-mlx-models/.github/workflows/ci.yml` | exact |
| `.github/workflows/publish.yml` | config | batch | `~/projects/pi-mlx-models/.github/workflows/publish.yml` | exact |
| `test/*.test.cjs` | test | request-response | `~/projects/gsd-core/tests/capability-command-dispatch.test.cjs`, `capability-loader.test.cjs`, `gate-predicate-evaluator.test.cjs` | role-match |
| `test/helpers/gsd-env.cjs` | test helper | request-response | RESEARCH "Real-loader harness fragment" | role-match |
| `test/helpers/fake-api.cjs` | test helper | request-response (HTTP) | `~/projects/pi-mlx-models/test/fixtures/stub-mlx-server.mjs` | role-match |
| `test/helpers/fake-memanto.cjs` | test helper | event-driven | same stub-server pattern | partial |
| `.planning/phases/01-.../01-SPIKE.md` | doc | n/a | none | no analog |

## Pattern Assignments

### `package.json` (config) - analog `~/projects/pi-mlx-models/package.json`
Copy (lines 1-52): `author` "The Artificer of Ciphers LLC", `license` MIT, `publishConfig.access: "public"`, `repository.url` form `git+https://github.com/The-Artificer-of-Ciphers-LLC/<repo>.git`, `bugs`, `homepage`. Differences: `name` `@taoc/gsd-memanto`, no `"type":"module"` (CJS), `engines.node >=24`, no `build`/`prepack`, no `main`. Whitelist shape to copy:
```json
"files": ["dist","README.md","LICENSE"]
```
becomes `capability.json`, `memanto.cjs`, `lib`, the shipped `scripts/*.cjs` named individually, `fragments`, `README.md`, `LICENSE` (never `tools/`, `test/`, `.planning`). `test` script: `node --test --test-reporter=tap "test/**/*.test.cjs"` (pi-mlx-models uses the tap reporter so CI can read `# tests N`).

### `.github/workflows/ci.yml` - analog `~/projects/pi-mlx-models/.github/workflows/ci.yml`
Copy the whole file; change `node-version: 24`, drop Build step, add a matrix axis for gsd-core version (1.20.1 floor, latest), and install gsd-core into the runner (set `GSD_CORE_DIR`). Keep verbatim:
```yaml
run: |
  set -o pipefail
  npm test 2>&1 | tee test.log
...
awk '/^# tests /{ n = $3 } END { if (n + 0 <= 1) { print "expected more than one test, got " n + 0; exit 1 } }' test.log
```
Note: the job name must stay `test (...)` because publish.yml filters check-runs with `startswith("test (")` and requires at least 2; adding a version axis changes the count, so update that `-lt 2` threshold.

### `.github/workflows/publish.yml` - analog `~/projects/pi-mlx-models/.github/workflows/publish.yml`
Copy as is: `workflow_dispatch` inputs (bump/notes/dry-run), `environment: npm-publish`, permissions (`id-token: write`, `checks: read`, `contents: write`), main-only guard, check-run gate (lines ~60-80), `npm install -g npm@^11.15.0` (line 103), `npm pack --dry-run` (162), `npm stage publish 2>&1 | tee stage.log` (171). Header comments (lines 1-20) explain OIDC and never setting `NODE_AUTH_TOKEN`; keep them. Remove any build step.

### `.npmrc`, `.gitignore`, `CHANGELOG.md`
`.npmrc`: `save-exact=true`. `.gitignore`: `node_modules/`, `.env`, `.DS_Store`, `*.log`, `.codegraph/`, add `.memdb/` (currently untracked). Do NOT copy `.claude/`, `CLAUDE.md` ignores (this repo tracks `.claude/CLAUDE.md`). `CHANGELOG.md`: header sentence plus `## Unreleased` with `### Added` subsection.

### `capability.json` (manifest) - analog mempalace entry `capability-registry.cjs:2673-2720`
Mirror key shape: `id, role, version, title, description, tier:"full", requires:[], engines:{gsd}, runtimeCompat:{supported:["*"],unsupported:[]}, skills, agents, hooks, config{ "<ns>.<key>": {type, default, description} }`. Use RESEARCH Pattern 1 manifest verbatim (verified clean on 1.20.1 and 1.22.0). Third-party deltas from mempalace: `skills:[]`, `agents:[]`, no `hooks`, `commands:[{family:"memanto",module:"memanto.cjs",router:"route",subcommands:["doctor"]}]`, `activationKey:"memanto.enabled"`, gate predicate `command-exit-zero` using `${GSD_HOME:-$HOME}` (never bare `$GSD_HOME`; never inline config values).

### `scripts/gate.cjs` - analog gate contract `gate-predicate-evaluator.cjs:34-106`
Contract to honor: exit 0 passes; non-zero or timeout blocks with `command exited <code>: <stderr head>`; stderr clipped to HEAD 2000 chars (`trimToMax`, line ~44), so break-glass line must be last and total <= ~1900 chars.
```js
const failed = results.filter(r => r.status === 'error');
if (failed.length === 0) process.exit(0);
const lines = failed.map(r => `memanto: BLOCKED [${r.id}] ${r.message} -> ${r.fix}`);
lines.push('(memanto.enabled=false disables Memanto for this project)');
```
Cap each message (and redact `user:pass@`) BEFORE joining. Wrap in `.catch` that prints `[gate-internal]` and `process.exit(1)` (fail closed). Use env `GSD_PROJECT`/`GSD_WORKSTREAM` for config dir; strict `=== true` for `mempalace.enabled`; malformed JSON blocks as `config-unreadable`.

### `memanto.cjs` (command module) - analog router contract `~/.claude/gsd-core/bin/gsd-tools.cjs:625-645`
Host calls `fn({ args, cwd, raw, error })`; a returned Promise aborts with "must be synchronous". `args[0]==='memanto'`, subcommand at `args[1]`. Use RESEARCH "Command module shape" (route + `require.main === module` shim prepending `'memanto'`). Doctor sets `process.exitCode = 1` on any `error`, 0 on warn only. Async health goes through `spawnSync(process.execPath, [health-probe.cjs, ...urls])`. Doctor is read-only (D-20).

### `lib/config.cjs`
No tracked analog; mirror host semantics from RESEARCH Pattern 4: workstream config then root `.planning/config.json` then manifest default; nested own-property lookup guarding `__proto__|constructor|prototype`; do not read `defaults.json`.

### `test/*.test.cjs` - analogs in `~/projects/gsd-core/tests/`
Imports/structure to copy from `capability-command-dispatch.test.cjs:11-16`:
```js
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
```
Temp-home pattern: `fs.mkdtempSync(path.join(os.tmpdir(), ...))` per test, cleaned in `after`; always pass explicit `GSD_HOME`, blank `GSD_WORKSTREAM`/`GSD_PROJECT` (Pitfall 7). Real-loader oracle: RESEARCH harness fragment (`loadRegistry({includeInstalled:true,cwd,gsdHome})`, `validateHooksWired`). Each positive spike answer (D-10) gets its own regression test. Contract test: gate resolver vs `gsd_run config-get memanto.*` over the RESEARCH Pattern 4 matrix.

### `test/helpers/fake-api.cjs` / `fake-memanto.cjs`
Analog `~/projects/pi-mlx-models/test/fixtures/stub-mlx-server.mjs` (local stub HTTP server pattern; convert to CJS, listen on port 0, return `{status:"ok"}` at `/health`, with switches for non-2xx, bad JSON, hang >5s). Fake `memanto` CLI: Node script on temp `PATH` recording argv (needed from Phase 2 onward; minimal in Phase 1).

## Shared Patterns

### Fail closed everywhere
Any unexpected exception in gate or checks maps to exit 1 with a visible BLOCKED line (RESEARCH gate skeleton). Doctor treats "cannot determine" as `error`.

### Check records
One shape `{id, status:'ok'|'warn'|'error', message, fix}` from `lib/checks.cjs`, rendered by gate (failures only, D-04 format) and doctor (all, text or `--raw` JSON `{checks:[...]}`).

### Runtime-state location
Never write inside the bundle (hash-bound). State, if any, goes to `<root>/.gsd/capability-data/memanto/` (none needed in Phase 1).

### Hermetic tests
Every spawned gsd process gets explicit `GSD_HOME` temp dir; spike probes never touch the real `~/.gsd/consent.json` or `~/.claude` (D-07); only the D-08 acceptance run uses the real home.

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `lib/health.cjs`, `scripts/health-probe.cjs` | utility | No HTTP health client in any reference repo; use RESEARCH Pattern 2/Pitfall 9 (5s timeout, one attempt, redact userinfo, require 2xx and JSON `status==="ok"`) |
| `lib/checks.cjs` | service | New cross-renderer check library |
| `tools/stage-bundle.cjs` | dev script | Lists files via `npm pack --dry-run --json`, copies to temp dir, runs `capability install <dir> --yes`; `--real` flag guards real home |
| `01-SPIKE.md` | doc | Format defined by D-10 (question, answer, evidence commands and output) |

## Metadata

**Analog search scope:** `~/projects/pi-mlx-models`, `~/projects/gsd-core` (tests/), `~/.claude/gsd-core/bin` and `bin/lib`
**Pattern extraction date:** 2026-11-20
