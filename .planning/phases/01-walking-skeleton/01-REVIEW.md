---
phase: 01-walking-skeleton
reviewed: 2026-11-22T15:10:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - memanto.cjs
  - lib/safe-read.cjs
  - lib/gate-bundle.cjs
  - lib/install-state.cjs
  - lib/config.cjs
  - README.md
  - test/bundle.test.cjs
  - test/doctor.test.cjs
  - test/gate-bundle.test.cjs
  - test/helpers/install-invariants.cjs
  - test/install-state.test.cjs
  - test/release.test.cjs
  - test/render-points.test.cjs
  - test/safe-read.test.cjs
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 1: Code Review Report (round 10, re-review of the round-9 fixes and the release-bump hash fix)

**Reviewed:** 2026-11-22T15:10:00Z
**Depth:** standard
**Files Reviewed:** 14 (`git diff a0a2173^1 HEAD -- . ':!.planning' ':!CHANGELOG.md'`; `capability.json`, `.github/workflows/publish.yml` and the gsd-core 1.20.1 predicate evaluator read as context)
**Status:** issues_found

## Summary

`npm test`: 512 tests, 511 pass, 1 skipped, 0 fail. Every host run used a temp `GSD_HOME` and a temp project. The only network targets were the fake API (`test/helpers/fake-api.cjs`) and the closed port `127.0.0.1:9`. No real Memanto server was contacted. The necessity reference was not read this round, so no necessity findings are claimed and the `necessity:` count is left out.

Repro scripts are in `/private/tmp/claude-501/-Users-trekkie-projects-gsd-memanto/4f758622-4157-4863-b789-bcac255aeca3/scratchpad/r10/`:
- `release.cjs <patch|minor> <agent|EMPTY> <global|project>`: runs the release simulation.
- `r10h.cjs` / `r10h2.cjs <mode>`: plants hostile files next to a healthy global install.
- `r10a.cjs`: covers GSD_HOME equal to the project root.
- `r10w.cjs` / `r10w2.cjs <mode>`: edits gate fields (`when`, `timeout`, `gexit0`, `gnonblock`, `gpin`).

### Release simulation (release-critical check 1): passes

`release.cjs` does these steps:
1. Exports `HEAD` with `git archive`.
2. Extracts the `run:` block of the publish.yml "Bump the version" step and runs it with bash and `BUMP=patch` (`npm version` plus the heredoc).
3. Copies only the `package.json` `files` whitelist.
4. Installs it into a temp `GSD_HOME` with `gsd-tools capability install <dir> --yes`.

Results:
- **0.1.1, global:** both `gsd_run memanto doctor` and the direct form exit 0. `loaded`, `render:discuss:pre` and `gate-bundle` are ok, and the only non-ok record is the `discuss-bypass` warn. The rendered gate is `blocking:true`, `onError:halt`, and `check predicate` gives `block:false`.
- **0.1.1, project scope:** same result.
- **Minor bump (0.2.0):** same result.
- **Empty `agent_id`:** the gate gives `block:true` with `BLOCKED [agent-id] memanto.agent_id is empty`, and doctor exits 1 with an `agent-id` error.

### Release-critical check 2

**Fail-open:** none found.
- `exit 0`, `blocking:false`/`onError:skip` and an old-release pin all give `loaded`, `render:discuss:pre` and `gate-bundle` errors, with doctor exit 1.
- A gate `when` key that is false is filtered by gsd-core, so it renders nothing, and doctor reports errors.
- A large predicate `timeout` cannot pass a failing gate, because the evaluator blocks on a timeout.

**Credential echo:** none found in the new code paths.

**Hang:** none found. Doctor finished in under 1 s every time, with any of these planted:
- a FIFO at the project ledger or the global ledger;
- a directory at `config.json`;
- a symlink to `/dev/zero` at `config.json` or at the project manifest;
- a symlink loop;
- a 1.1 MB `config.json`;
- an unconsented third-party project capability whose `fragment.path` is a FIFO (gsd-core `render-hooks` ran in 79 ms).

**Fix hint that deletes a ledgered install:** found. See WR-01.

### Status of the round-9 findings

