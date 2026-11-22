'use strict';
// Endpoint URL validation, display and the GET /health probe (CONF-03, D-01..D-03).
// One code path for every backend kind (on-prem or cloud): no backend switch.
// The probe never returns, logs or echoes the response body.

const ECHO_MAX = 160;
const BODY_MAX_BYTES = 64 * 1024;
// D-03: fixed per-endpoint budget; deliberately not configurable via config or env.
const HEALTH_TIMEOUT_MS = 5000;

// C0/C1 controls plus the Unicode line and paragraph separators (ASCII-only source).
// The one filter for every echoed value: lib/checks.cjs and memanto.cjs import it (IN-03).
const CONTROL_CHARS = /[\x00-\x1f\x7f-\x9f\p{Zl}\p{Zp}]/gu;

function cap(value, max = ECHO_MAX) {
  const s = String(value);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// Round-4 CR-01: ONE strict allowlist rule, checked on the raw value before any
// WHATWG parsing, replaces every earlier heuristic. An endpoint is
//   http(s)://[user[:password]@]host[:port][/path]
// with URL-safe ASCII characters only. '@' appears at most once, and only as
// the userinfo separator: it is not a user, password, host or path character,
// and '?', '#', '\', whitespace, controls and non-ASCII are not allowed
// anywhere. A '%' must start a valid %XX escape, and the decoded path holds no
// '@' in any form. Anything else is rejected and never echoed or probed.
// Owner follow-up: the scheme alone is matched case-insensitively (HTTP://,
// Https://) and normalised to lower case for display and the probe.
const ENDPOINT_RE = new RegExp(
  '^([Hh][Tt][Tt][Pp][Ss]?)://' +
    "(?:([A-Za-z0-9._~!$&'()*+,;=%-]*)(?::([A-Za-z0-9._~!$&'()*+,;=%-]*))?@)?" +
    '([A-Za-z0-9.-]+|\\[[0-9A-Fa-f:.]+\\])' +
    '(?::([0-9]{1,5}))?' +
    "(/[A-Za-z0-9._~!$&'()*+,;=:%/-]*)?$",
);
const BAD_ESCAPE = /%(?![0-9A-Fa-f]{2})/;
const AT_FORMS = /[@＠﹫]/;
const DEFAULT_PORT = { http: 80, https: 443 };
const REDACTED = '<redacted>';
const BASE_PATH = '/<base path>';

function decode(part) {
  if (BAD_ESCAPE.test(part)) return null;
  try {
    return decodeURIComponent(part);
  } catch {
    return null;
  }
}

// The accepted parts of value, or null. The display form is `origin`
// (scheme://host[:port]); userinfo and path are never part of it.
function parseEndpoint(value) {
  if (typeof value !== 'string') return null;
  const m = ENDPOINT_RE.exec(value);
  if (!m) return null;
  const [, rawScheme, rawUser, rawPass, rawHost, rawPort, rawPath = ''] = m;
  const scheme = rawScheme.toLowerCase();
  const user = rawUser === undefined ? '' : decode(rawUser);
  const pass = rawPass === undefined ? '' : decode(rawPass);
  const path = decode(rawPath);
  if (user === null || pass === null || path === null || AT_FORMS.test(path)) return null;
  const host = rawHost.toLowerCase();
  const port = rawPort === undefined ? null : Number(rawPort);
  if (port !== null && port > 65535) return null;
  // Defence in depth: the WHATWG parser must agree on scheme, host and port.
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (u.protocol !== `${scheme}:` || u.hostname !== host) return null;
  if (Number(u.port || DEFAULT_PORT[scheme]) !== (port === null ? DEFAULT_PORT[scheme] : port)) return null;
  const base = rawPath.replace(/\/+$/, '');
  return {
    origin: `${scheme}://${host}${port === null ? '' : `:${port}`}`,
    base,
    user,
    pass,
  };
}

// IN-05: the same whitespace rule as memanto.agent_id: whitespace only is
// empty, and leading or trailing whitespace blocks (it is never trimmed away).
// { ok: true, url } | { ok: false, reason: 'empty' | 'not-a-string' | 'whitespace' | 'invalid-url' }
function validateEndpointUrl(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not-a-string' };
  if (value.trim() === '') return { ok: false, reason: 'empty' };
  if (value.trim() !== value) return { ok: false, reason: 'whitespace' };
  if (!parseEndpoint(value)) return { ok: false, reason: 'invalid-url' };
  return { ok: true, url: value };
}

// The only text ever printed for an endpoint: scheme://host[:port] of an
// accepted value, with '/<base path>' standing in for a base path, or
// <redacted> for anything else.
function displayEndpoint(value) {
  const e = parseEndpoint(value);
  if (!e) return REDACTED;
  return e.base === '' ? e.origin : `${e.origin}${BASE_PATH}`;
}

// The probe target, built from the accepted parts: <origin><base path>/health,
// plus a Basic Authorization header from the decoded userinfo (fetch refuses
// credentials in the URL itself; curl sends them the same way). The header
// goes only to the accepted host.
function healthRequest(value) {
  const e = parseEndpoint(value);
  if (!e) return null;
  const headers = {};
  if (e.user || e.pass) headers.authorization = `Basic ${Buffer.from(`${e.user}:${e.pass}`).toString('base64')}`;
  return { target: new URL(`${e.origin}${e.base}/health`), headers };
}

async function readBounded(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function failureReason(err, signal) {
  if (signal.aborted || (err && err.name === 'TimeoutError')) return 'timeout';
  return 'connection';
}

// One GET, no retry, redirects not followed.
// { ok: true } | { ok: false, reason: 'timeout' | 'connection' | 'http-<code>' | 'bad-json' | 'status-not-ok' | 'invalid-url' }
async function checkHealth(url, { timeoutMs = HEALTH_TIMEOUT_MS } = {}) {
  let req;
  try {
    req = healthRequest(url);
  } catch {
    req = null;
  }
  if (!req) return { ok: false, reason: 'invalid-url' };
  const signal = AbortSignal.timeout(timeoutMs);
  let res;
  try {
    res = await fetch(req.target, { method: 'GET', headers: req.headers, redirect: 'manual', signal });
  } catch (e) {
    return { ok: false, reason: failureReason(e, signal) };
  }
  if (res.status < 200 || res.status > 299) {
    if (res.body) await res.body.cancel().catch(() => {});
    return { ok: false, reason: `http-${res.status}` };
  }
  let text;
  try {
    text = await readBounded(res, BODY_MAX_BYTES);
  } catch (e) {
    return { ok: false, reason: failureReason(e, signal) };
  }
  if (text === null) return { ok: false, reason: 'bad-json' };
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'bad-json' };
  }
  if (!body || typeof body !== 'object' || body.status !== 'ok') return { ok: false, reason: 'status-not-ok' };
  return { ok: true };
}

module.exports = { validateEndpointUrl, checkHealth, displayEndpoint, cap, ECHO_MAX, CONTROL_CHARS, REDACTED, BASE_PATH };
