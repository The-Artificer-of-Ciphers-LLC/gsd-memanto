# gsd-memanto

A third-party [gsd-core](https://github.com/open-gsd/gsd-core) capability that uses [Memanto](https://memanto.ai) as the project-memory provider for GSD.

This README covers the Phase 1 scope: global install, per-project enablement, the blocking `discuss:pre` gate, the break-glass switch, and `memanto doctor`. When the capability is enabled and Memanto is misconfigured or unhealthy, the gate halts the workflow instead of letting it continue without memory.

Commands below use `gsd-tools`, gsd-core's CLI. GSD workflows and the gate's own messages call the same CLI `gsd_run`.

## Prerequisites

- **gsd-core** `>=1.20.1 <2.0.0`. The manifest's `engines.gsd` range is a hard gate, so gsd-core does not load the capability outside it.
- **Node.js** `>=24`.
- **A running Memanto backend and REST API.** Both must already be running, configured and healthy. The capability only connects to them. It never starts, stops or reconfigures either one.
- **A Memanto agent you created** for the project, for example with `memanto agent create <agent-id> --pattern project`. The capability never creates agents and ships no default agent id.

## Install

The capability is installed once, globally, into `${GSD_HOME:-$HOME}/.gsd/capabilities/memanto`.

From npm:

```sh
gsd-tools capability install npm:@taoc/gsd-memanto@<version> --yes
```

To pin the exact tarball, add the `dist.integrity` value that npm reports (`npm view @taoc/gsd-memanto@<version> dist.integrity`):

```sh
gsd-tools capability install npm:@taoc/gsd-memanto@<version> --integrity sha512-<npm dist.integrity> --yes
```

`--yes` accepts the consent disclosure. The capability ships a command module (`memanto.cjs`), which is an executable surface, so an install without `--yes` is aborted.

From a development checkout:

```sh
node tools/stage-bundle.cjs --real
```

The script stages exactly the files that `npm pack` would ship into a temporary directory and installs that directory with `capability install <dir> --yes`. Without `--real` it installs into a temporary `GSD_HOME` and leaves your real `~/.gsd` alone.

gsd-core supports these install sources:

| Source | Example |
|--------|---------|
| Local directory | `gsd-tools capability install ./path/to/bundle --yes` |
| npm package | `npm:@taoc/gsd-memanto@<version>`, optionally with `--integrity sha512-…` |
| https tarball URL | `https://example.com/gsd-memanto-<version>.tgz` |
| git URL or ref | `git+https://github.com/The-Artificer-of-Ciphers-LLC/gsd-memanto.git#<ref>` |

A local `.tgz` file is not a supported source. Unpack it and install the directory, or use the npm or https form.

## Enable in a project

The capability does nothing in a project until `memanto.enabled` is the boolean `true`. Set the four keys in the project's `.planning/config.json`:

```sh
gsd-tools config-set memanto.agent_id <agent-id>
gsd-tools config-set memanto.backend_url http://memanto-backend.example:8080
gsd-tools config-set memanto.api_url http://localhost:8000
gsd-tools config-set memanto.enabled true
```

| Key | Type | Default | Example | Meaning |
|-----|------|---------|---------|---------|
| `memanto.enabled` | boolean | `false` | `true` | Turns the capability on for this project. Only the boolean `true` activates it. The string `"true"`, `1` and `null` do not. |
| `memanto.agent_id` | string | `""` | `<agent-id>` | The Memanto agent this project reads and writes. It must be set explicitly. An empty value blocks the gate. |
| `memanto.backend_url` | string | `""` | `http://memanto-backend.example:8080` | Full `http(s)` URL of the running Memanto backend. An empty value blocks the gate. |
| `memanto.api_url` | string | `""` | `http://localhost:8000` | Full `http(s)` URL of the running Memanto REST API. An empty value blocks the gate. |

The gate resolves these keys the same way `gsd-tools config-get` does. A `GSD_PROJECT` or `GSD_WORKSTREAM` scoped `config.json` is read first, then `.planning/config.json`, then the manifest default. A URL may carry `user:password@`. The gate sends it as a Basic `Authorization` header and never prints it. Over plain `http` that header is sent unencrypted.

## The discuss:pre gate

When the capability is enabled, `/gsd-discuss-phase` runs a blocking gate before discussion starts (loop point `discuss:pre`). The gate runs every check, prints one line per failed check to stderr, and exits non-zero. The host then halts the step. Every line has this form:

```
memanto: BLOCKED [<check-id>] <problem> -> <fix>
```

The output always ends with the break-glass line `(memanto.enabled=false disables Memanto for this project)`, and the whole output fits within gsd-core's 2000-character stderr tail. The gate never calls the `memanto` CLI. The host allows the gate 20 seconds.

Checks, in the order they are reported:

| Check id | What it checks | Fix it prints |
|----------|----------------|---------------|
| `config-unreadable` | The project config file exists but cannot be read or is not valid JSON. | Fix the JSON syntax in the named file, or make it readable. |
| `mempalace` | `mempalace.enabled` is the boolean `true`. Memanto and the first-party MemPalace capability are mutually exclusive, so one project cannot enable both. | `gsd_run config-set mempalace.enabled false` (or `gsd_run config-set memanto.enabled false`) |
| `agent-id` | `memanto.agent_id` is a non-empty string with no leading or trailing whitespace. The value is never echoed. | `gsd_run config-set memanto.agent_id <agent-id>` |
| `backend-url` | `memanto.backend_url` is set and is an `http` or `https` URL. | `gsd_run config-set memanto.backend_url <http(s)://host:port>` |
| `api-url` | `memanto.api_url` is set and is an `http` or `https` URL. | `gsd_run config-set memanto.api_url <http(s)://host:port>` |
| `backend-health` | One `GET <backend_url>/health` with a 5-second limit, no retry and no redirects. It passes only on a 2xx response whose JSON body has `"status": "ok"`. The reason is shown in parentheses, for example `(connection)` or `(http-500)`. | Bring the Memanto backend up (the capability never starts it), then check it with `curl -fsS <backend_url>/health`. |
| `api-health` | The same probe against `<api_url>/health`. | Bring the Memanto REST API up, then check it with `curl -fsS <api_url>/health`. |

If the gate itself fails unexpectedly, it blocks with `[gate-internal]`. The gate fails closed: it does not pass on an error.

Example:

```
memanto: BLOCKED [agent-id] memanto.agent_id is empty -> gsd_run config-set memanto.agent_id <agent-id>
memanto: BLOCKED [backend-health] http://memanto-backend.example:8080/health is not healthy (connection) -> bring the Memanto backend at http://memanto-backend.example:8080 up (the capability never starts it), then check: curl -fsS http://memanto-backend.example:8080/health
(memanto.enabled=false disables Memanto for this project)
```

## Break-glass

`memanto.enabled=false` is the only off switch:

```sh
gsd-tools config-set memanto.enabled false
```

With the capability disabled, no memanto hook renders and the gate does not run. Nothing else turns the gate off. A wrong agent id or a down server keeps blocking until it is fixed or the capability is disabled.

## Doctor

`memanto doctor` is read-only. It reads config, the capability ledger, consent and versions, and calls `GET /health`. It never activates a session, writes data, re-consents or creates anything.

When gsd-core loads the capability:

```sh
gsd-tools memanto doctor [--raw]
```

When gsd-core does not load it (not consented, outside `engines.gsd`, failed validation), gsd-core does not route the command family, so run the same code directly:

```sh
node "${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/memanto.cjs" doctor [--raw]
```

Doctor prints one line per check with `ok`, `warn` or `error` and the next step to take. `--raw` prints JSON `{"checks":[{"id","status","message","fix"}]}`. Doctor exits non-zero when any check is `error`, and exits 0 when the worst result is `warn`.

It reports the gate's own checks (agent id, MemPalace, URLs, health) and these four fail-open states, each as an `error`:

| Check id | Meaning |
|----------|---------|
| `loaded` | `memanto.enabled` is `true`, but gsd-core did not load the capability. |
| `consent` | The installed bundle has no valid consent record, for example because its bytes changed after consent. |
| `engines` | The installed gsd-core version is outside the manifest's `engines.gsd` range. |
| `render:<point>` | The capability is loaded, but its hook does not render at the declared loop point, for example `render:discuss:pre`. |

## Fail-open caveat

The gate only blocks when gsd-core loads the capability. If gsd-core does not load it, the gate does not run and the workflow is not blocked. This happens when the capability is not installed, not consented, outside `engines.gsd`, or fails validation. A capability that does not load cannot block anything, and that is outside what a capability can control. Run doctor (direct form) after installing, after upgrading gsd-core, and whenever you suspect the gate is not running.

## Known bypasses

These gsd-core entry points never render `discuss:pre`, so the memanto gate does not run for them:

- `/gsd-discuss-phase --power`
- `/gsd-discuss-phase --assumptions`
- `workflow.discuss_mode` set to `"assumptions"`

A capability cannot close these paths without modifying gsd-core. Other discuss modes (`--auto`, `--all`, `--chain`, `--text`, `--batch`, `--analyze`) still run the gate.

## Uninstall

```sh
gsd-tools capability remove memanto
```

Set `memanto.enabled` to `false` (or remove the `memanto.*` keys) in projects that had it enabled.

## License

MIT. See [LICENSE](LICENSE).
