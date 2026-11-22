'use strict';
// Shared check records for the gate (and, later, doctor). Every record is
// { id, status: 'ok' | 'warn' | 'error', message, fix }.

const { resolveConfig } = require('./config.cjs');
const { validateEndpointUrl, checkHealth, displayEndpoint, BASE_PATH, cap, CONTROL_CHARS } = require('./health.cjs');

// D-01: both endpoints are full URLs; D-03: both are probed the same way.
const ENDPOINTS = Object.freeze([
  { key: 'backend_url', urlId: 'backend-url', healthId: 'backend-health', label: 'backend' },
  { key: 'api_url', urlId: 'api-url', healthId: 'api-health', label: 'REST API' },
]);

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

// D-04 budget: every echoed value (paths, error text) is capped at 160
// characters with control characters neutralised before it is formatted.
const LINE_MAX = 250;

function echo(value) {
  return cap(String(value).replace(CONTROL_CHARS, '?'));
}

function configUnreadable(cfg) {
  if (cfg.kind === 'env') {
    const variable = echo(cfg.variable);
    return {
      id: 'config-unreadable',
      status: 'error',
      message: `${variable} is invalid (${echo(cfg.error)})`,
      fix: `unset ${variable} or set it to a name without '/', '\\' or '..'`,
    };
  }
  const file = echo(cfg.path);
  if (cfg.kind === 'read') {
    return {
      id: 'config-unreadable',
      status: 'error',
      message: `${file} cannot be read (${echo(cfg.error)})`,
      fix: `make ${file} readable`,
    };
  }
  return {
    id: 'config-unreadable',
    status: 'error',
    message: `${file} is not valid JSON`,
    fix: `fix the JSON syntax in ${file}`,
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

// CONF-03 / D-02: an endpoint URL must be set explicitly and be http(s).
function checkEndpointUrl(cfg, ep) {
  const key = `memanto.${ep.key}`;
  const value = cfg.get(key);
  const v = validateEndpointUrl(value);
  if (v.ok) return { record: { id: ep.urlId, status: 'ok', message: `${key} is set`, fix: '' }, url: v.url };
  let message;
  let fix = `gsd_run config-set ${key} <http(s)://host:port>`;
  if (v.reason === 'empty') message = `${key} is empty`;
  else if (v.reason === 'not-a-string') message = `${key} must be a string`;
  else if (v.reason === 'whitespace') message = `${key} has leading or trailing whitespace`;
  else {
    // Round-4 CR-01: a value outside the allowlist is never echoed in any part.
    // Round-4 IN-02: the fix states the whole rule, so a credential-free URL
    // with an '@' in its path is told what is wrong too. The check id and the
    // fix name the key, so the line fits LINE_MAX (250) untruncated.
    message = 'value <redacted>';
    fix =
      `${key} must be http(s)://[user[:password]@]host[:port][/path] using URL-safe characters; ` +
      "'@' is allowed only as the user:password separator (write '@' inside a password as %40)";
  }
  return { record: { id: ep.urlId, status: 'error', message, fix }, url: null };
}

// Display form of an endpoint (round-4 CR-01): scheme://host[:port] of an
// accepted value, '/BASE_PATH' in place of any base path, never userinfo;
// <redacted> for a value outside the allowlist (lib/health.cjs).
function displayBase(url) {
  return displayEndpoint(url);
}

// D-03: one GET <url>/health, 5 s, no retry. The capability never starts,
// stops or reconfigures either server.
async function checkEndpointHealth(ep, url) {
  const res = await checkHealth(url);
  const shown = displayBase(url);
  if (res.ok) return { id: ep.healthId, status: 'ok', message: `${shown}/health is healthy`, fix: '' };
  // With a base path the origin is not repeated, so the curl hint fits LINE_MAX.
  const at = shown.endsWith(BASE_PATH) ? '' : ` at ${shown}`;
  // Round-5 IN-01: the URL is single-quoted so the hint is safe to paste into a
  // shell (an IPv6 host's brackets would glob; the display never holds a quote).
  return {
    id: ep.healthId,
    status: 'error',
    message: `${shown}/health is not healthy (${res.reason})`,
    fix: `bring the Memanto ${ep.label}${at} up (the capability never starts it), then check: curl -fsS '${shown}/health'`,
  };
}

// D-04: every check is evaluated before returning; records come back in CHECK_ORDER.
async function runGateChecks({ cwd, env } = {}) {
  const cfg = resolveConfig({ cwd, env });
  if (!cfg.ok) return [configUnreadable(cfg)];
  const records = [checkMempalace(cfg), checkAgentId(cfg)];
  const probes = [];
  for (const ep of ENDPOINTS) {
    const { record, url } = checkEndpointUrl(cfg, ep);
    records.push(record);
    if (url) probes.push(checkEndpointHealth(ep, url));
  }
  records.push(...(await Promise.all(probes)));
  return byCheckOrder(records);
}

// D-04: one line per failing check, each capped at 250 characters, then the
// break-glass line. The host keeps only the HEAD 2000 characters (18 of them
// its own prefix), so lines are capped individually and the joined text is
// never truncated: the break-glass line always survives as the last line.
function renderGateFailures(records) {
  const lines = byCheckOrder(records.filter((r) => r && r.status === 'error')).map((r) =>
    cap(`memanto: BLOCKED [${r.id}] ${r.message} -> ${r.fix}`, LINE_MAX),
  );
  lines.push(BREAK_GLASS);
  return lines.join('\n');
}

// displayBase is exported for tests only.
module.exports = { runGateChecks, renderGateFailures, displayBase, BREAK_GLASS, CHECK_ORDER };
