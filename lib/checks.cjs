'use strict';
// Shared check records for the gate (and, later, doctor). Every record is
// { id, status: 'ok' | 'warn' | 'error', message, fix }.

const { resolveConfig } = require('./config.cjs');

const CHECK_ORDER = Object.freeze([
  'config-unreadable',
  'mempalace',
  'agent-id',
  'backend-url',
  'api-url',
  'backend-health',
  'api-health',
]);

const BREAK_GLASS = '(memanto.enabled=false disables Memanto for this project)';

function orderIndex(id) {
  const i = CHECK_ORDER.indexOf(id);
  return i === -1 ? CHECK_ORDER.length : i;
}

function byCheckOrder(records) {
  return records
    .map((r, i) => ({ r, i }))
    .sort((a, b) => orderIndex(a.r.id) - orderIndex(b.r.id) || a.i - b.i)
    .map((x) => x.r);
}

function configUnreadable(cfg) {
  if (cfg.kind === 'read') {
    return {
      id: 'config-unreadable',
      status: 'error',
      message: `${cfg.path} cannot be read (${cfg.error})`,
      fix: `make ${cfg.path} readable`,
    };
  }
  return {
    id: 'config-unreadable',
    status: 'error',
    message: `${cfg.path} is not valid JSON`,
    fix: `fix the JSON syntax in ${cfg.path}`,
  };
}

// GATE-03 / D-06: Memanto and MemPalace are mutually exclusive. Only the
// boolean true counts, matching gsd-core activation (strict === true).
function checkMempalace(cfg) {
  if (cfg.get('mempalace.enabled') === true) {
    return {
      id: 'mempalace',
      status: 'error',
      message: 'mempalace.enabled is true; Memanto and MemPalace are mutually exclusive',
      fix: 'gsd_run config-set mempalace.enabled false (or gsd_run config-set memanto.enabled false)',
    };
  }
  return { id: 'mempalace', status: 'ok', message: 'MemPalace is not enabled', fix: '' };
}

// CONF-02: the agent id must be explicit; never substitute another agent and
// never echo the configured value.
function checkAgentId(cfg) {
  const value = cfg.get('memanto.agent_id');
  const fix = 'gsd_run config-set memanto.agent_id <agent-id>';
  if (typeof value !== 'string') {
    return { id: 'agent-id', status: 'error', message: 'memanto.agent_id must be a string', fix };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return { id: 'agent-id', status: 'error', message: 'memanto.agent_id is empty', fix };
  }
  if (trimmed !== value) {
    return { id: 'agent-id', status: 'error', message: 'memanto.agent_id has leading or trailing whitespace', fix };
  }
  return { id: 'agent-id', status: 'ok', message: 'memanto.agent_id is set', fix: '' };
}

// D-04: every check is evaluated before returning; records come back in CHECK_ORDER.
async function runGateChecks({ cwd, env } = {}) {
  const cfg = resolveConfig({ cwd, env });
  if (!cfg.ok) return [configUnreadable(cfg)];
  return byCheckOrder([checkMempalace(cfg), checkAgentId(cfg)]);
}

function renderGateFailures(records) {
  const lines = byCheckOrder(records.filter((r) => r && r.status === 'error')).map(
    (r) => `memanto: BLOCKED [${r.id}] ${r.message} -> ${r.fix}`,
  );
  lines.push(BREAK_GLASS);
  return lines.join('\n');
}

module.exports = { runGateChecks, renderGateFailures, BREAK_GLASS, CHECK_ORDER };
