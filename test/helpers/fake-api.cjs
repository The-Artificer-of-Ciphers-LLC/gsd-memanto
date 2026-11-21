'use strict';
// Fake Memanto REST for the gate tests (TEST-02). The server runs in a CHILD
// process: the gate is reached through gsd-tools via spawnSync, which blocks the
// test process's event loop, so an in-process server could never answer it.
// Every request is appended to a JSON-lines log before any response, so the log
// is complete by the time a synchronous gate run returns.

const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const MODES = new Set(['ok', 'ok-extra', 'http-500', 'not-ok', 'bad-json', 'hang', 'closed']);

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
}

function respond(mode, res) {
  switch (mode) {
    case 'ok':
      return send(res, 200, '{"status":"ok"}');
    case 'ok-extra':
      return send(res, 200, JSON.stringify({ status: 'ok', model: 'secret-model', provider: 'secret-provider' }));
    case 'http-500':
      return send(res, 500, '{"status":"error"}');
    case 'not-ok':
      return send(res, 200, '{"status":"degraded"}');
    case 'bad-json':
      return send(res, 200, 'nope');
    case 'hang':
      return undefined; // never answer
    default:
      return send(res, 500, '{"status":"unknown-mode"}');
  }
}

// Child entrypoint: node fake-api.cjs <mode> <logPath>
function serve(mode, logPath) {
  const server = http.createServer((req, res) => {
    const entry = { method: req.method, url: req.url };
    if (req.headers.authorization) entry.authorization = req.headers.authorization;
    fs.appendFileSync(logPath, JSON.stringify(entry) + '\n');
    respond(mode, res);
  });
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`LISTENING ${server.address().port}\n`);
  });
  // The parent holds our stdin; when it goes away (normal close or a crashed
  // test run) we go too, so a 'hang' server can never outlive the tests.
  process.stdin.resume();
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function readLog(logPath) {
  let text = '';
  try {
    text = fs.readFileSync(logPath, 'utf8');
  } catch {
    return [];
  }
  return text
    .split('\n')
    .filter((l) => l !== '')
    .map((l) => JSON.parse(l));
}

async function startFakeApi({ mode = 'ok' } = {}) {
  if (!MODES.has(mode)) throw new Error(`fake-api: unknown mode ${mode}`);

  if (mode === 'closed') {
    // A port that was just bound and released: connections are refused.
    const port = await freePort();
    return {
      url: `http://127.0.0.1:${port}`,
      get requests() {
        return [];
      },
      close: async () => {},
    };
  }

  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-fakeapi-')));
  const logPath = path.join(dir, 'requests.jsonl');
  fs.writeFileSync(logPath, '');
  const child = spawn(process.execPath, [__filename, mode, logPath], { stdio: ['pipe', 'pipe', 'inherit'] });

  const onEarlyExit = (code, signal) => {
    startReject(new Error(`fake-api: ${mode} server exited before listening (${code ?? signal})`));
  };
  let startReject;
  const port = await new Promise((resolve, reject) => {
    startReject = reject;
    let buf = '';
    child.once('error', reject);
    child.once('exit', onEarlyExit);
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const m = /LISTENING (\d+)/.exec(buf);
      if (m) resolve(Number(m[1]));
    });
  });
  child.removeListener('exit', onEarlyExit);

  // Do not keep the test process alive if a test forgets close().
  child.unref();
  child.stdin.unref();
  child.stdout.unref();

  let closed = false;
  return {
    url: `http://127.0.0.1:${port}`,
    get requests() {
      return readLog(logPath);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (child.exitCode === null && child.signalCode === null) {
        child.ref();
        const exited = new Promise((resolve) => child.once('exit', resolve));
        child.kill('SIGKILL');
        await exited;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

if (require.main === module) {
  serve(process.argv[2], process.argv[3]);
}

module.exports = { startFakeApi, MODES };
