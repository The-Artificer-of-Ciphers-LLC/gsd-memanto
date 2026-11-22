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

// IN-05: the same whitespace rule as memanto.agent_id: whitespace only is
// empty, and leading or trailing whitespace blocks (it is never trimmed away).
// { ok: true, url } | { ok: false, reason: 'empty' | 'not-a-string' | 'whitespace' | 'invalid-url' | 'bad-scheme' | 'ambiguous-userinfo' }
function validateEndpointUrl(value) {
  if (typeof value !== 'string') return { ok: false, reason: 'not-a-string' };
  if (value.trim() === '') return { ok: false, reason: 'empty' };
  if (value.trim() !== value) return { ok: false, reason: 'whitespace' };
  const c = classifyUrl(value);
  if (c.kind === 'invalid') return { ok: false, reason: 'invalid-url' };
  if (c.kind === 'bad-scheme') return { ok: false, reason: 'bad-scheme' };
  // Round-2 CR-02: never probe a value whose '@' is not a well-formed userinfo.
  // http://u:12/x@host:8000 parses with host u and path /x@host:8000, so a probe
  // would send the password ("12/x") to another host.
  if (c.kind === 'ambiguous') return { ok: false, reason: 'ambiguous-userinfo' };
  return { ok: true, url: c.url.href };
}

// Schemes whose URLs carry a parsed userinfo component (WHATWG "special" schemes
// with credentials). For anything else, '@' text cannot be trusted to be a path.
const CREDENTIAL_SCHEMES = new Set(['http:', 'https:', 'ws:', 'wss:', 'ftp:']);
const HTTP_SCHEMES = new Set(['http:', 'https:']);
const REDACTED = '<redacted>';
// Round-3 WR-01: an ASCII '@' and the forms a mistyped separator takes without
// one: percent-encoded, full-width (U+FF20), small (U+FE6B), and their UTF-8
// percent-encodings.
const AT_LIKE = /@|%40|\uFF20|\uFE6B|%EF%BC%A0|%EF%B9%AB/i;

// The scheme, authority and rest of value as the WHATWG parser splits a special
// URL: tabs and newlines removed, leading and trailing C0 controls and spaces
// removed, every '/' or '\' after "scheme:" skipped, and the authority ending
// at the first '/', '\', '?' or '#'. null when value has no scheme.
function splitUrl(value) {
  const s = String(value).replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
  const m = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(s);
  if (!m) return null;
  const after = s.slice(m[0].length);
  const slashes = /^[/\\]*/.exec(after)[0].length;
  const body = after.slice(slashes);
  const end = body.search(/[/\\?#]/);
  return {
    scheme: `${m[1].toLowerCase()}:`,
    slashes,
    authority: end === -1 ? body : body.slice(0, end),
    rest: end === -1 ? '' : body.slice(end),
  };
}

// The URL with its userinfo removed when value is a well-formed
// user:password@host URL: it parses with a credential scheme, it carries
// userinfo, and no '@' is left once that userinfo is removed. null otherwise.
function withoutUserinfo(value) {
  let u;
  try {
    u = new URL(value);
  } catch {
    return null;
  }
  if (!CREDENTIAL_SCHEMES.has(u.protocol) || !(u.username || u.password)) return null;
  u.username = '';
  u.password = '';
  return u.href.includes('@') ? null : u;
}

// True when value holds an '@' that is not part of a well-formed userinfo:
// it does not parse, or it parses with the '@' in the path, query or fragment
// (a password such as "12/x" makes http://u:12/x@host a valid URL with host u).
function hasAmbiguousUserinfo(value) {
  const s = String(value);
  return s.includes('@') && withoutUserinfo(s) === null;
}

// One classification for validation and display (round-3 WR-01):
//   { kind: 'clean', url }     a parsed http(s) URL with no userinfo
//   { kind: 'userinfo', url }  a parsed http(s) URL with a well-formed userinfo
//   { kind: 'ambiguous' | 'bad-scheme' | 'invalid', parts }  anything else
// A value is never 'clean' or 'userinfo' unless the parser and the text agree
// on where the authority ends and whether it holds userinfo, and the host part
// holds no '@' look-alike.
function classifyUrl(value) {
  const parts = splitUrl(value);
  let u = null;
  try {
    u = new URL(value);
  } catch {
    return { kind: 'invalid', parts };
  }
  if (!parts || !HTTP_SCHEMES.has(u.protocol)) return { kind: 'bad-scheme', parts };
  const at = parts.authority.lastIndexOf('@');
  const userinfo = at !== -1;
  const hostPart = parts.authority.slice(at + 1);
  if (AT_LIKE.test(hostPart) || (!userinfo && (u.username || u.password))) return { kind: 'ambiguous', parts };
  if (hasAmbiguousUserinfo(value)) return { kind: 'ambiguous', parts };
  return { kind: userinfo ? 'userinfo' : 'clean', url: u };
}

// Neutralises control characters so an echoed value cannot start a new gate
// line, and caps the result at 160 characters. Round-3 WR-01: only a cleanly
// parsed http(s) URL is echoed. One with userinfo is shown as
// scheme://host:port/path (no userinfo, query or fragment). Any other value
// is shown as <scheme>://<redacted>, or <redacted> when it has no scheme, so
// no part of its authority is ever echoed, whatever the parser made of it.
// base: true drops the query, fragment and trailing slash of a clean URL too
// (the form the health line and the curl hint print).
function redactUrl(value, { base = false } = {}) {
  const c = classifyUrl(value);
  if (c.kind === 'clean' || c.kind === 'userinfo') {
    const u = c.url;
    let shown = c.kind === 'clean' && !base ? u.href : `${u.protocol}//${u.host}${u.pathname}`;
    if (base) shown = shown.replace(/\/+$/, '');
    return cap(shown.replace(CONTROL_CHARS, '?'));
  }
  const p = c.parts;
  const prefix = p && (p.slashes >= 2 || HTTP_SCHEMES.has(p.scheme)) ? `${p.scheme}//` : '';
  return cap(`${prefix}${REDACTED}`);
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
