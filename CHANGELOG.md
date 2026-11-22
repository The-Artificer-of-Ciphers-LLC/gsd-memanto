# Changelog

All notable changes to `@taoc/gsd-memanto` are listed here.

## Unreleased

## 0.1.0 - 2026-11-22

### Added

- **Blocking `discuss:pre` gate.** When the capability is enabled, `/gsd-discuss-phase` halts before discussion if Memanto is misconfigured or unhealthy. The gate runs every check and prints one `memanto: BLOCKED [<check-id>] <problem> -> <fix>` line per failure, followed by the break-glass line.
- **Gate checks:** `config-unreadable`, `mempalace` (Memanto and MemPalace are mutually exclusive), `agent-id`, `backend-url`, `api-url`, `backend-health` and `api-health` (one `GET /health` per endpoint with a 5-second limit, no retry and no redirects).
- **Configuration keys:** `memanto.enabled` (only the boolean `true` activates the capability; `false` is the break-glass switch), `memanto.agent_id`, `memanto.backend_url` and `memanto.api_url`. No agent id or host ships as a default.
- **`memanto doctor`**, a read-only diagnostic, available as `gsd-tools memanto doctor` and directly as `node "${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/memanto.cjs" doctor` for the cases where gsd-core does not load the capability.

