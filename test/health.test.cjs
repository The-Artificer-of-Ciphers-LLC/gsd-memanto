'use strict';
// CONF-03 / D-01..D-03: endpoint URL validation, redaction and GET /health,
// unit-tested against lib/health.cjs and end to end through check predicate.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const env = require('./helpers/gsd-env.cjs');
const { startFakeApi } = require('./helpers/fake-api.cjs');

// Loaded per test so a missing module fails the unit cases one by one instead
// of aborting the whole file before the gate cases run.
const health = () => require('../lib/health.cjs');
const displayBase = (value) => require('../lib/checks.cjs').displayBase(value);

const PHASE_DIR = '.planning/phases/01-test';
const PREFIX = 'command exited 1: ';
const servers = {};

let home;
let project;
let predicate;

before(async () => {
  for (const mode of ['ok', 'ok-extra', 'http-500', 'not-ok', 'bad-json', 'hang', 'closed']) {
    servers[mode] = await startFakeApi({ mode });
  }
  home = env.tmpDir('memanto-home-');
  project = env.makeProject({ config: { memanto: { enabled: true, agent_id: '' } }, phaseDirs: ['01-test'] });
  env.installBundle({ home });
  const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home }));
  assert.equal(hooks.length, 1, 'expected exactly one memanto gate at discuss:pre');
  predicate = hooks[0].check.predicate;
});

after(async () => {
  for (const s of Object.values(servers)) await s.close();
  env.cleanup();
});

function runGate(memanto) {
  env.writeConfig(project, { memanto: { enabled: true, agent_id: 'health-agent', ...memanto } });
  const res = env.checkPredicate(predicate, { cwd: project, home, phaseDir: PHASE_DIR, phaseNumber: '01' });
  assert.equal(res.status, 0, `check predicate CLI should exit 0, stderr: ${res.stderr}`);
  const message = res.json.message || '';
  const body = message.startsWith(PREFIX) ? message.slice(PREFIX.length) : message;
  const blocked = body.split('\n').filter((l) => l.startsWith('memanto: BLOCKED ['));
  const ids = blocked.map((l) => l.slice('memanto: BLOCKED ['.length, l.indexOf(']')));
  return { block: res.json.block, message, blocked, ids };
}

function lineFor(r, id) {
  return r.blocked.find((l) => l.startsWith(`memanto: BLOCKED [${id}]`));
}

// --- unit: validateEndpointUrl ---

test('validateEndpointUrl rejects empty, non-string, scheme-less and non-http(s) values', () => {
  const { validateEndpointUrl } = health();
  assert.deepEqual(validateEndpointUrl(''), { ok: false, reason: 'empty' });
  assert.deepEqual(validateEndpointUrl('   '), { ok: false, reason: 'empty' });
  assert.deepEqual(validateEndpointUrl(42), { ok: false, reason: 'not-a-string' });
  assert.deepEqual(validateEndpointUrl(null), { ok: false, reason: 'not-a-string' });
  for (const v of ['localhost:8000', 'not a url', 'ftp://h/', 'file:///etc/passwd']) {
    assert.deepEqual(validateEndpointUrl(v), { ok: false, reason: 'invalid-url' }, v);
  }
});

// IN-05: one whitespace rule for every memanto value: surrounding whitespace
// blocks (as memanto.agent_id does), it is never trimmed away silently.
test('validateEndpointUrl rejects a URL with leading or trailing whitespace', () => {
  const { validateEndpointUrl } = health();
  for (const v of [' http://h:1', 'http://h:1 ', '\thttp://h:1\n', ' http://h:1 ']) {
    assert.deepEqual(validateEndpointUrl(v), { ok: false, reason: 'whitespace' }, JSON.stringify(v));
  }
});

for (const key of ['backend_url', 'api_url']) {
  test(`memanto.${key} with surrounding whitespace blocks with a whitespace line and no request`, () => {
    const before = servers.ok.requests.length;
    const other = key === 'backend_url' ? 'api_url' : 'backend_url';
    const r = runGate({ [key]: ` ${servers.ok.url} `, [other]: servers.ok.url });
    const id = key === 'backend_url' ? 'backend-url' : 'api-url';
    assert.deepEqual(r.ids, [id], r.message);
    assert.ok(lineFor(r, id).includes(`memanto.${key} has leading or trailing whitespace`), r.message);
    assert.equal(servers.ok.requests.length - before, 1, 'only the other endpoint should be probed');
  });
}

