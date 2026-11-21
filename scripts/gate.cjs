#!/usr/bin/env node
'use strict';
// Blocking gate entrypoint, executed by the host's command-exit-zero predicate
// (sh -c, cwd = project root). Exit 0 passes; anything else blocks. Every
// failure path, including an internal error, exits 1 (fail closed).

const BREAK_GLASS_FALLBACK = '(memanto.enabled=false disables Memanto for this project)';

async function main() {
  const { runGateChecks, renderGateFailures } = require('../lib/checks.cjs');
  const records = await runGateChecks({ cwd: process.cwd(), env: process.env });
  if (!Array.isArray(records)) throw new Error('runGateChecks returned no records');
  if (!records.some((r) => r && r.status === 'error')) {
    process.exitCode = 0;
    return;
  }
  process.stderr.write(renderGateFailures(records) + '\n');
  process.exitCode = 1;
}

main().catch((e) => {
  const msg = String(e && e.message ? e.message : e).slice(0, 300);
  process.stderr.write(
    `memanto: BLOCKED [gate-internal] ${msg} -> node "\${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/memanto.cjs" doctor\n` +
      `${BREAK_GLASS_FALLBACK}\n`,
  );
  process.exit(1);
});
