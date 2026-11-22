---
phase: "1"
slug: "walking-skeleton"
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: "2026-11-22"
---

# Phase 1 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| repo config → gate | `.planning/config.json` is repo content (a cloned repo controls it) and is read by the gate process | endpoint URLs (may carry credentials), agent id, enable flags |
| host → gate process | gsd-core runs the manifest command through `sh -c` at the project root | gate command, exit code, stderr message |
| gate → Memanto endpoints | one `GET /health` per configured endpoint | URL userinfo as Basic auth; response status only |
| dev script / tests → owner home | `tools/stage-bundle.cjs` and the test harness could touch the real GSD home | ledger, consent store, bundle files |
| CI / release → npm and GitHub | `publish.yml` stages an OIDC trusted publish and pushes the bump | package bytes, provenance, git refs |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-01-01 | Tampering/Elevation | capability.json gate command | high | mitigate | Static `exec node -e` command with no `$`, placeholders or config values (`capability.json:63`); config read in-process (`lib/config.cjs:97-123`) | closed |
| T-01-02 | Elevation (fail-open) | scripts/gate.cjs, lib/checks.cjs | high | mitigate | Every error path exits non-zero (`scripts/gate.cjs:21-28`, `lib/checks.cjs:46-71,157`); a failed require exits 1 (`capability.json:63`); gate runs only the loaded, ledgered bundle (CR-01) | closed |
| T-01-03 | Tampering | tools/stage-bundle.cjs | medium | mitigate | `--real` refuses `--home`, symlink abort, fresh temp GSD_HOME by default (`tools/stage-bundle.cjs:54,95,117-124`) | closed |
| T-01-04 | Info disclosure/Tampering | test harness | medium | mitigate | Harness throws without a temp home (`test/helpers/gsd-env.cjs:40-42`); `test/install.test.cjs:14,76-99,159` | closed |
| T-01-05 | Info disclosure | endpoint display (was redactUrl) | medium | mitigate | Strict URL allowlist; output shows only `scheme://host[:port]` via `displayEndpoint` (`lib/health.cjs:100-104`); 160-char cap (`lib/checks.cjs:42-44`); `test/gate.test.cjs:189-196` | closed |
| T-01-06 | Info disclosure/SSRF | checkHealth with repo-controlled URLs | medium | mitigate | http/https only, only `<url>/health`, one GET, 5 s, no redirects, body never returned (`lib/health.cjs:30-36,115,143-177`). Host allow-list carried to Phase 2 | closed |
| T-01-07 | DoS | health probes | medium | mitigate | Parallel probes (`lib/checks.cjs:165`), 5 s limit (`lib/health.cjs:9`), gate timeout 20 s (`capability.json:62`); `test/gate.test.cjs:176-187` | closed |
| T-01-08 | Elevation | mempalace / enabled check | high | mitigate | Strict `=== true` (`lib/checks.cjs:76`); `test/gate.test.cjs:75-90` | closed |
| T-01-09 | Tampering | renderGateFailures | low | mitigate | Budgeted output keeps break-glass line (`lib/checks.cjs:173-179`); `test/gate.test.cjs:152-174` | closed |
| T-01-10 | Tampering | lib/config.cjs nested lookup | medium | mitigate | Own-property lookup, prototype keys rejected (`lib/config.cjs:13,72-82`); `test/config.test.cjs:156-173` | closed |
| T-01-11 | Elevation | lib/config.cjs vs host config-get | high | mitigate | Contract test against real `config-get` (`test/config-contract.test.cjs:41-70,132-175`) on 1.20.1 and 1.22.0 (`ci.yml:21`) | closed |
| T-01-12 | Tampering | planningDirs (GSD_WORKSTREAM / GSD_PROJECT) | low | mitigate | Name validation (`lib/config.cjs:29-41,101-107`, `lib/checks.cjs:47-55`); `test/config.test.cjs:175-211` | closed |
| T-01-13 | Elevation | hooks at undispatched (point, kind) pairs | high | mitigate | `test/dispatch.test.cjs:31,62-108` on both hosts | closed |
| T-01-14 | DoS | loader traps dropping the capability | high | mitigate | `test/traps.test.cjs:142-155,190-197` | closed |
| T-01-15 | Tampering/Info disclosure | live probes vs real ~/.gsd and ~/.claude | medium | mitigate | Isolated homes and before/after hashes (`01-SPIKE.md:64,208-217`; `01-05-SUMMARY.md:123`) | closed |
| T-01-16 | Elevation | discuss:pre dispatch prose | high | mitigate | Spike variant A halted every run (`01-SPIKE.md:9,80-90,114`); `capability.json:55` | closed |
| T-01-17 | Elevation | discuss bypass paths (`--power`, `--assumptions`) | medium | accept | See accepted risk AR-01 | closed |
| T-01-18 | Elevation | headless claude runs | medium | mitigate | `--allowedTools`, no skip-permissions, budget cap, transcripts in scratchpad (`01-SPIKE.md:62,69,75`) | closed |
| T-01-19 | Elevation | not loaded / not consented / incompatible / not rendering | high | mitigate | Doctor errors for each (`test/doctor.test.cjs:204,216,232,245,260`); `README.md:194` | closed |
| T-01-20 | Tampering | doctor side effects | high | mitigate | Snapshots unchanged, zero memanto spawns (`test/bundle.test.cjs:160-212`); no fs write calls in shipped code | closed |
| T-01-21 | Tampering | edited global bundle (no hash binding) | low | accept | See accepted risk AR-02 | closed |
| T-01-22 | Info disclosure | doctor output | medium | mitigate | Reuses redacted gate records (`scripts/check-probe.cjs:10-13`; `memanto.cjs:33-35,76-88`) | closed |
| T-01-23 | Spoofing | locating a foreign gsd-tools | medium | mitigate | Project-local gsd-core never a candidate; `GSD_CORE_DIR` wins (`lib/gsd-host.cjs:59-72,114-121`; `test/gsd-host.test.cjs:117-140`) | closed |
| T-01-24 | Tampering | install.js run | high | mitigate | `01-07-SUMMARY.md:75-87`; `01-SPIKE.md:168-196`; `test/spike-installer.test.cjs:93-123` | closed |
| T-01-25 | Spoofing/Tampering | @opengsd/gsd-core fetched in CI | high | mitigate | Pinned versions (`ci.yml:21,33-40`; `publish.yml:76-83`) | closed |
| T-01-26 | Elevation | publish.yml credentials | high | mitigate | OIDC trusted publishing, staged approval, no tokens, persist-credentials false, git-config refusal (`publish.yml:103,110,153-178,252-258`) | closed |
| T-01-27 | Tampering/Info disclosure | release contents | medium | mitigate | `files` whitelist (`package.json:8-15`); `test/bundle.test.cjs:118-144`; `publish.yml:93-94` | closed |
| T-01-28 | Tampering | workflow input injection | medium | mitigate | Inputs via env only, no `${{ }}` inside run scripts (`publish.yml:113-115,155-157`; `ci.yml:35-36`) | closed |
| T-01-29 | Tampering | real Memanto data | high | mitigate | GET only (`lib/health.cjs:154`); `test/gate.test.cjs:210-212`; `01-09-SUMMARY.md:106` | closed |
| T-01-30 | Tampering | owner's real ~/.gsd and gsd-core | medium | mitigate | `01-09-SUMMARY.md:106-107`; `01-SPIKE.md:388` | closed |
| T-01-31 | Spoofing/Tampering | published tarball | high | mitigate | Provenance + integrity pin (`01-09-SUMMARY.md:45,82,107`; `01-VERIFICATION.md:46`) | closed |
| T-01-SC (×9, plans 01-01…01-09) | Tampering | supply chain (npm/pip/cargo installs) | high | mitigate | Zero runtime dependencies, no lifecycle scripts, lockfile or node_modules; gsd-core install reviewed (`01-SPIKE.md:170`, `01-07-SUMMARY.md:80-82`); CI pins (`01-08-SUMMARY.md:133-135`); `01-09-SUMMARY.md:18,82` | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-01 | T-01-17 | `/gsd-discuss-phase --power` and `--assumptions` never render `discuss:pre` hooks in gsd-core 1.20.1 (`01-SPIKE.md:229-231`); not fixable without modifying gsd-core. Surfaced by the doctor `discuss-bypass` warning (`memanto.cjs:459-471`) and the README (`README.md:177,200-202`); carried to the Phase 2 GATE-05 owner decision | owner (01-05 plan disposition) | 2026-11-21 |
| AR-02 | T-01-21 | gsd-core hash-binds project-scope installs only; a hand-edited global bundle still loads. Documented as a gsd-core host limit (`README.md:194`); mitigated by the `--integrity` pin at install (`README.md:33-36`) and doctor's gate-match check | owner ("Document as host limit", review round 8) | 2026-11-22 |

*Accepted risks do not resurface in future audit runs.*

### Unregistered flags (non-blocking, carried to Phase 2)

- **consent-disclosure-gap** (01-01-SUMMARY): gsd-core's consent disclosure does not show the gate's `sh -c` command. Host behaviour; partly offset by the mandatory `--yes` for the command family (`test/install.test.cjs:117-129`, `README.md:39`).
- **credential-egress** (01-02-SUMMARY, `lib/health.cjs:110-116`): URL userinfo is sent as a Basic Authorization header, cleartext over http, to the configured host only (redirects not followed). To be registered with the Phase 2 host allow-list decision.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-11-22 | 40 | 40 | 0 | gsd-security-auditor (ASVS L1, block_on high; HEAD 99031c3; npm test 551/550/1 skip/0 fail) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-11-22