// --- Round-4 CR-01: one strict allowlist rule ---
//
// An endpoint is accepted only when the RAW value matches
//   http(s)://[user[:password]@]host[:port][/path]
// with URL-safe characters only, at most one '@' (the userinfo separator), no
// '?', '#', '\', whitespace, control or non-ASCII character, valid %XX escapes,
// and no '@' in any form in the path; and new URL(value) agrees on scheme,
// host and port. Every input reported in review rounds 1-4 is in this table.
// [value, substrings of the value that must never be printed]
const SECRETS = ['alice', 's3cret', 'memanto.internal'];
const REJECTED = [
  // Round 4 (CR-01): a '\' or '/' inside the user name.
  ['http://127.0.0.1\\alice:s3cret@memanto.internal:8000', SECRETS],
  ['http://127.0.0.1/alice:s3cret@memanto.internal:8000', SECRETS],
  ['http://127.0.0.1/s3cretTokenTail@memanto.internal:8000', ['s3cretTokenTail', 'memanto.internal']],
  ['http://tok/en@host', ['tok/', 'en@']],
  ['http://tok/en@host:8000', ['tok/', 'en@']],
  ['http://Zm9v/YmFy@host', ['Zm9v', 'YmFy']],
  // Round 1 (CR-02): reserved characters in an unencoded password.
  ['http://user:p/ss@host:8000', ['p/ss']],
  ['http://user:p#w@host', ['p#w']],
  ['http://user:p?w@host:8000/x', ['p?w']],
  ['http://user:p@ss@host:99999', ['p@ss']],
  ['http://user:p w@host:99999', ['p w']],
  ['http://user:p@ss@host:8000/', ['p@ss', 'ss@']],
  // Round 2 (CR-02): a password that parses as a port.
  ['http://u:12/x@host:8000', ['12/x', 'u:12']],
  ['http://user:123#w@host', ['123', '#w']],
  ['http://user:123?w@host:8000', ['123', '?w']],
  ['http:\\\\u:12\\x@host:8000', ['u:12', '12\\x']],
  ['http://u:pw@host:8000/x@y', ['u:pw', 'x@y']],
  ['http://u:12/x%40host:8000', ['12/x', 'u:12']],
  // Round 3 (WR-01): a mistyped separator.
  ['http://alice:s3cret%40memanto.internal:8000', SECRETS],
  ['https://alice:s3cret%40memanto.internal/api', SECRETS],
  ['http://alice:s3cret＠memanto.internal:8000', SECRETS],
  ['http://alice:s3cret﹫memanto.internal:8000', SECRETS],
  ['http://alice:s3cret%EF%BC%A0memanto.internal:8000', SECRETS],
  ['http://alice:s3cret%EF%B9%ABmemanto.internal:8000', SECRETS],
  ['alice:s3cret%40memanto.internal:8000', SECRETS],
  ['http:alice:s3cret%40memanto.internal:8000', SECRETS],
  ['ftp://alice:s3cret%40memanto.internal:21', SECRETS],
  // Round 3 (IN-01): an '@' in the path, query or fragment.
  ['http://host:8000/a@b', ['a@b']],
  ['http://host/?x=a@b', ['x=a', 'a@b']],
  ['https://host/api#a@b', ['#a', 'a@b']],
  ['http://u@host/x@y', ['x@y']],
  ['http://host:8000/a%40b', ['a%40b']],
  // Other values outside the allowlist.
  ['http://alice:s3cret@memanto.internal:8000/api?token=t0k', [...SECRETS, 't0k']],
  ['localhost:8000', ['localhost']],
  ['not a url\nmemanto: BLOCKED [fake] x -> y', ['[fake]', 'not a url']],
  ['http://u:p%4@host', ['p%4@']],
  ['http://u:p%FF@host', ['p%FF']],
  ['http://h:99999', ['99999']],
  ['http://0x7f.1:8000', ['0x7f']],
  ['HTTP://memanto.internal:8000', ['memanto.internal']],
  ['file:///etc/passwd', ['passwd']],
];

