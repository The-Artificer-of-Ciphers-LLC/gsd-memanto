'use strict';
// Endpoint URL validation, redaction and the GET /health probe (CONF-03, D-01..D-03).
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

// { ok: true, url } | { ok: false, reason: 'empty' | 'not-a-string' | 'invalid-url' | 'bad-scheme' }
function validateEndpointUrl(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not-a-string' };
  if (value.trim() === '') return { ok: false, reason: 'empty' };
  let u;
  try {
    u = new URL(value.trim());
  } catch {
    return { ok: false, reason: 'invalid-url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'bad-scheme' };
  return { ok: true, url: u.href };
}

// Schemes whose URLs carry a parsed userinfo component (WHATWG "special" schemes
// with credentials). For anything else, '@' text cannot be trusted to be a path.
const CREDENTIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);

// Strips userinfo (also from values that do not parse as URLs), neutralises
// control characters so an echoed value cannot start a new gate line, and caps
// the result at 160 characters. CR-02: a value that does not parse (the usual
// cause is a password with an unescaped '/', '?', '#', '@' or space) loses
// everything from after the scheme up to its LAST '@', so no part of the
// userinfo survives.
function redactUrl(value) {
  let s = String(value).replace(CONTROL_CHARS, '?');
  let u = null;
  try {
    u = new URL(s);
  } catch {
    u = null;
  }
  if (u && CREDENTIAL_SCHEMES.has(u.protocol)) {
    if (u.username || u.password) {
      u.username = '';
      u.password = '';
      s = u.href;
    }
    return cap(s);
  }
  s = s.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)?.*@/s, '$1');
  return cap(s);
}

// The probe target: <base>/health with query and fragment dropped, plus a
// Basic Authorization header when the URL carries userinfo (fetch refuses
// credentials in the URL itself; curl sends them the same way).
function healthRequest(url) {
  const u = new URL(url);
  const headers = {};
  if (u.username || u.password) {
    const creds = `${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`;
    headers.authorization = `Basic ${Buffer.from(creds).toString('base64')}`;
    u.username = '';
    u.password = '';
  }
  u.search = '';
  u.hash = '';
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return { target: new URL('health', u), headers };
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
    return { ok: false, reason: 'invalid-url' };
  }
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

module.exports = { validateEndpointUrl, checkHealth, redactUrl, cap, ECHO_MAX, CONTROL_CHARS };
