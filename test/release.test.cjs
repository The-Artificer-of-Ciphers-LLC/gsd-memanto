'use strict';

// Release-metadata and documentation anti-drift checks (D-13, D-17, INST-05).
// Pure file reads: no host, no network, no memanto.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const readJson = (rel) => JSON.parse(read(rel));

const REPO = 'https://github.com/The-Artificer-of-Ciphers-LLC/gsd-memanto';

test('package.json and capability.json carry the same version', () => {
  const pkg = readJson('package.json');
  const cap = readJson('capability.json');
  assert.equal(typeof pkg.version, 'string');
  assert.equal(pkg.version, cap.version);
});

test('package.json fields match the @taoc conventions (D-13)', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.name, '@taoc/gsd-memanto');
  assert.equal(pkg.author, 'The Artificer of Ciphers LLC');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.publishConfig && pkg.publishConfig.access, 'public');
  assert.equal(pkg.repository && pkg.repository.url, `git+${REPO}.git`);
  assert.equal(pkg.bugs && pkg.bugs.url, `${REPO}/issues`);
  assert.equal(pkg.homepage, `${REPO}#readme`);
});

test('package.json declares no runtime or dev dependencies (INST-05)', () => {
  const pkg = readJson('package.json');
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const deps = pkg[key] || {};
    assert.deepEqual(Object.keys(deps), [], `${key} must be empty`);
  }
});

test('CHANGELOG.md has an "## Unreleased" section', () => {
  const lines = read('CHANGELOG.md').split(/\r?\n/);
  assert.ok(lines.includes('## Unreleased'), 'CHANGELOG.md must contain a line "## Unreleased"');
});

test('README.md documents every gate check id in CHECK_ORDER', () => {
  const { CHECK_ORDER } = require('../lib/checks.cjs');
  assert.ok(Array.isArray(CHECK_ORDER) && CHECK_ORDER.length > 1);
  const readme = read('README.md');
  const missing = CHECK_ORDER.filter((id) => !readme.includes(`\`${id}\``));
  assert.deepEqual(missing, [], 'README.md must mention each check id in backticks');
});

test('README.md documents the break-glass switch and the direct doctor form', () => {
  const readme = read('README.md');
  assert.ok(readme.includes('memanto.enabled=false'), 'break-glass text missing');
  assert.ok(readme.includes('memanto.cjs" doctor'), 'direct doctor form missing');
});

test('.npmrc pins exact versions (save-exact=true)', () => {
  const lines = read('.npmrc').split(/\r?\n/).map((l) => l.trim());
  assert.ok(lines.includes('save-exact=true'), '.npmrc must contain save-exact=true');
});

// IN-01: a files entry that does not exist would silently ship whatever later
// appears at that path, changing the bundle hash.
test('every package.json files entry exists in the repo', () => {
  const missing = readJson('package.json').files.filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepEqual(missing, [], 'package.json files lists paths that do not exist');
});