const ACCEPTED = [
  // [value, displayBase output]
  ['http://localhost:8000', 'http://localhost:8000'],
  ['https://u:p%40ss@h:1/base', 'https://h:1/<base path>'],
  ['http://[::1]:8000', 'http://[::1]:8000'],
  ['http://h:1', 'http://h:1'],
  ['https://u:p@h:1/', 'https://h:1'],
  ['http://@host', 'http://host'],
  ['http://@host:8000/api', 'http://host:8000/<base path>'],
  ['http://u:@h:1', 'http://h:1'],
  ['http://Memanto.Example:8080/a/b/', 'http://memanto.example:8080/<base path>'],
];

// Round-4 IN-02: one message for every rejected value. It states the rule, so a
// credential-free URL with an '@' in its path is told to remove it, and it fits
// LINE_MAX (250) untruncated.
function rejectedLine(key) {
  const id = key === 'backend_url' ? 'backend-url' : 'api-url';
  return (
    `memanto: BLOCKED [${id}] value <redacted> -> memanto.${key} must be ` +
    "http(s)://[user[:password]@]host[:port][/path] using URL-safe characters; '@' is allowed only as the " +
    "user:password separator (write '@' inside a password as %40)"
  );
}

test('the rejected-value line fits LINE_MAX for both keys', () => {
  for (const key of ['backend_url', 'api_url']) assert.ok(rejectedLine(key).length <= 250, rejectedLine(key));
});

for (const [value, secrets] of REJECTED) {
  const label = JSON.stringify(value);
  test(`validateEndpointUrl rejects ${label}`, () => {
    assert.deepEqual(health().validateEndpointUrl(value), { ok: false, reason: 'invalid-url' });
  });

  test(`displayBase prints ${label} as <redacted>`, () => {
    assert.equal(displayBase(value), '<redacted>');
  });

  test(`the gate blocks ${label} for both keys, never probes it and never prints it`, () => {
    const before = servers.ok.requests.length;
    const r = runGate({ backend_url: value, api_url: value });
    assert.equal(r.block, true, r.message);
    assert.deepEqual(r.ids, ['backend-url', 'api-url'], r.message);
    for (const key of ['backend_url', 'api_url']) {
      const id = key === 'backend_url' ? 'backend-url' : 'api-url';
      assert.equal(lineFor(r, id), rejectedLine(key));
    }
    for (const secret of secrets) assert.ok(!r.message.includes(secret), `leaked ${JSON.stringify(secret)}: ${r.message}`);
    assert.ok(!r.message.includes('curl'), `probed: ${r.message}`);
    assert.equal(servers.ok.requests.length, before, 'nothing may be probed');
  });
}

for (const [value, shown] of ACCEPTED) {
  test(`validateEndpointUrl accepts ${value} and displayBase shows only ${shown}`, () => {
    const v = health().validateEndpointUrl(value);
    assert.equal(v.ok, true, JSON.stringify(v));
    assert.equal(displayBase(value), shown);
  });
}

test('displayBase never prints userinfo or a base path', () => {
  const out = displayBase('https://alice:s3cret@memanto.internal:8443/tenant-42/v1');
  assert.equal(out, 'https://memanto.internal:8443/<base path>');
  for (const secret of ['alice', 's3cret', 'tenant-42']) assert.ok(!out.includes(secret), out);
});

test('a rejected value pointing at a live local port is not probed, so nothing leaves the machine', () => {
  const port = new URL(servers.ok.url).port;
  const before = servers.ok.requests.length;
  const r = runGate({ backend_url: `http://127.0.0.1:${port}/x@host:8000`, api_url: servers.ok.url });
  assert.deepEqual(r.ids, ['backend-url'], r.message);
  assert.ok(!r.message.includes('/x') && !r.message.includes(port), r.message);
  assert.ok(!lineFor(r, 'backend-url').endsWith('…'), 'the line must fit LINE_MAX with its fix');
  assert.deepEqual(servers.ok.requests.slice(before).map((q) => q.url), ['/health'], 'only the api probe may reach the server');
});

