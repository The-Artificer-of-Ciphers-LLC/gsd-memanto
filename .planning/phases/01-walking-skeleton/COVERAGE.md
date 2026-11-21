# API Coverage — Memanto

> Full coverage by default. Opt-outs are explicit, reasoned decisions.
> Phase 1 (Walking Skeleton) touches Memanto only through two read-only `GET /health` probes in the discuss:pre gate and doctor. Every other Memanto surface is scheduled to a later phase by the roadmap; Phase 7 (COVR-01, COVR-02) records the project-wide integrate/opt-out decision for every Memanto feature.

| capability | decision | reason |
|---|---|---|
| REST API GET /health (memanto.api_url) | INTEGRATE | |
| backend GET /health (memanto.backend_url) | INTEGRATE | |
| agent activate / session TTL | OPT-OUT | not needed yet — scheduled for Phase 2 per ROADMAP (SESS-01, SESS-02) |
| agent existence check / canary write | OPT-OUT | not needed yet — scheduled for Phase 2 per ROADMAP (GATE-01) |
| recall (semantic, filtered, active) | OPT-OUT | not needed yet — scheduled for Phase 3 per ROADMAP (RECL-01) and Phase 5 (RECL-05) |
| answer (RAG synthesis) | OPT-OUT | not needed yet — scheduled for Phase 3 per ROADMAP (RECL-03) |
| agent bootstrap | OPT-OUT | not needed yet — scheduled for Phase 3 per ROADMAP (RECL-04) |
| MCP tools (interactive path) | OPT-OUT | not needed yet — scheduled for Phase 3 per ROADMAP (SESS-03) |
| remember / batch remember | OPT-OUT | not needed yet — scheduled for Phase 4 per ROADMAP (CAPT-01, CAPT-04, CAPT-05, CAPT-06) and Phase 5 (CAPT-02) |
| memory edit (in place) | OPT-OUT | not needed yet — scheduled for Phase 4 per ROADMAP (LIFE-07) |
| detect-conflicts / conflict resolve | OPT-OUT | not needed yet — scheduled for Phase 4 per ROADMAP (CNFL-01, CNFL-02, CNFL-03, CNFL-04) |
| upload (artifact files) | OPT-OUT | not needed yet — scheduled for Phase 5 per ROADMAP (CAPT-03) |
| daily-summary | OPT-OUT | not needed yet — scheduled for Phase 5 per ROADMAP (CAPT-07) |
| recall as-of / changed-since | OPT-OUT | not needed yet — scheduled for Phase 6 per ROADMAP (RECL-02) |
| memory expire / restore | OPT-OUT | not needed yet — scheduled for Phase 6 per ROADMAP (LIFE-01, LIFE-02) |
| policy presets / apply --dry-run | OPT-OUT | not needed yet — scheduled for Phase 6 per ROADMAP (LIFE-04, LIFE-05, LIFE-06) |
| memory export | OPT-OUT | not needed yet — scheduled for Phase 6 per ROADMAP (CONF-05 export toggle) |
| forget / memory sync / schedule | OPT-OUT | not needed yet — decision recorded project-wide in Phase 7 per ROADMAP (COVR-01) |
| agent create / delete, login / logout / use / connect | OPT-OUT | explicitly out of scope — owner prerequisites; the capability never manages agents, credentials or MCP registration (PROJECT.md constraints) |
