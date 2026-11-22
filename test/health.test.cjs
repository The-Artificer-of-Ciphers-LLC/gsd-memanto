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
  assert.ok(['invalid-url', 'bad-scheme'].includes(validateEndpointUrl('localhost:8000').reason));
  assert.equal(validateEndpointUrl('not a url').reason, 'invalid-url');
  assert.equal(validateEndpointUrl('ftp://h/').reason, 'bad-scheme');
  assert.equal(validateEndpointUrl('file:///etc/passwd').reason, 'bad-scheme');
});

test('validateEndpointUrl accepts http and https URLs, including userinfo', () => {
  const { validateEndpointUrl } = health();
  assert.equal(validateEndpointUrl('http://h:1').ok, true);
  assert.equal(validateEndpointUrl('https://u:p@h:1/').ok, true);
  assert.equal(validateEndpointUrl('http://localhost:8000').ok, true);
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

// --- unit: redactUrl ---

test('redactUrl strips userinfo and caps to 160 characters', () => {
  const { redactUrl } = health();
  assert.ok(!redactUrl('http://user:pass@host:1/x').includes('user:pass@'));
  assert.ok(!redactUrl('user:pass@host:1').includes('user:pass@'));
  assert.equal(redactUrl('http://host:1/x'), 'http://host:1/x');
  const long = redactUrl('http://user:pass@host:1/' + 'x'.repeat(5000));
  assert.ok(long.length <= 160, `length ${long.length}`);
  assert.ok(!long.includes('user:pass'));
});

// CR-02: a password with an unescaped reserved character is the usual reason a
// URL does not parse, so the unparseable path must strip userinfo too.
const UNPARSEABLE_USERINFO = [
  ['/', 'http://user:p/ss@host:8000', 'p/ss'],
  ['#', 'http://user:p#w@host', 'p#w'],
  ['?', 'http://user:p?w@host:8000/x', 'p?w'],
  ['@', 'http://user:p@ss@host:99999', 'p@ss'],
  ['a space', 'http://user:p w@host:99999', 'p w'],
];

for (const [label, value, secret] of UNPARSEABLE_USERINFO) {
  test(`redactUrl strips userinfo from an unparseable URL whose password holds ${label}`, () => {
    assert.throws(() => new URL(value), 'the case must not parse as a URL');
    const out = health().redactUrl(value);
    assert.ok(!out.includes(secret), `${JSON.stringify(value)} -> ${JSON.stringify(out)}`);
    assert.ok(!out.includes('user') && !out.includes('@'), `${JSON.stringify(value)} -> ${JSON.stringify(out)}`);
  });

  test(`the gate never prints the password of an unparseable backend_url holding ${label}`, () => {
    const r = runGate({ backend_url: value, api_url: servers.ok.url });
    assert.equal(r.block, true, r.message);
    assert.deepEqual(r.ids, ['backend-url'], r.message);
    assert.ok(!r.message.includes(secret), `password leaked: ${r.message}`);
    assert.ok(!r.message.includes('user:') && !r.message.includes('@'), `userinfo leaked: ${r.message}`);
  });
}

// Round-2 CR-02: a password that starts with port-like digits followed by '/',
// '?' or '#' PARSES, as a URL whose host is the username. Nothing before the
// last '@' may be echoed, and such a value is never probed.
const MISPARSED_USERINFO = [
  ['a path', 'http://u:12/x@host:8000', ['12/x', 'u:12', 'u:']],
  ['a fragment', 'http://user:123#w@host', ['123', 'user', '#w']],
  ['a query', 'http://user:123?w@host:8000', ['123', 'user', '?w']],
];

for (const [label, value, secrets] of MISPARSED_USERINFO) {
  test(`redactUrl hides userinfo that parses as host:port plus ${label}`, () => {
    assert.doesNotThrow(() => new URL(value), 'the case must parse as a URL');
    const out = health().redactUrl(value);
    for (const secret of secrets) assert.ok(!out.includes(secret), `${JSON.stringify(value)} -> ${JSON.stringify(out)}`);
    assert.ok(!out.includes('@'), `${JSON.stringify(value)} -> ${JSON.stringify(out)}`);
  });

  test(`validateEndpointUrl rejects a value whose '@' is not a well-formed userinfo (${label})`, () => {
    assert.deepEqual(health().validateEndpointUrl(value), { ok: false, reason: 'ambiguous-userinfo' });
  });

  test(`the gate never prints or probes the misparsed userinfo of a backend_url with ${label}`, () => {
    const r = runGate({ backend_url: value, api_url: servers.ok.url });
    assert.equal(r.block, true, r.message);
    assert.deepEqual(r.ids, ['backend-url'], r.message);
    for (const secret of secrets) assert.ok(!r.message.includes(secret), `userinfo leaked: ${r.message}`);
    assert.ok(!r.message.includes('@') && !r.message.includes('curl'), `userinfo leaked: ${r.message}`);
  });
}

test('a misparsed userinfo pointing at a live local port is not probed, so the password never leaves the machine', () => {
  const port = new URL(servers.ok.url).port;
  const before = servers.ok.requests.length;
  const r = runGate({ backend_url: `http://127.0.0.1:${port}/x@host:8000`, api_url: servers.ok.url });
  assert.deepEqual(r.ids, ['backend-url'], r.message);
  assert.ok(lineFor(r, 'backend-url').includes('memanto.backend_url has malformed credentials, so its host is ambiguous'), r.message);
  assert.ok(!r.message.includes('/x') && !r.message.includes(port), r.message);
  assert.ok(!lineFor(r, 'backend-url').endsWith('…'), 'the line must fit LINE_MAX with its fix');
  assert.deepEqual(servers.ok.requests.slice(before).map((q) => q.url), ['/health'], 'only the api probe may reach the server');
});

test('displayBase (the health line and the curl hint) never echoes misparsed userinfo', () => {
  const { displayBase } = require('../lib/checks.cjs');
  for (const [, value, secrets] of MISPARSED_USERINFO) {
    const href = new URL(value).href;
    const out = displayBase(href);
    for (const secret of secrets) assert.ok(!out.includes(secret), `${href} -> ${out}`);
    assert.ok(!out.includes('@'), `${href} -> ${out}`);
  }
  assert.equal(displayBase('http://user:pa%20ss@host:8000/api/?q=1#x'), 'http://host:8000/api');
});

test('redactUrl still shows the host of a well-formed user:password@host URL', () => {
  const { redactUrl, validateEndpointUrl } = health();
  assert.equal(redactUrl('http://user:pass@host:8000/x'), 'http://host:8000/x');
  assert.equal(redactUrl('http://user:p@ss@host:8000/'), 'http://host:8000/');
  assert.equal(validateEndpointUrl('http://user:p@ss@host:8000/').ok, true);
});

// Round-3 WR-01: a value with no literal ASCII '@' can still hold a password,
// for example an over-encoded %40 separator or an IME full-width '＠'. A value
// that is not a cleanly parsed http(s) URL never has its authority echoed.
const NO_ASCII_AT = [
  ['a %40 separator', 'http://alice:s3cret%40memanto.internal:8000', 'http://<redacted>'],
  ['a lower-case %40 separator and a path', 'https://alice:s3cret%40memanto.internal/api', 'https://<redacted>'],
  ['a full-width at sign', 'http://alice:s3cret＠memanto.internal:8000', 'http://<redacted>'],
  ['a small at sign', 'http://alice:s3cret﹫memanto.internal:8000', 'http://<redacted>'],
  ['a percent-encoded full-width at sign', 'http://alice:s3cret%EF%BC%A0memanto.internal:8000', 'http://<redacted>'],
  ['no scheme', 'alice:s3cret%40memanto.internal:8000', '<redacted>'],
  ['no slashes after the scheme', 'http:alice:s3cret%40memanto.internal:8000', 'http://<redacted>'],
  ['a non-http scheme', 'ftp://alice:s3cret%40memanto.internal:21', 'ftp://<redacted>'],
];
const NO_ASCII_AT_SECRETS = ['alice', 's3cret', 'memanto.internal'];

for (const [label, value, shown] of NO_ASCII_AT) {
  test(`redactUrl never echoes the authority of a value with ${label}`, () => {
    assert.equal(health().redactUrl(value), shown);
  });

  test(`displayBase (the health line and the curl hint) never echoes a value with ${label}`, () => {
    const out = require('../lib/checks.cjs').displayBase(value);
    for (const secret of NO_ASCII_AT_SECRETS) assert.ok(!out.includes(secret), `${JSON.stringify(value)} -> ${JSON.stringify(out)}`);
  });

  for (const key of ['backend_url', 'api_url']) {
    test(`the gate never prints memanto.${key} with ${label}`, () => {
      const other = key === 'backend_url' ? 'api_url' : 'backend_url';
      const r = runGate({ [key]: value, [other]: servers.ok.url });
      const id = key === 'backend_url' ? 'backend-url' : 'api-url';
      assert.equal(r.block, true, r.message);
      assert.deepEqual(r.ids, [id], r.message);
      assert.ok(lineFor(r, id).includes(`memanto.${key} is not an http(s) URL: ${shown} `), r.message);
      for (const secret of NO_ASCII_AT_SECRETS) assert.ok(!r.message.includes(secret), `leaked ${secret}: ${r.message}`);
    });
  }
}

test('redactUrl shows a URL with userinfo only as scheme://host:port/path', () => {
  const { redactUrl } = health();
  assert.equal(redactUrl('http://user:s3cret@host:8000/api?token=t0k#frag'), 'http://host:8000/api');
  assert.equal(redactUrl('https://user:s3cret@host/'), 'https://host/');
  assert.equal(redactUrl('http:user:s3cret@host:8000'), 'http://host:8000/');
});

test('the curl hint of an unhealthy URL with userinfo shows only scheme://host:port/path', () => {
  const base = servers.closed.url.replace('http://', 'http://alice:s3cret@');
  const r = runGate({ backend_url: `${base}/api?token=t0k`, api_url: servers.ok.url });
  assert.deepEqual(r.ids, ['backend-health'], r.message);
  const line = lineFor(r, 'backend-health');
  assert.ok(line.includes(`curl -fsS ${servers.closed.url}/api/health`), line);
  for (const secret of ['alice', 's3cret', 't0k']) assert.ok(!r.message.includes(secret), `leaked ${secret}: ${r.message}`);
});

test('redactUrl removes control characters so a value cannot forge extra gate lines', () => {
  const { redactUrl } = health();
  const out = redactUrl('not a url\nmemanto: BLOCKED [fake] x -> y\r');
  assert.ok(!/[\u0000-\u001f\u007f]/.test(out), JSON.stringify(out));
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
  // Round-3 WR-01: a value that is not a cleanly parsed http(s) URL is never echoed.
  assert.ok(lineFor(r, 'backend-url').includes('memanto.backend_url is not an http(s) URL: <redacted> ->'), r.message);
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
