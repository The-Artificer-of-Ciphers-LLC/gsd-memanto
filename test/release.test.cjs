'use strict';

// Release-metadata and documentation anti-drift checks (D-13, D-17, INST-05).
// Pure file reads: no host, no network, no memanto.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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

// --- WR-04: the release job keeps the write token off disk and pins npm ---

function workflowSteps(text) {
  // Split the job into "- " step blocks (top-level steps are indented six spaces).
  return text.split(/\n(?=      - )/).filter((b) => b.startsWith('      - '));
}

test('publish.yml checks out without persisted credentials', () => {
  const text = read('.github/workflows/publish.yml');
  const checkout = workflowSteps(text).find((b) => b.includes('uses: actions/checkout@'));
  assert.ok(checkout, 'no checkout step');
  assert.match(checkout, /persist-credentials: false/);
});

test('publish.yml hands the push credential only to the commit and tag step', () => {
  const steps = workflowSteps(read('.github/workflows/publish.yml'));
  const withPush = steps.filter((b) => /\bpush origin\b/.test(b));
  assert.equal(withPush.length, 1, 'expected exactly one step that pushes');
  assert.match(withPush[0], /name: Commit and tag the release/);
  assert.match(withPush[0], /http\.extraheader=/);
  const withHeader = steps.filter((b) => /extraheader/.test(b));
  assert.equal(withHeader.length, 1, 'the auth header must appear only in the push step');
});

test('publish.yml installs an exact npm version of at least 11.15', () => {
  const text = read('.github/workflows/publish.yml');
  const m = /npm install -g npm@(\S+)/.exec(text);
  assert.ok(m, 'no npm self-install');
  assert.match(m[1], /^\d+\.\d+\.\d+$/, `npm is not pinned exactly: ${m[1]}`);
  const [maj, min] = m[1].split('.').map(Number);
  assert.ok(maj > 11 || (maj === 11 && min >= 15), `npm ${m[1]} is older than 11.15`);
});

test('publish.yml keeps its file name and the npm-publish environment (trusted publisher binding)', () => {
  assert.match(read('.github/workflows/publish.yml'), /^\s+environment: npm-publish$/m);
});

test('LICENSE names The Artificer of Ciphers LLC', () => {
  assert.match(read('LICENSE'), /The Artificer of Ciphers LLC/);
});