test('http://@host:port (empty userinfo) is probed without an Authorization header and passes', () => {
  const before = servers.ok.requests.length;
  const r = runGate({ backend_url: servers.ok.url.replace('http://', 'http://@'), api_url: servers.ok.url });
  assert.equal(r.block, false, r.message);
  const reqs = servers.ok.requests.slice(before);
  assert.equal(reqs.length, 2, JSON.stringify(reqs));
  for (const q of reqs) assert.equal(q.authorization, undefined, JSON.stringify(q));
});

test('the health line and curl hint of an unhealthy URL with userinfo and a base path show only scheme://host:port', () => {
  const base = servers.closed.url.replace('http://', 'http://alice:s3cret@');
  const r = runGate({ backend_url: `${base}/tenant-42`, api_url: servers.ok.url });
  assert.deepEqual(r.ids, ['backend-health'], r.message);
  const line = lineFor(r, 'backend-health');
  assert.ok(line.includes(`${servers.closed.url}/<base path>/health is not healthy (connection)`), line);
  assert.ok(line.includes(`curl -fsS ${servers.closed.url}/<base path>/health`), line);
  for (const secret of ['alice', 's3cret', 'tenant-42']) assert.ok(!r.message.includes(secret), `leaked ${secret}: ${r.message}`);
});

// --- unit: checkHealth against the fake REST ---

for (const [mode, expected] of [
  ['ok', { ok: true }],
  ['ok-extra', { ok: true }],
  ['http-500', { ok: false, reason: 'http-500' }],
  ['not-ok', { ok: false, reason: 'status-not-ok' }],
  ['bad-json', { ok: false, reason: 'bad-json' }],
  ['closed', { ok: false, reason: 'connection' }],
]) {
  test(`checkHealth against a ${mode} server returns ${JSON.stringify(expected)}`, async () => {
    const before = servers[mode].requests.length;
    const res = await health().checkHealth(servers[mode].url);
    assert.deepEqual(res, expected);
    if (mode !== 'closed') {
      assert.deepEqual(servers[mode].requests.slice(before), [{ method: 'GET', url: '/health' }]);
    }
  });
}

test('checkHealth against a hanging server times out after one attempt', async () => {
  const before = servers.hang.requests.length;
  const started = Date.now();
  const res = await health().checkHealth(servers.hang.url, { timeoutMs: 200 });
  assert.deepEqual(res, { ok: false, reason: 'timeout' });
  assert.ok(Date.now() - started < 3000, 'timeout was not honored');
  assert.deepEqual(servers.hang.requests.slice(before), [{ method: 'GET', url: '/health' }]);
});

test('checkHealth appends /health to a base path and ignores a trailing slash', async () => {
  const before = servers.ok.requests.length;
  assert.deepEqual(await health().checkHealth(`${servers.ok.url}/api`), { ok: true });
  assert.deepEqual(await health().checkHealth(`${servers.ok.url}/`), { ok: true });
  assert.deepEqual(servers.ok.requests.slice(before).map((r) => r.url), ['/api/health', '/health']);
});

test('checkHealth sends URL userinfo as Basic auth, as curl does', async () => {
  const before = servers.ok.requests.length;
  const url = servers.ok.url.replace('http://', 'http://user:pa%20ss@');
  assert.deepEqual(await health().checkHealth(url), { ok: true });
  const [req] = servers.ok.requests.slice(before);
  assert.equal(req.url, '/health');
  assert.equal(req.authorization, `Basic ${Buffer.from('user:pa ss').toString('base64')}`);
});

test('checkHealth decodes a %40 in the password and probes only the parsed host and base path', async () => {
  const before = servers.ok.requests.length;
  const url = `${servers.ok.url.replace('http://', 'http://u:p%40ss@')}/base`;
  assert.deepEqual(await health().checkHealth(url), { ok: true });
  const [req] = servers.ok.requests.slice(before);
  assert.equal(req.url, '/base/health');
  assert.equal(req.authorization, `Basic ${Buffer.from('u:p@ss').toString('base64')}`);
});

test('checkHealth refuses a value outside the allowlist without a request', async () => {
  const before = servers.ok.requests.length;
  const port = new URL(servers.ok.url).port;
  assert.deepEqual(await health().checkHealth(`http://127.0.0.1:${port}/x@host:8000`), { ok: false, reason: 'invalid-url' });
  assert.equal(servers.ok.requests.length, before);
});