// IN-07: the "more than one test ran" check lives in tools/run-tests.cjs only;
// both workflows rely on npm test's exit code instead of re-parsing the TAP log.
test('the test-count floor is enforced once, by tools/run-tests.cjs, and the workflows run npm test', () => {
  assert.match(read('tools/run-tests.cjs'), /count <= 1/);
  for (const wf of ['.github/workflows/ci.yml', '.github/workflows/publish.yml']) {
    const text = read(wf);
    assert.match(text, /^\s+npm test\s*$/m, `${wf} does not run npm test`);
    assert.ok(!/# tests/.test(text), `${wf} re-checks the TAP test count`);
  }
});

// --- WR-04: the release job keeps the write token off disk and pins npm ---

function workflowSteps(text) {
  // Split the job into "- " step blocks (top-level steps are indented six spaces).
  return text.split(/\n(?=      - )/).filter((b) => b.startsWith('      - '));
}

test('publish.yml checks out without persisted credentials', () => {
  const text = read('.github/workflows/publish.yml');
  const checkouts = workflowSteps(text).filter((b) => b.includes('uses: actions/checkout@'));
  assert.ok(checkouts.length > 0, 'no checkout step');
  for (const c of checkouts) assert.match(c, /persist-credentials: false/);
});

const stepNamed = (steps, name) => steps.find((b) => b.includes(`name: ${name}\n`));

test('publish.yml hands the push credential only to the push step', () => {
  const steps = workflowSteps(read('.github/workflows/publish.yml'));
  const withPush = steps.filter((b) => /\bgit (?:-c (?:"[^"]*"|\S+) )*push\b/.test(b));
  assert.equal(withPush.length, 1, 'expected exactly one step that pushes');
  assert.match(withPush[0], /name: Push the release commit and tag/);
  assert.match(withPush[0], /http\.extraheader=/);
  const withHeader = steps.filter((b) => /extraheader/.test(b));
  assert.equal(withHeader.length, 1, 'the auth header must appear only in the push step');
});

// Round-2 WR-02: the Test step runs code fetched from npm, which can write
// .git/hooks, remote.origin.url or url.<x>.insteadOf. Hooks inherit the step
// environment, and the auth header goes to whatever host the remote names.
test('publish.yml pushes to an explicit github.com URL with hooks disabled', () => {
  const steps = workflowSteps(read('.github/workflows/publish.yml'));
  const push = stepNamed(steps, 'Push the release commit and tag');
  assert.ok(push, 'no push step');
  assert.ok(!/\bpush origin\b/.test(read('.github/workflows/publish.yml')), 'a step still pushes to origin');
  assert.ok(push.includes('https://github.com/${GITHUB_REPOSITORY}.git'), 'the push URL is not explicit');
  assert.match(push, /git -c core\.hooksPath=\/dev\/null [^\n]*push --no-verify /);
  assert.match(push, /GIT_CONFIG_GLOBAL=\/dev\/null/);
  assert.match(push, /GIT_CONFIG_NOSYSTEM=1/);
  // A url.<base>.insteadOf rewrite would redirect even an explicit URL.
  assert.match(push, /git config (--local )?--get-regexp/);
  assert.match(push, /insteadOf|url\\\./);
});

test('publish.yml commits and tags with hooks disabled and without the GitHub token', () => {
  const steps = workflowSteps(read('.github/workflows/publish.yml'));
  const commit = stepNamed(steps, 'Commit and tag the release');
  assert.ok(commit, 'no commit step');
  assert.ok(!commit.includes('GH_TOKEN'), 'the commit step must not hold the GitHub token');
  for (const verb of ['add', 'commit', 'tag']) {
    assert.match(commit, new RegExp(`git -c core\\.hooksPath=/dev/null [^\\n]*\\b${verb}\\b`), `git ${verb} runs with hooks enabled`);
  }
  assert.match(commit, /commit --no-verify /);
});

test('publish.yml gives GH_TOKEN only to the steps that call GitHub', () => {
  const steps = workflowSteps(read('.github/workflows/publish.yml'));
  const names = steps.filter((b) => /GH_TOKEN:/.test(b)).map((b) => /name: (.*)/.exec(b)[1]);
  assert.deepEqual(names, [
    'Require the tests to have passed on this commit',
    'Push the release commit and tag',
    'Create the GitHub Release once the version is on npm',
  ]);
  assert.ok(!/\n {4}env:\n(?: {6}.*\n)*? {6}GH_TOKEN:/.test(read('.github/workflows/publish.yml')), 'GH_TOKEN is in the job env');
});

// The key regex the push step refuses on, read from the workflow so this test
// follows any change to it.
function refusalRegex() {
  const push = stepNamed(workflowSteps(read('.github/workflows/publish.yml')), 'Push the release commit and tag');
  const m = /git config --local --get-regexp '([^']+)'/.exec(push || '');
  assert.ok(m, 'the push step has no git config --local --get-regexp refusal');
  return m[1];
}

// Hermetic: plain config files in a temp dir outside any repository, read with
// git config --file. No repository config is written.
test('the push refusal regex matches every planted redirect or credential key and no clean config', (t) => {
  const git = spawnSync('git', ['--version'], { encoding: 'utf8' });
  if (git.error) return t.skip('git is not installed');
  const regex = refusalRegex();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-gitcfg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const base = '[core]\n\trepositoryformatversion = 0\n\tbare = false\n[remote "origin"]\n\turl = https://github.com/o/r\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n[user]\n\tname = x\n';
  const planted = {
    insteadOf: '[url "https://evil.example/"]\n\tinsteadOf = https://github.com/\n',
    pushInsteadOf: '[url "https://evil.example/"]\n\tpushInsteadOf = https://github.com/\n',
    extraheader: '[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic x\n',
    proxy: '[http]\n\tproxy = http://evil.example:3128\n',
    credentialHelper: '[credential]\n\thelper = !evil\n',
    includePath: '[include]\n\tpath = /tmp/evil.config\n',
    includeIf: '[includeIf "gitdir:/"]\n\tpath = /tmp/evil.config\n',
  };
  const run = (name, body) => {
    const file = path.join(dir, `${name}.config`);
    fs.writeFileSync(file, body);
    return spawnSync('git', ['config', '--file', file, '--get-regexp', regex], { encoding: 'utf8' });
  };
  assert.equal(run('clean', base).status, 1, 'a clean checkout config must not be refused');
  for (const [name, body] of Object.entries(planted)) {
    const res = run(name, base + body);
    assert.equal(res.status, 0, `${name} was not refused: ${res.stdout}${res.stderr}`);
  }
});

// Round-2 WR-02 residual: code run by the tests must not share a runner with
// the write token or the OIDC token.
function workflowJobs(text) {
  const body = text.slice(text.indexOf('\njobs:\n') + '\njobs:\n'.length);
  const jobs = {};
  for (const block of body.split(/\n(?=  [a-z][\w-]*:\n)/)) {
    const m = /^  ([a-z][\w-]*):\n/.exec(block);
    if (m) jobs[m[1]] = block;
  }
  return jobs;
}

test('publish.yml runs the tests in a read-only job that the release job needs', () => {
  const jobs = workflowJobs(read('.github/workflows/publish.yml'));
  assert.deepEqual(Object.keys(jobs), ['test', 'release']);
  const t = jobs.test;
  assert.match(t, /^\s+npm test\s*$/m);
  assert.match(t, /\n {4}permissions:\n {6}contents: read\n {4}steps:/, 'the test job must hold contents: read only');
  assert.ok(!/id-token|contents: write|environment:|GH_TOKEN|secrets\./.test(t), 'the test job holds a credential');
  const r = jobs.release;
  assert.match(r, /\n {4}needs: test\n/);
  assert.match(r, /\n {4}environment: npm-publish\n/);
  assert.ok(!/npm test|npm pack|npm run|npm install(?! -g npm@)|node tools\/|node test\/|node scripts\//.test(r), 'the release job runs repo code');
  assert.match(r, /npm version "\$BUMP" --no-git-tag-version --ignore-scripts/);
  assert.match(r, /npm stage publish --ignore-scripts/);
});

test('the release bump rewrites the version-pinned gate reinstall hint too', (t) => {
  const bump = stepNamed(workflowSteps(read('.github/workflows/publish.yml')), 'Bump the version');
  const m = /node <<'NODE'\n([\s\S]*?)\n\s*NODE\n/.exec(bump || '');
  assert.ok(m, 'no node heredoc in the bump step');
  const script = m[1].replace(/^ {10}/gm, '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-bump-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: '@taoc/gsd-memanto', version: '9.8.7' }));
  fs.copyFileSync(path.join(ROOT, 'capability.json'), path.join(dir, 'capability.json'));
  fs.writeFileSync(path.join(dir, 'bump.cjs'), script);
  const res = spawnSync(process.execPath, ['bump.cjs'], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, res.stderr);
  const cap = JSON.parse(fs.readFileSync(path.join(dir, 'capability.json'), 'utf8'));
  assert.equal(cap.version, '9.8.7');
  const pins = JSON.stringify(cap.gates).match(/npm:@taoc\/gsd-memanto(@[^ ]*)?/g) || [];
  assert.ok(pins.length > 0);
  for (const pin of pins) assert.equal(pin, 'npm:@taoc/gsd-memanto@9.8.7');
});

test('publish.yml installs an exact npm version of at least 11.15', () => {
  const text = read('.github/workflows/publish.yml');
  const m = /npm install -g npm@(\S+)/.exec(text);
  assert.ok(m, 'no npm self-install');
  assert.match(m[1], /^\d+\.\d+\.\d+$/, `npm is not pinned exactly: ${m[1]}`);
  const [maj, min] = m[1].split('.').map(Number);
  assert.ok(maj > 11 || (maj === 11 && min >= 15), `npm ${m[1]} is older than 11.15`);
});

// IN-02: no dead job-level env variables.
test('every job-level env variable in publish.yml is read by some step', () => {
  const text = read('.github/workflows/publish.yml');
  const block = /\n {4}env:\n((?: {6}.*\n)+)/.exec(text);
  assert.ok(block, 'no job-level env block');
  const names = [...block[1].matchAll(/^ {6}([A-Z_][A-Z0-9_]*):/gm)].map((m) => m[1]);
  assert.ok(names.length > 0, 'job env block has no variables');
  const unused = names.filter((n) => !new RegExp(`\\$${n}\\b|\\$\\{${n}\\}|env\\.${n}\\b|process\\.env\\.${n}\\b`).test(text));
  assert.deepEqual(unused, []);
});

test('publish.yml keeps its file name and the npm-publish environment (trusted publisher binding)', () => {
  assert.match(read('.github/workflows/publish.yml'), /^\s+environment: npm-publish$/m);
});

test('LICENSE names The Artificer of Ciphers LLC', () => {
  assert.match(read('LICENSE'), /The Artificer of Ciphers LLC/);
});