| Round-9 | Verdict | Evidence |
|---------|---------|----------|
| CR-01 | Fixed | `r9/r9f.cjs cur`: doctor finishes in 0.97 s with `unreadable-files`. `lib/safe-read.cjs:47-91` does `lstat`, then `stat` on a symlink, a type and size check, an `O_NONBLOCK` open, then `fstat` again. The FIFO, device, loop and oversize repros above all pass. |
| WR-01 | Fixed | `r10w2.cjs gexit0`, `gnonblock` and `gpin` give the fields `command`, `blocking, onError` and `version`, with three errors and exit 1. The constants are checked at `memanto.cjs:288-307`. |
| WR-01 bump fix | Fixed | The release simulation above. `normalisePins` uses the same pattern as `publish.yml:212`. |
| WR-02 | Fixed | `r9/r9p2.cjs 40`: 1 render record, 0 ESC bytes, 0.84 s. `LOOP_POINTS` is drift-tested against `loop-host-contract.cjs`. |
| WR-03 | Fixed | The `NO_GATE_STATES` branch in `duplicateRecord` (`lib/install-state.cjs`), the new shared invariant, and the green table and doctor tests. |
| IN-01 | Fixed | `loaded` is pushed whenever gsd-core is located (`memanto.cjs`, `collectChecks`), with the disabled warn in `loadedRecord`. |
| IN-02 | Fixed | `ledgerState` gives `pending` for `{op}` and `true`, and `none` for `null`, `false`, `0` and `''` (checked directly). |
| IN-03 | Fixed | The no-gate fix is now "reinstall ... in place at this release". `renderFix(null)` gives the reinstall alone. |

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: An unreadable ledger makes doctor tell the user to delete a ledgered global bundle by hand, which contradicts the new `unreadable-files` record

**File:** `lib/gate-bundle.cjs:85-95` (`ledgerState` returns `'none'` on any read error), `lib/install-state.cjs:333-336` (`deleteFix`), `memanto.cjs:226-243` (`unreadableCheck`)

**Issue:** Round 9 made doctor detect a ledger that exists but cannot be read (`unreadableFiles`). That knowledge feeds only the separate `unreadable-files` record, not the classifier. `ledgerState`, `isInstalledBundle` and `resolveGateBundle` still turn an EACCES, FIFO or over-8-MiB ledger into "no ledger entry". The ledgered global copy is then classed as unledgered, and `gate-bundle` gives `deleteFix`:

> delete <GSD_HOME>/.gsd/capabilities/memanto by hand (no global ledger entry lists it, so gsd-tools capability remove cannot remove it), then reinstall

In the same output, `unreadable-files` says to move the ledger aside and reinstall. So two records give opposite remedies, and one of them deletes an install that has a committed ledger entry. This breaks the round-8 WR-01 rule ("a ledgered copy is never deleted by hand") and release-critical check 2. Doctor still exits 1, and the gate still blocks, so this does not fail open. That is why it is a WARNING.

**Reproduced:**
- `node r10h2.cjs gledgerfifo` (the global ledger replaced by a FIFO).
- `node r10h.cjs ledgereacces` (the global ledger `chmod 0`).

Both give `gate-bundle error ... FIX: delete <home>/.gsd/capabilities/memanto by hand (no global ledger entry lists it ...)`, and next to it `unreadable-files ... FIX: move <home>/.gsd-capabilities.json aside, then reinstall memanto in global scope`.

**Fix:** Give the ledger a fourth state and treat it as unknown, never as absent:
```js
// lib/gate-bundle.cjs
function ledgerState(root) {
  if (!root) return 'none';
  const r = readRegularFile(ledgerFile(root), LEDGER_MAX_BYTES);
  if (r.absent) return 'none';
  if (!r.ok) return 'unreadable';
  // ... parse as today, 'none' only when the parsed ledger has no memanto entry
}
```
In `classifyInstall`, map `'unreadable'` to `ledgered: true` for the delete and stray rules (or add a state such as `ledger-unreadable`). Its primary fix should be to repair the ledger, and `deleteFix` should never be used for it. Add a table case and a doctor repro, a FIFO and a `chmod 0` global ledger, that assert no record says "delete ... by hand".

### WR-02: `unreadable-files` fixes ignore the classifier's scope model: wrong scope with GSD_HOME at the project root, and "reinstall memanto" in a scope that holds no memanto copy

**File:** `memanto.cjs:226-243` (`unreadableCheck`)

**Issue:** `unreadableCheck` is built outside the classifier, the pattern round 7 removed, so it repeats two bugs that the classifier already fixed.