// --- gate: through gsd-core's real check predicate ---

test('gate passes with agent_id set and both endpoints healthy', () => {
  const r = runGate({ backend_url: servers.ok.url, api_url: servers['ok-extra'].url });
  assert.equal(r.block, false, r.message);
});

test('empty backend_url blocks with [backend-url] and the config-set fix', () => {
  const r = runGate({ backend_url: '', api_url: servers.ok.url });
  assert.deepEqual(r.ids, ['backend-url'], r.message);
  assert.equal(
    lineFor(r, 'backend-url'),
    'memanto: BLOCKED [backend-url] memanto.backend_url is empty -> gsd_run config-set memanto.backend_url <http(s)://host:port>',
  );
});

test('empty api_url blocks with [api-url] and the config-set fix', () => {
  const r = runGate({ backend_url: servers.ok.url, api_url: '' });
  assert.deepEqual(r.ids, ['api-url'], r.message);
  assert.equal(
    lineFor(r, 'api-url'),
    'memanto: BLOCKED [api-url] memanto.api_url is empty -> gsd_run config-set memanto.api_url <http(s)://host:port>',
  );
});

test('absent URL keys block with both URL lines (defaults are empty)', () => {
  const r = runGate({});
  assert.deepEqual(r.ids, ['backend-url', 'api-url'], r.message);
});

test('a scheme-less backend_url blocks with [backend-url] and skips its health check', () => {
  const r = runGate({ backend_url: 'localhost:8000', api_url: servers.ok.url });
  assert.deepEqual(r.ids, ['backend-url'], r.message);
  assert.equal(lineFor(r, 'backend-url'), rejectedLine('backend_url'));
});

test('an ftp api_url blocks with [api-url] and sends no request', () => {
  const before = servers.ok.requests.length;
  const r = runGate({ backend_url: servers.ok.url, api_url: servers.ok.url.replace('http:', 'ftp:') });
  assert.deepEqual(r.ids, ['api-url'], r.message);
  assert.equal(servers.ok.requests.length - before, 1, 'only the backend probe should reach the server');
});

test('a non-string backend_url blocks with [backend-url]', () => {
  const r = runGate({ backend_url: 8000, api_url: servers.ok.url });
  assert.deepEqual(r.ids, ['backend-url'], r.message);
  assert.ok(lineFor(r, 'backend-url').includes('memanto.backend_url must be a string'), r.message);
});

for (const [mode, reason] of [
  ['http-500', 'http-500'],
  ['not-ok', 'status-not-ok'],
  ['bad-json', 'bad-json'],
  ['closed', 'connection'],
]) {
  test(`a ${mode} backend blocks with [backend-health] (${reason}) only`, () => {
    const r = runGate({ backend_url: servers[mode].url, api_url: servers.ok.url });
    assert.deepEqual(r.ids, ['backend-health'], r.message);
    const line = lineFor(r, 'backend-health');
    assert.ok(line.includes(`${servers[mode].url}/health is not healthy (${reason})`), line);
    assert.ok(line.includes('(the capability never starts it), then check: curl -fsS'), line);
  });

  test(`a ${mode} api blocks with [api-health] (${reason}) only`, () => {
    const r = runGate({ backend_url: servers.ok.url, api_url: servers[mode].url });
    assert.deepEqual(r.ids, ['api-health'], r.message);
    const line = lineFor(r, 'api-health');
    assert.ok(line.includes(`${servers[mode].url}/health is not healthy (${reason})`), line);
    assert.ok(line.includes('bring the Memanto REST API at'), line);
  });
}

test('an api that never answers blocks with [api-health] (timeout) within the 5 s budget', () => {
  const started = Date.now();
  const r = runGate({ backend_url: servers.ok.url, api_url: servers.hang.url });
  assert.deepEqual(r.ids, ['api-health'], r.message);
  assert.ok(lineFor(r, 'api-health').includes('is not healthy (timeout)'), r.message);
  assert.ok(Date.now() - started < 8000, `took ${Date.now() - started} ms`);
});
