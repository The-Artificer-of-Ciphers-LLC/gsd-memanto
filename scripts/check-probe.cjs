#!/usr/bin/env node
'use strict';
// Prints the gate's check records as JSON {checks} on stdout so the
// synchronous doctor (memanto.cjs) can include the async health checks. Always
// exits 0: the doctor decides the verdict. Read-only, like the gate.

const FIX = 'report this failure; memanto.enabled=false disables Memanto for this project';

async function main() {
  const { runGateChecks } = require('../lib/checks.cjs');
  const checks = await runGateChecks({ cwd: process.cwd(), env: process.env });
  if (!Array.isArray(checks)) throw new Error('runGateChecks returned no records');
  process.stdout.write(JSON.stringify({ checks }) + '\n');
}

main().catch((e) => {
  const message = String(e && e.message ? e.message : e).slice(0, 300);
  process.stdout.write(JSON.stringify({ checks: [{ id: 'gate-internal', status: 'error', message, fix: FIX }] }) + '\n');
  process.exitCode = 0;
});
