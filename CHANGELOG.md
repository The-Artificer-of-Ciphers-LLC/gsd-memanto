# Changelog

All notable changes to `@taoc/gsd-memanto` are listed here.

## Unreleased

### Project shut down

- 2026-11-25: The project is discontinued and the repository is archived. The reason: Memanto is not truly open source on the back end. `@taoc/gsd-memanto` is deprecated on npm. No further releases.

## 0.1.1 - 2026-11-22

### Security

- **The gate runs only the bundle gsd-core loads.** Before, the `discuss:pre` gate ran any `scripts/gate.cjs` it found in the global capability directory. A stale or planted copy could then pass the gate for a project-scope install. Now the gate selects a copy the same way gsd-core's loader does: it runs a copy only if that copy has a `capability.json` with id `memanto` and a committed ledger entry. When a global `capability.json` exists, the gate never falls back to a project copy. When no copy qualifies, it blocks with `[gate-bundle]`.
- **Endpoint credentials are never printed.** Some URLs used to print their password in gate and doctor messages, for example a password containing `/`, `#` or `\`, or a `%40` separator. `memanto.backend_url` and `memanto.api_url` must now be `http(s)://[user[:password]@]host[:port][/path]` using URL-safe characters. A value outside that form is rejected before any request is sent, and every message shows only `scheme://host[:port]`. Write an `@` inside a password as `%40` and a `:` as `%3A`. An `@` in the base path is not supported.
- **Release workflow hardening.** Tests now run in a separate job with read-only permissions. The release job checks out without stored credentials and refuses a checkout whose git config redirects URLs or sets credentials (checked before anything is staged, dry runs included). It pushes to an explicit `github.com` URL with hooks disabled and pins npm to an exact version.

### Added

- **Doctor `gate-bundle` check.** It reports an error whenever the gate would run code that is not the bundle gsd-core loaded, and names any stray or planted copy to delete.
- **Doctor install classification.** `loaded`, `consent`, `duplicate-install` and `gate-bundle` now come from one classification of the install, so they always agree on which copy gsd-core loads and what fixes it. Doctor always checks `discuss:pre` and reports an error when no memanto gate renders there.

- **Doctor checks the rendered gate is this release's gate.** The `discuss:pre` gate must be blocking with `onError: "halt"` and the exact shipped predicate command. An edited, non-blocking or other-version gate is an error.
- **Doctor `unreadable-files` check.** A `capability.json` or ledger that is a FIFO, socket, device, symlink to one, or oversized is reported with a fix that matches the cause. Doctor and the gate read these files without blocking, so a planted FIFO cannot hang either.
- **Release rehearsal in CI.** The suite now bumps a copy of the bundle with the release workflow's own step, installs it in both scopes, and checks doctor and the gate end to end.

### Changed

- Doctor no longer runs a `gsd-tools.cjs` found inside the project. When `GSD_CORE_DIR` is set, it wins outright.
- Every call doctor makes to the gsd-core host now has a time limit, so doctor cannot hang.
- Endpoint URLs and `agent_id` are treated the same way: surrounding whitespace blocks the gate, and nothing is trimmed silently.
- Upper- and mixed-case URL schemes (`HTTP://`) are accepted.
- The `[gate-bundle]` and doctor reinstall hints name the exact version and scope to reinstall.

## 0.1.0 - 2026-11-22

### Added

- **Blocking `discuss:pre` gate.** When the capability is enabled, `/gsd-discuss-phase` halts before discussion if Memanto is misconfigured or unhealthy. The gate runs every check and prints one `memanto: BLOCKED [<check-id>] <problem> -> <fix>` line per failure, followed by the break-glass line.
- **Gate checks:** `config-unreadable`, `mempalace` (Memanto and MemPalace are mutually exclusive), `agent-id`, `backend-url`, `api-url`, `backend-health` and `api-health` (one `GET /health` per endpoint with a 5-second limit, no retry and no redirects).
- **Configuration keys:** `memanto.enabled` (only the boolean `true` activates the capability; `false` is the break-glass switch), `memanto.agent_id`, `memanto.backend_url` and `memanto.api_url`. No agent id or host ships as a default.
- **`memanto doctor`**, a read-only diagnostic, available as `gsd-tools memanto doctor` and directly as `node "${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/memanto.cjs" doctor` for the cases where gsd-core does not load the capability.

