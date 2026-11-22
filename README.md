# gsd-memanto

A third-party [gsd-core](https://github.com/open-gsd/gsd-core) capability that uses [Memanto](https://memanto.ai) as the project-memory provider for GSD.

This README covers the Phase 1 scope: global install, per-project enablement, the blocking `discuss:pre` gate, the break-glass switch, and `memanto doctor`. When the capability is enabled and Memanto is misconfigured or unhealthy, the gate halts the workflow instead of letting it continue without memory.

Commands below use `gsd-tools`, gsd-core's CLI. GSD workflows and the gate's own messages call the same CLI `gsd_run`.

## Prerequisites

- **gsd-core** `>=1.20.1 <2.0.0`. The manifest's `engines.gsd` range is a hard gate, so gsd-core does not load the capability outside it.
- **The `gsd-tools` you run must itself be `>=1.20.1`.** A machine can have more than one gsd-core. For example, an older global npm install can sit on `PATH` while the runtime uses `~/.claude/gsd-core`. Check before installing:

  ```sh
  gsd-tools query runtime-identity --raw    # prints {"packageName":"@opengsd/gsd-core","version":"<x.y.z>"}; needs >=1.20.1
  ```

  `gsd-tools` accepts no `--version` flag. If the version is older, run the commands below through the runtime's own copy instead: `gsd_run` (for example `~/.claude/gsd-core/bin/gsd_run capability install ...`) or `node ~/.claude/gsd-core/bin/gsd-tools.cjs ...`.
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

The script stages exactly the files that `npm pack` would ship into a temporary directory and installs that directory with `capability install <dir> --yes`. It deletes the staging directory after the install. Without `--real` (or `--home <dir>`) it installs into a fresh temporary `GSD_HOME` and leaves your real `~/.gsd` alone; it prints that home on a `cleanup:` line (`cleanup` in `--json` output) so you can delete it when you are done. With `--stage-only` it installs nothing and the staged directory it prints is yours to delete.

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

The three string keys follow one whitespace rule: a value that is only whitespace counts as empty, and a value with leading or trailing whitespace blocks the gate. The gate never trims a value silently.

The gate resolves these keys the same way `gsd-tools config-get` does. A `GSD_PROJECT` or `GSD_WORKSTREAM` scoped `config.json` is read first, then `.planning/config.json`, then the manifest default. An endpoint URL is accepted only when it matches one strict form, checked on the raw value:

```
http(s)://[user[:password]@]host[:port][/path]
```

- The scheme is `http` or `https`, in lower case.
- The user name and password use only URL-safe characters (letters, digits and `-._~!$&'()*+,;=`) and `%XX` escapes. Write `@` inside a password as `%40`, and `:`, `/`, `?`, `#` as `%3A`, `%2F`, `%3F`, `%23`.
- `@` appears at most once, and only as the `user:password` separator. An `@` in the base path, query or fragment is not supported, encoded (`%40`) or not.
- The host is a name or IPv4 address (letters, digits, `.` and `-`) or a bracketed IPv6 address. The port is 1 to 5 digits, at most 65535.
- The base path uses URL-safe characters and valid `%XX` escapes. A query (`?`), a fragment (`#`), a backslash, whitespace, control characters and non-ASCII characters (such as a full-width `＠`) are rejected anywhere.
- Node's URL parser must read the same scheme, host and port from the value. A host it rewrites, such as `0x7f.1`, is rejected.

A value that does not match blocks the gate with its `backend-url` or `api-url` check and is never probed. It is printed only as `memanto.<key>=<redacted>`, so no part of it is ever echoed. For example, `http://127.0.0.1\alice:s3cret@memanto.internal:8000` and `http://u:12/x@host:8000` are rejected, because the `\` and `/` before the `@` make the host unclear.

An accepted URL is printed only as `scheme://host[:port]`, with `/<base path>` in place of any base path. The user name, password and base path are never printed. The gate probes `<base path>/health` at that host only. It sends the decoded `user:password` there as a Basic `Authorization` header. Over plain `http` that header is sent unencrypted. `http://@host` has an empty user name and password: it is accepted and sends no `Authorization` header.

## The discuss:pre gate

When the capability is enabled, `/gsd-discuss-phase` runs a blocking gate before discussion starts (loop point `discuss:pre`). The gate runs every check, prints one line per failed check to stderr, and exits non-zero. The host then halts the step. Every line has this form:

```
memanto: BLOCKED [<check-id>] <problem> -> <fix>
```

The output always ends with the break-glass line `(memanto.enabled=false disables Memanto for this project)`, and the whole output fits within gsd-core's 2000-character stderr tail. The gate never calls the `memanto` CLI. The host allows the gate 20 seconds.

Checks, in the order they are reported:

| Check id | What it checks | Fix it prints |
|----------|----------------|---------------|
| `config-unreadable` | The project config file exists but cannot be read or is not valid JSON, or `GSD_PROJECT` / `GSD_WORKSTREAM` holds an invalid name (a `/`, `\` or `..`). | Fix the JSON syntax in the named file, or make it readable. For an invalid variable: unset it or set it to a name without `/`, `\` or `..`. |
| `mempalace` | `mempalace.enabled` is the boolean `true`. Memanto and the first-party MemPalace capability are mutually exclusive, so one project cannot enable both. | `gsd_run config-set mempalace.enabled false` (or `gsd_run config-set memanto.enabled false`) |
| `agent-id` | `memanto.agent_id` is a non-empty string with no leading or trailing whitespace. The value is never echoed. | `gsd_run config-set memanto.agent_id <agent-id>` |
| `backend-url` | `memanto.backend_url` is set, has no leading or trailing whitespace, and matches the strict endpoint form above. | `gsd_run config-set memanto.backend_url <http(s)://host:port>`; for a value outside the strict form, `<http(s)://[user[:password]@]host[:port][/path]>` |
| `api-url` | `memanto.api_url` is set, has no leading or trailing whitespace, and matches the strict endpoint form above. | `gsd_run config-set memanto.api_url <http(s)://host:port>`; for a value outside the strict form, `<http(s)://[user[:password]@]host[:port][/path]>` |
| `backend-health` | One `GET <backend_url>/health` with a 5-second limit, no retry and no redirects. It passes only on a 2xx response whose JSON body has `"status": "ok"`. The reason is shown in parentheses, for example `(connection)` or `(http-500)`. | Bring the Memanto backend up (the capability never starts it), then check it with `curl -fsS <backend_url>/health`. The hint shows only `scheme://host[:port]`, with `/<base path>` in place of a base path. |
| `api-health` | The same probe against `<api_url>/health`. | Bring the Memanto REST API up, then check it with `curl -fsS <api_url>/health`. |

If the gate itself fails unexpectedly, it blocks with `[gate-internal]`. The gate fails closed: it does not pass on an error.

The gate runs `scripts/gate.cjs` only from an installed bundle. An installed bundle is a `.gsd/capabilities/memanto` directory whose `capability.json` has the id `memanto` and whose scope ledger (`.gsd-capabilities.json` in `${GSD_HOME:-$HOME}` or in the project root) holds a committed `memanto` entry. The gate picks the bundle the same way gsd-core does:

- If `${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/capability.json` exists, gsd-core loads that global copy, even when no ledger lists it. The gate then runs the global bundle when it is installed and blocks with `[gate-bundle]` when it is not. It never falls back to a project copy in this case, because a project ledger and bundle can be committed to the repository.
- If no global `capability.json` exists, the gate runs the project bundle when it is installed and blocks with `[gate-bundle]` when it is not. gsd-core activates a project bundle only when this machine holds a consent record for it.

A directory that only holds a stray or planted `scripts/gate.cjs` is never run. A `[gate-bundle]` line names the expanded directories it checked (the global one under the resolved `GSD_HOME`, or your home directory when `GSD_HOME` is unset, and the project one) and the version-pinned reinstall command, `gsd-tools capability install npm:@taoc/gsd-memanto@<version> --yes`, with `--scope project` for a project-scope install.

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

It reports the gate's own checks (agent id, MemPalace, URLs, health) and these doctor checks:

| Check id | Not-ok status | Meaning when not ok |
|----------|---------------|---------------------|
| `gsd-core-located` | `error` | No gsd-core `gsd-tools.cjs` was found. Set `GSD_CORE_DIR` to the gsd-core directory that holds `bin/gsd-tools.cjs`. When `GSD_CORE_DIR` is set it is the only place doctor looks. Otherwise doctor uses the `gsd-tools` that is running it, then the runtime config homes (`~/.claude/gsd-core` first, then the other runtimes gsd-core supports). Doctor never runs a `gsd-core` inside the project, because identifying it would mean executing code from the repository. |
| `enabled` | `warn` | `memanto.enabled` is not `true` (or the config could not be read), so no Memanto hook runs in this project. Doctor still runs, because gsd-core routes the command family whether or not the capability is enabled. |
| `loaded` | `error` | `memanto.enabled` is `true`, but gsd-core did not load the capability (fails open). When `capability list` reports one scope active but gsd-core loads the other copy, the `ok` line names the copy gsd-core loads. |
| `consent` | `error` | A project-scope install has no consent record (for example its bytes changed after consent), or a bundle on disk is in no capability ledger (copied by hand). |
| `engines` | `error` | The installed gsd-core version is outside the manifest's `engines.gsd` range (fails open). |
| `render:<point>` | `error` | No memanto hook renders at a declared loop point, for example `render:discuss:pre`. The host's load-failure reason is shown when it gives one. |
| `duplicate-install` | `warn` | memanto is installed in both global and project scope; gsd-core keeps the global one. When one copy is in no ledger, the fix names that copy to delete by hand, as `gate-bundle` does. |
| `gate-bundle` | `error` | The `discuss:pre` gate would run a bundle other than the one gsd-core loads, finds no installed bundle at all, or a scope directory holds a `scripts/gate.cjs` that is not part of an installed bundle (stray or planted code). Doctor names the copy gsd-core loads from gsd-core's own loader verdict, by the loader's precedence: the global copy whenever a global `capability.json` exists and gsd-core accepts it, even when no ledger lists it. A project copy with the same id is then skipped as colliding, even though `capability list` shows that project row as `active`. The fix names the stray copy: a directory that no ledger lists is deleted by hand, because `gsd-tools capability remove` only removes ledgered installs. For a hand-copied global next to a project install, that is the global directory, and the project install is kept. The fix never tells you to remove an installed bundle. |
| `discuss-bypass` | `warn` | Always reported: `/gsd-discuss-phase --power` and `--assumptions` (and `workflow.discuss_mode: "assumptions"`) skip the `discuss:pre` gate. |

Doctor reports `check-probe`, `capability-list` or `doctor-internal` as an `error` only when doctor itself fails internally.

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
