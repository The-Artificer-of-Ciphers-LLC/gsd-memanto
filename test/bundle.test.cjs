'use strict';
// INST-05 and D-20 characterization over the finished Phase-1 bundle:
// builtin-only requires, no symlinks or node_modules, a synchronous router, a
// pack list equal to the whitelist, and no runtime state written by the gate or
// by doctor (sequentially and concurrently), with zero memanto spawns.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const env = require('./helpers/gsd-env.cjs');
const { startFakeApi } = require('./helpers/fake-api.cjs');
const { installFakeMemanto } = require('./helpers/fake-memanto.cjs');

const ROOT = env.REPO_ROOT;
let packFiles;

before(() => {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, npm_config_loglevel: 'silent' },
  });
  assert.equal(res.status, 0, res.stderr);
  packFiles = JSON.parse(res.stdout)[0].files.map((f) => f.path).sort();
});

after(() => env.cleanup());

// --- 1. static: every require targets a node: builtin or a file inside the bundle ---

const REQUIRE_CALL = /\brequire\s*\(/g;
const LITERAL_REQUIRE = /^require\s*\(\s*(['"])([^'"]+)\1\s*\)/;

function requireTargets(file) {
  const src = fs.readFileSync(file, 'utf8');
  const out = [];
  for (const m of src.matchAll(REQUIRE_CALL)) {
    const lit = LITERAL_REQUIRE.exec(src.slice(m.index));
    out.push(lit ? lit[2] : null); // null: a non-literal require, which is refused
  }
  return out;
}

test('every require() in the shipped .cjs files is a node: builtin or a relative path inside the bundle', () => {
  const shipped = packFiles.filter((f) => f.endsWith('.cjs'));
  assert.ok(shipped.includes('memanto.cjs'), 'memanto.cjs is not in the pack list');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'capability.json'), 'utf8'));
  for (const c of manifest.commands || []) assert.ok(packFiles.includes(c.module), `command module ${c.module} not shipped`);
  for (const rel of shipped) {
    const abs = path.join(ROOT, rel);
    for (const target of requireTargets(abs)) {
      assert.ok(target !== null, `${rel}: non-literal require()`);
      if (target.startsWith('node:')) continue;
      assert.ok(target.startsWith('./') || target.startsWith('../'), `${rel}: require('${target}') is neither node: nor relative`);
      const resolved = path.relative(ROOT, path.resolve(path.dirname(abs), target)).split(path.sep).join('/');
      assert.ok(!resolved.startsWith('..'), `${rel}: require('${target}') leaves the bundle`);
      assert.ok(packFiles.includes(resolved), `${rel}: require('${target}') -> ${resolved} is not shipped`);
    }
  }
});

function walkLstat(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const name of fs.readdirSync(abs)) {
      const a = path.join(abs, name);
      const r = rel ? `${rel}/${name}` : name;
      const st = fs.lstatSync(a);
      out.push({ rel: r, st });
      if (st.isDirectory()) walk(a, r);
    }
  };
  walk(dir, '');
  return out;
}

test('the staged and the installed bundle hold no symlink and no node_modules', () => {
  const home = env.tmpDir('memanto-home-');
  env.installBundle({ home });
  for (const dir of [env.stageBundle(), path.join(home, '.gsd', 'capabilities', 'memanto')]) {
    const entries = walkLstat(dir);
    assert.ok(entries.length > 0, `${dir} is empty`);
    for (const { rel, st } of entries) {
      assert.equal(st.isSymbolicLink(), false, `symlink in bundle: ${rel}`);
      assert.ok(!rel.split('/').includes('node_modules'), `node_modules in bundle: ${rel}`);
    }
  }
});

// --- 2. router: synchronous, never a thenable ---

test('route() returns a value that is not thenable', () => {
  const home = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: { memanto: { enabled: false } } });
  const { route } = require('../memanto.cjs');
  const saved = { exitCode: process.exitCode, write: process.stdout.write, env: { ...process.env } };
  let value;
  let printed = '';
  try {
    Object.assign(process.env, { GSD_HOME: home, GSD_WORKSTREAM: '', GSD_PROJECT: '' });
    process.stdout.write = (chunk) => {
      printed += chunk;
      return true;
    };
    value = route({ args: ['memanto', 'doctor'], cwd: project, raw: true, error: () => {} });
  } finally {
    process.stdout.write = saved.write;
    for (const k of Object.keys(process.env)) if (!(k in saved.env)) delete process.env[k];
    Object.assign(process.env, saved.env);
    process.exitCode = saved.exitCode;
  }
  assert.notEqual(typeof (value && value.then), 'function', 'route() returned a thenable');
  assert.ok(Array.isArray(JSON.parse(printed).checks), printed);
});

