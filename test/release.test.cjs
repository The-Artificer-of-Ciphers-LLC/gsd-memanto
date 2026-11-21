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

test('LICENSE names The Artificer of Ciphers LLC', () => {
  assert.match(read('LICENSE'), /The Artificer of Ciphers LLC/);
});
