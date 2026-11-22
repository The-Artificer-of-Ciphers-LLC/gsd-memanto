---
phase: 01-walking-skeleton
reviewed: 2026-11-22T06:10:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - memanto.cjs
  - lib/install-state.cjs
  - lib/gate-bundle.cjs
  - README.md
  - test/install-state.test.cjs
  - test/helpers/install-invariants.cjs
  - test/gate-bundle.test.cjs
  - test/loader-drift.test.cjs
findings:
  critical: 1
  warning: 3
  info: 3
  total: 7
status: issues_found
---

# Phase 1: Code Review Report (round 9, re-review of the round-8 doctor evidence fixes)

**Reviewed:** 2026-11-22T06:10:00Z
**Depth:** standard
**Files Reviewed:** 8 (`git diff 3157990^1 3157990 -- . ':!.planning'`; `lib/gsd-host.cjs` and the gsd-core 1.20.1 loader read as callees)
**Status:** issues_found

## Summary

`npm test`: 488 tests, 487 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network targets were the closed port `127.0.0.1:9` and, for one run (WR-01), `GET http://localhost:8000/health`. The necessity reference was not read this round, so no necessity findings are claimed and the `necessity:` count is left out.

Repro scripts are in `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r9/`:
- `r9f.cjs`: a FIFO planted at the project `capability.json` (CR-01). Pass `cur` for the working tree, or `base7` for the base.
- `r9.cjs` / `r9h.cjs`: an edited global gate predicate or blocking flag (WR-01). `r9h.cjs` uses the live `/health`.
- `r9p.cjs` / `r9p2.cjs`: a planted project manifest with control characters and many points (WR-02).
- `base7/`: a `git archive 3157990^1` export, used to show what the base does.

### Status of the round-8 findings

| Round-8 | Verdict | Evidence |
|---------|---------|----------|
| CR-01 | Fixed | `r8.cjs gnogate`: `loaded`, `render:discuss:pre` and `gate-bundle` are errors. `twonogate` gives `global-loaded-no-gate`. `twoinvalid` gives a `gate-bundle` error (the gate runs the global bundle, gsd-core loads the project one). `discuss:pre` is hard-coded in `declaredPoints` (`memanto.cjs:191-196`). `render.gate` is required for `LOADED_STATES` (`lib/install-state.cjs:225-226`). |
| WR-01 | Fixed | `r8c.cjs gcorrupt` gives `broken-install` with a reinstall-in-place fix. `gpending` gives `install-pending` with "finish or roll back". No record says "stray" or "delete". |
| WR-02 | Fixed | `r8b.cjs homeplain` and `homesym` report one project-scope copy. `loaded`, `consent` and `gate-bundle` all give the `--scope project` re-consent fix. `rootsAlias` (`memanto.cjs:274-283`) matches `overlayRoots` (`capability-loader.cjs:259-290`). |
| WR-03 | Fixed | The doctor facts come from the disk and from the test's own `render-hooks` call (`test/gate-bundle.test.cjs`, `assertDoctorConsistent`). The cross-record and re-consent rules are present (`test/helpers/install-invariants.cjs:121-149`). `scratchpad/r8/mutate8.out` shows that all 15 mutants are caught. |
| IN-01 | Fixed | `gate-bundle` hedges whenever `!cls.loaded` (`lib/install-state.cjs:581-582`). |

Round 8 found no new fail-open path in the classifier. `gate-bundle` ok requires all of: a `LOADED_STATES` state, which needs `render.gate`; `gateRuns` equal to the loaded directory; and no stray code. The two-copy scope inference was traced against the loader's skip order. Each misattribution found ends in a `gate-bundle` error, because the predicate never falls back to a project copy while a global `capability.json` exists. The issues below come from the new evidence gathering.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Regression: a FIFO planted at the project `capability.json` hangs doctor forever

**File:** `memanto.cjs:191-196` (`declaredPoints`), `memanto.cjs:35-41` (`readJson`)

**Issue:** Round 8 changed `declaredPoints` so that it always reads both scope manifests with `readJson`, which is a plain `fs.readFileSync`. Before, it stopped at the first manifest it found, which was the active (global) row's. A cloned repo controls `<project>/.gsd/capabilities/memanto/capability.json`. If that file is a FIFO, `readFileSync` blocks with no writer, and doctor never returns. `gsd_run memanto doctor` is a synchronous router, so it hangs too.

