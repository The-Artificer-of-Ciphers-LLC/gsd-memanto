'use strict';
// `memanto` command family (D-17). route(ctx) is synchronous: gsd-core rejects
// a router that returns a Promise. ctx = { args, cwd, raw, error }, args[0] is
// the family name. Also runnable directly as `node memanto.cjs doctor [--raw]`
// for the states in which gsd-core does not route the family.

const path = require('node:path');
const { spawnSync } = require('node:child_process');

const USAGE = 'Usage: gsd_run memanto doctor [--raw]';
const DIRECT_FORM = 'node "${GSD_HOME:-$HOME}/.gsd/capabilities/memanto/memanto.cjs" doctor';
const PROBE = path.join(__dirname, 'scripts', 'check-probe.cjs');
const INTERNAL_FIX = 'report this failure; memanto.enabled=false disables Memanto for this project';

function record(id, status, message, fix) {
  return { id, status, message, fix: fix || '' };
}

// The gate's own checks, from the same check library, in a child process
// (the router cannot await the health probes). The probe's run time is bounded
// by the gate's own 5 s health budget (lib/health.cjs), probes run in parallel.
function gateChecks(cwd) {
  const res = spawnSync(process.execPath, [PROBE], { cwd, env: process.env, encoding: 'utf8' });
  if (res.error) {
    return [record('check-probe', 'error', `check probe did not run: ${String(res.error.message).slice(0, 300)}`, INTERNAL_FIX)];
  }
  try {
    const parsed = JSON.parse(res.stdout);
    if (!parsed || !Array.isArray(parsed.checks)) throw new Error('no checks array');
    return parsed.checks.map((c) => record(String(c.id), c.status, String(c.message), c.fix));
  } catch (e) {
    const why = `exit ${res.status === null ? res.signal : res.status}: ${String(res.stderr || e.message).slice(0, 300)}`;
    return [record('check-probe', 'error', `check probe output was not readable (${why})`, INTERNAL_FIX)];
  }
}

function renderText(checks) {
  const lines = [];
  for (const c of checks) {
    lines.push(`${c.status.padEnd(5)} ${c.id}  ${c.message}`);
    if (c.status !== 'ok' && c.fix) lines.push(`      fix: ${c.fix}`);
  }
  const errors = checks.filter((c) => c.status === 'error').length;
  const warnings = checks.filter((c) => c.status === 'warn').length;
  lines.push(`memanto doctor: ${errors} error(s), ${warnings} warning(s)`);
  lines.push(`direct form (when gsd_run memanto is unavailable): ${DIRECT_FORM}`);
  return lines.join('\n') + '\n';
}

// D-20: read-only. Reads config, spawns read-only host queries and GET /health.
function runDoctor(ctx) {
  const cwd = ctx.cwd || process.cwd();
  const checks = gateChecks(cwd);
  if (ctx.raw) process.stdout.write(JSON.stringify({ checks }) + '\n');
  else process.stdout.write(renderText(checks));
  process.exitCode = checks.some((c) => c.status === 'error') ? 1 : 0;
  return undefined;
}

function route(ctx) {
  const sub = ctx && Array.isArray(ctx.args) ? ctx.args[1] : undefined;
  if (sub === 'doctor') return runDoctor(ctx);
  ctx.error(USAGE);
  return undefined;
}

module.exports = { route };

if (require.main === module) {
  route({
    args: ['memanto', ...process.argv.slice(2).filter((a) => a !== '--raw')],
    cwd: process.cwd(),
    raw: process.argv.includes('--raw'),
    error: (msg) => {
      process.stderr.write(`Error: ${msg}\n`);
      process.exit(1);
    },
  });
}