1. **Alias scope.** When `GSD_HOME` is the project root, the `seen` dedupe keeps the first label, `global`. For a ledgered copy with an unreadable `capability.json`, it then says "reinstall the global copy in place: ... --yes", with no `--scope project`. `loaded`, `render:discuss:pre` and `gate-bundle` all say "reinstall the project copy in place ... --scope project", because the round-8 WR-02 `rootsAlias` demotion applies to them. A global-scope reinstall there does not give the copy a project consent record.
2. **Ledger fix.** The ledger fix always says "move <ledger> aside, then reinstall memanto in <scope> scope".
   - A planted unreadable project ledger next to a healthy global install leads to a new project install, and so to a duplicate install.
   - For a global ledger that is only `EACCES`, moving it aside drops the ledger entry of every other global capability, which then stops dispatching. A `chmod` would be the right repair.

**Reproduced:**
- `node r10a.cjs eacces`: `unreadable-files FIX: reinstall the global copy in place: ... --yes`, against `loaded FIX: reinstall the project copy in place ... --yes --scope project`.
- `node r10h.cjs ledgerfifo`: a FIFO project ledger next to a healthy global install gives "move <project>/.gsd-capabilities.json aside, then reinstall memanto in project scope", while `loaded` names the global copy.

**Fix:**
- Build the record from `cls`: use `cls.copies` for the scope and dir, which already applies `rootsAlias`, and the same `installCmd(o, scope)`.
- For a ledger, suggest a reinstall only when that scope holds the memanto copy gsd-core would load. Otherwise say "move it aside; memanto is not installed in this scope".
- Base the fix on the error code: `EACCES`/`EPERM` gets "restore read permission on <file>", and only `ENOTREG`/`EFBIG` get "move aside".
- Add these cases to the shared invariants: `unreadable-files` names the same scope and install command as `loaded`, and never suggests an install in a scope with no copy.

## Info

### IN-01: A directory at `.planning/config.json` makes doctor skip gsd-core and claim that gsd-core blocks, which is false

**File:** `memanto.cjs:512`, `memanto.cjs:517`, `README.md:188`

**Issue:** `hostBlocked` tests `code === 'ENOTREG'`, which covers a directory as well as a FIFO, socket or device. gsd-core reading a directory fails at once with EISDIR and does not block. Doctor still skips `capability list` and `render-hooks` and says "gsd-core blocks reading it". README:188 says this happens only for "a FIFO or device". Repro: `node r10h.cjs cfgdir`. This fails closed, so only the wording and the lost evidence are affected.

**Fix:** Return the kind from `readRegularFile` (for example `fifo`, `socket`, `device`, `directory`), and set `hostBlocked` only for the first three.

### IN-02: The README says the gate reads every project file through the safe reader, but the shipped predicate does not

**File:** `README.md:172`, `capability.json:63` (predicate `j()`)

**Issue:** "Doctor and the gate read every file in a project or capability directory this way". The predicate's `j()` reads the ledger and manifest with `statSync().isFile()` and then a plain `readFileSync`. It has no size cap and no `O_NONBLOCK`, so a FIFO can be swapped in between the check and the read. Its BLOCKED text for an unreadable global ledger also says "delete that directory by hand", the same remedy as WR-01. `capability.json` is not in this diff, so this is about the README claim only.

**Fix:** Reword the README to say the gate's lib code (`scripts/gate.cjs` and `lib/`) uses the safe reader, and the inline predicate checks `isFile` only. Revisit the predicate text together with WR-01.

### IN-03: The release test does not install the bumped bundle or run doctor end to end

**File:** `test/release.test.cjs` (the `bumpedCopy` and `after a ${kind} release bump` tests)

**Issue:** The test runs only the heredoc, not `npm version` or the full `run:` block. It then unit-calls `gateMismatch`. A bump regression outside `gateMismatch` would still ship green, because the release job runs no tests after the bump. Examples: `ownVersion`, `releaseVersion` and `package.json` drifting apart, or a failure in the rendered predicate.

**Fix:** Port `scratchpad/r10/release.cjs` into a test. It should extract the full `run:` block and use a stub `git` with no tags, install the bumped `files` whitelist into a temp `GSD_HOME`, and assert doctor exit 0 with `loaded`, `render:discuss:pre` and `gate-bundle` ok.

---

_Reviewed: 2026-11-22T15:10:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