gsd-core treats exactly this as a HIGH finding (#1459 finding 2, `capability-loader.cjs:636-640`) and reads manifests through `readSmallRegularFile`. This repo's own `lib/gate-bundle.cjs:32-35` `readJsonFile` already guards with `statSync().isFile()`. `gatherEvidence` (`memanto.cjs:293`) reads the same file safely, but `declaredPoints` reads it first. An oversized planted file is read whole as well.

**Reproduced:** `node r9f.cjs cur` against the working tree: doctor is killed by a 30 s timeout (`SIGKILL`, `ETIMEDOUT`). `node r9f.cjs base7` against `3157990^1`: doctor finishes in 0.7 s and reports the `consent` error.

**Fix:** Read the manifests once, through the regular-file reader, and reuse them:
```js
// gatherEvidence already has manifests = per((s) => gateBundle.readManifest(rootOf[s]))
function declaredPoints(manifests) {
  const points = ['discuss:pre'];
  pointsOf(readJson(OWN_MANIFEST), points);
  for (const m of [manifests.global, manifests.project]) pointsOf(m, points);
  return points;
}
```
Compute `manifests` before the render loop in `collectChecks`. Also make `readJson` reject a file that is not regular, which also covers `enginesCheck` at `:166`. Add a FIFO doctor test (`mkfifo`, skipped on win32).

## Warnings

### WR-01: Doctor exits 0 with `loaded`, `render:discuss:pre` and `gate-bundle` ok when the installed global gate is `exit 0` or non-blocking

**File:** `memanto.cjs:198` (`isMemantoGate`), `memanto.cjs:213`, `lib/install-state.cjs:656`, `README.md:174`

**Issue:** The README now says `gate-bundle` is "`ok` only when the memanto gate renders at `discuss:pre` and its predicate runs the bundle of the copy that rendered it". However:
- `isMemantoGate` checks only `capId` and `kind`.
- `gateRuns` comes from doctor's own copy of the selection rule, not from the rendered predicate.
- `render-hooks` returns `check.predicate.command`, `blocking` and `onError` (observed), and doctor ignores all three.

So a global manifest whose gate is `command: "exit 0"`, or `blocking: false, onError: "skip"`, still gets: `loaded` ok "its gate renders at discuss:pre", `gate-bundle` ok "the discuss:pre gate renders and runs the installed bundle", and doctor exit 0. The `exit 0` gate never blocks.

This sits next to the owner's host-limit decision, because global bundles are not hash-bound. It is still raised for two reasons:
- The new README sentence is false in this case.
- Round-8 CR-01 (`gates: []`) was the same edited-manifest class and was treated as a finding. A stale or hand-"unblocked" `blocking:false` is a non-malicious way to reach it.

It is a WARNING, not a BLOCKER: anyone who can edit the unhashed global bundle can also edit `memanto.cjs`.

**Reproduced:** `node r9h.cjs gexit0` and `node r9h.cjs gnonblock` against the live `/health`: all three records ok, `errors:` empty, doctor exit 0. `r9.cjs gexit0` shows that `gsd-tools check predicate` on the rendered predicate returns `block:false`.

**Fix:** Require the rendered gate to match the shipped contract. Use constants in `memanto.cjs` (not `OWN_MANIFEST`, which is in the same editable bundle): `blocking === true`, `onError === 'halt'`, `check.predicate.kind === 'command-exit-zero'`, and a command equal to the shipped predicate string (or at least one that contains the `[gate-bundle]` selector and `scripts/gate.cjs`). Otherwise give `render:discuss:pre` an error such as "the memanto gate renders but is not the shipped blocking gate". Alternatively, reword the README to say doctor does not verify the predicate.

### WR-02: Regression: a planted project manifest now injects raw control characters into the doctor output and an unbounded number of `render-hooks` spawns, next to a legitimate global install

**File:** `memanto.cjs:191-196`, `memanto.cjs:208-218` (`renderCheck`: `id = render:${point}` and the `:214`/`:217` messages are not passed through `clean`)

**Issue:** `declaredPoints` now adds every `point` string from the untrusted, unconsented project manifest, even when a global copy is installed and loaded. Round 7 read only the active global manifest in that case. Each point becomes one `gsd-tools loop render-hooks <point>` spawn (about 170 ms each, so 40 points take 7.5 s, and there is no cap). Each point also becomes a record whose `id` is the raw point. `renderText` prints that `id` unescaped, so ESC/BEL sequences (terminal title, colour, OSC 8 links) reach the user's terminal. The `:211` message cleans the point, but the `id` does not.

**Reproduced:** `node r9p2.cjs 3 base7`: 1 render record and 0 raw ESC bytes. `node r9p2.cjs 3` (working tree): 5 render records and 2 raw ESC bytes, with `id` set to `render:\u001b]0;PWNED\u0007\u001b[31mRED`. `node r9p.cjs 40`: 42 render records in 7.5 s.

**Fix:**
- Take installed-manifest points only from a copy that is ledgered (`ledgerState !== 'none'`), or only from the loop points gsd-core defines (`loop-host-contract.cjs`). Drop anything else.
- Cap the point count.
- Build the `id` as `render:${clean(point, 64)}`, and clean every message that interpolates the point.

### WR-03: In the no-gate states, `duplicate-install` tells the user to remove the project copy first, which leaves the gate-less copy and is not marked as a load error

**File:** `lib/install-state.cjs:571-572`, `:277-286` (`NO_GATE_STATES` is not in `LOAD_ERROR_STATES`)

**Issue:** In `global-loaded-no-gate` (`r8.cjs twonogate`), the global copy holds the id and declares no gate. The consented project copy is the only one with the gate. `duplicate-install` gives the fix "remove one copy: gsd-tools capability remove memanto --scope project (or --scope global)". That fix does not start with "fix the load error first", and its first-named action removes the ledgered, healthy project install while the gate stays off. `loaded` and `gate-bundle` correctly name the global copy as the one to reinstall, so the records point at different copies. The mirror case, `project-loaded-no-gate`, gets the same generic text.

**Reproduced:** `r8.cjs twonogate`, `duplicate-install` record.

**Fix:** Add `GLOBAL_NO_GATE` and `PROJECT_NO_GATE` to the "fix the load error first" set. In those states, name the loaded gate-less copy (`cls.loaded.scope`) as the one to reinstall or remove, for example: `fix the load error first (see loaded); then remove the ${other} copy only after the ${loaded} copy renders the gate`. Add a shared invariant: in a no-gate state, no fix removes a copy other than `cls.loaded`.

## Info

### IN-01: The README promises a `loaded` warn when memanto is disabled, but doctor never emits `loaded` then

**File:** `README.md:170`, `memanto.cjs:395`, `lib/install-state.cjs:515`

**Issue:** `checks.push(recs.loaded)` runs only when `located.ok && enabled`. So the README sentence "`warn`: … or memanto is disabled so nothing was rendered" never applies, and the `DISABLED` branch of `loadedRecord` is reachable only from the table tests.

**Fix:** Drop the clause from the README, or emit `loaded` as a warn when disabled.

### IN-02: `ledgerState` treats any `_pending` key as pending; the loader requires a truthy `_pending`

**File:** `lib/gate-bundle.cjs:83`; loader `capability-loader.cjs:358`

**Issue:** With `_pending: null` or `false`, the loader treats the entry as neither pending nor committed. For a global copy it still loads it, but doctor's text says "its ledger entry is _pending … so gsd-core does not load it". The verdict still fails closed, because `gateRuns` is null. Only the wording is wrong.

**Fix:** Use `e._pending` truthiness for `'pending'`. A present but falsy `_pending` should be `'none'`, or a separate "malformed" state.

### IN-03: The fixes for the no-gate states point at things doctor already ruled out

**File:** `lib/install-state.cjs:366`, `memanto.cjs:218`

**Issue:** For the "declares none" case, the fix says "check that gsd-core reads memanto.enabled as true". Doctor only renders when enabled is true, so this check is already done. `render:discuss:pre` says "fix the reported load error" when no load error was reported (`gnogate`).

**Fix:** When `!declaresGate`, give only the reinstall-in-place command. Use `renderFix` wording that does not mention a load error when `reason` is null.

---

_Reviewed: 2026-11-22T06:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