// --- 3. pack list equals the whitelist ---

const ALLOWED = [/^package\.json$/, /^capability\.json$/, /^memanto\.cjs$/, /^lib\//, /^scripts\//, /^README\.md$/, /^LICENSE$/];
const REQUIRED = [
  'capability.json',
  'memanto.cjs',
  'package.json',
  'scripts/gate.cjs',
  'scripts/check-probe.cjs',
  'lib/config.cjs',
  'lib/checks.cjs',
  'lib/health.cjs',
  'lib/gsd-host.cjs',
  'lib/gate-bundle.cjs',
];

test('npm pack --dry-run lists only whitelisted paths and every required file', () => {
  for (const f of packFiles) {
    assert.ok(ALLOWED.some((re) => re.test(f)), `unexpected path in the pack list: ${f}`);
    for (const prefix of ['test/', 'tools/', '.planning/', '.github/', '.claude/']) {
      assert.ok(!f.startsWith(prefix), `pack list contains ${f}`);
    }
  }
  for (const f of REQUIRED) assert.ok(packFiles.includes(f), `pack list is missing ${f}`);
});

// --- 4. no runtime state; doctor is read-only (D-20) ---

function spawnAsync(args, { cwd, env: extra }) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, env: extra, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.once('error', reject);
    child.once('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('the gate and doctor (both forms), sequentially and concurrently, write nothing and spawn no memanto', async () => {
  const ok = await startFakeApi({ mode: 'ok' });
  try {
    const fakeCli = installFakeMemanto();
    const home = env.tmpDir('memanto-home-');
    env.installBundle({ home });
    const bundle = path.join(home, '.gsd', 'capabilities', 'memanto');
    const project = env.makeProject({
      config: { memanto: { enabled: true, agent_id: 'bundle-agent', backend_url: ok.url, api_url: ok.url } },
      phaseDirs: ['01-test'],
    });
    const extra = { PATH: fakeCli.pathEnv, FAKE_MEMANTO_LOG: fakeCli.logPath };
    const spawnEnv = { ...process.env, GSD_HOME: home, GSD_WORKSTREAM: '', GSD_PROJECT: '', ...extra };
    const hooks = env.memantoHooks(env.renderHooks('discuss:pre', { cwd: project, home, env: extra }));
    assert.equal(hooks.length, 1);
    const predicate = hooks[0].check.predicate;

    const snap = () => ({
      bundle: env.snapshotTree(bundle),
      home: env.snapshotTree(home),
      project: env.snapshotTree(project),
    });
    const before = snap();

    // Sequential.
    const gate = env.checkPredicate(predicate, { cwd: project, home, env: extra, phaseDir: '.planning/phases/01-test', phaseNumber: '01' });
    assert.equal(gate.json.block, false, gate.json.message);
    const routed = env.gsd(['memanto', 'doctor', '--raw'], { cwd: project, home, env: extra });
    assert.equal(routed.status, 0, `${routed.stdout}${routed.stderr}`);
    const directRes = spawnSync(process.execPath, [path.join(bundle, 'memanto.cjs'), 'doctor', '--raw'], {
      cwd: project,
      encoding: 'utf8',
      env: spawnEnv,
    });
    assert.equal(directRes.status, 0, `${directRes.stdout}${directRes.stderr}`);
    assert.deepStrictEqual(snap(), before, 'sequential gate + doctor changed a snapshot');

    // Concurrent.
    const tools = path.join(env.coreDir(), 'bin', 'gsd-tools.cjs');
    const [g, d] = await Promise.all([
      spawnAsync(
        [tools, 'check', 'predicate', '--predicate', JSON.stringify(predicate), '--phase-dir', '.planning/phases/01-test', '--phase-number', '01', '--raw'],
        { cwd: project, env: spawnEnv },
      ),
      spawnAsync([tools, 'memanto', 'doctor', '--raw'], { cwd: project, env: spawnEnv }),
    ]);
    assert.equal(g.status, 0, g.stderr);
    assert.equal(JSON.parse(g.stdout).block, false, g.stdout);
    assert.equal(d.status, 0, `${d.stdout}${d.stderr}`);
    assert.ok(Array.isArray(JSON.parse(d.stdout).checks), d.stdout);
    assert.deepStrictEqual(snap(), before, 'concurrent gate + doctor changed a snapshot');

    assert.deepStrictEqual(fakeCli.calls(), [], 'memanto was spawned');
  } finally {
    await ok.close();
  }
});
