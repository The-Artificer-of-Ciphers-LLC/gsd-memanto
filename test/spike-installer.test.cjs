'use strict';

// Spike Q3 regression (plan 01-07, D-10): gsd-core's product installer stages the
// skill of a GLOBALLY installed third-party capability into the runtime config
// dir. Opt-in only: it runs gsd-core's real install.js, so it is gated on
// MEMANTO_SPIKE_INSTALLER=1 (set on CI by ci.yml) and on GSD_CORE_DIR pointing
// at an npm @opengsd/gsd-core layout (<pkg>/gsd-core), which is the only layout
// that ships bin/install.js. Every write goes to temp dirs: GSD_HOME, HOME and
// --config-dir are all temp, and the real ~/.claude/settings.json and
// ~/.gsd/consent.json are hashed before and after.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { REPO_ROOT, coreDir } = require('./helpers/gsd-env.cjs');

// Recorded in 01-SPIKE.md (Q3 installer run), relative to the --config-dir.
// The installer prefixes third-party skill stems with `gsd-`.
const STAGED_REL = 'skills/gsd-memanto-probe/SKILL.md';
const SKILL_BODY =
  '---\nname: memanto-probe\ndescription: Spike Q3 probe skill.\n---\n\nProbe skill body (memanto-q3-marker).\n';
const SKIP_REASON = 'set MEMANTO_SPIKE_INSTALLER=1 and point GSD_CORE_DIR at an npm @opengsd/gsd-core layout';

const CORE = coreDir();
const INSTALL_JS = path.join(path.dirname(CORE), 'bin', 'install.js');
const GSD_TOOLS = path.join(CORE, 'bin', 'gsd-tools.cjs');
const enabled = process.env.MEMANTO_SPIKE_INSTALLER === '1' && fs.existsSync(INSTALL_JS);

function stamp(file) {
  if (!fs.existsSync(file)) return 'absent';
  const st = fs.statSync(file);
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return `${sha} ${st.size} ${st.mtimeMs}`;
}

function writeProbe(root) {
  const dir = path.join(root, 'memanto');
  fs.mkdirSync(path.join(dir, 'skills', 'memanto-probe'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'capability.json'),
    JSON.stringify(
      {
        id: 'memanto',
        role: 'feature',
        title: 'Memanto Q3 probe',
        description: 'Spike Q3 probe: does the installer stage a global third-party skill?',
        version: '0.0.1',
        tier: 'full',
        requires: [],
        engines: { gsd: '>=1.20.1 <2.0.0' },
        runtimeCompat: { supported: ['*'], unsupported: [] },
        skills: ['memanto-probe'],
        agents: [],
        config: {},
        steps: [],
        contributions: [],
        gates: [],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, 'skills', 'memanto-probe', 'SKILL.md'), SKILL_BODY);
  return dir;
}

test('Q3 installer: 01-SPIKE.md records the staged skill path this test asserts', () => {
  const spike = fs.readFileSync(
    path.join(REPO_ROOT, '.planning', 'phases', '01-walking-skeleton', '01-SPIKE.md'),
    'utf8',
  );
  // Whole `## Q3` section, including its `### Q3 installer run` subsection
  // (a plain split on '## Q3' would also cut at the '### Q3' heading).
  const start = spike.indexOf('\n## Q3');
  assert.ok(start >= 0, '01-SPIKE.md has no "## Q3" section');
  const next = spike.indexOf('\n## ', start + 1);
  const q3 = spike.slice(start, next < 0 ? undefined : next);
  assert.match(q3, /Answer:\s*POSITIVE/);
  assert.ok(q3.includes(STAGED_REL), `01-SPIKE.md Q3 does not record ${STAGED_REL}`);
});

test(
  'Q3 installer: install.js --claude --global stages a global capability skill into the config dir',
  { skip: enabled ? false : SKIP_REASON, timeout: 300_000 },
  (t) => {
    const realHome = os.homedir();
    const guarded = [
      path.join(realHome, '.claude', 'settings.json'),
      path.join(realHome, '.gsd', 'consent.json'),
    ];
    const before = guarded.map(stamp);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'memanto-q3-installer-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const gsdHome = path.join(root, 'home');
    const fakeHome = path.join(root, 'user-home');
    const configDir = path.join(root, 'claude-config');
    const cwd = path.join(root, 'cwd');
    for (const d of [gsdHome, fakeHome, cwd]) fs.mkdirSync(d, { recursive: true });
    const probe = writeProbe(path.join(root, 'probe'));

    const childEnv = { ...process.env, GSD_HOME: gsdHome, HOME: fakeHome };
    delete childEnv.CLAUDE_CONFIG_DIR;
    const run = (args) =>
      spawnSync(process.execPath, args, { cwd, env: childEnv, encoding: 'utf8', timeout: 240_000, input: '' });

    const inst = run([GSD_TOOLS, 'capability', 'install', probe, '--yes']);
    assert.equal(inst.status, 0, `capability install failed:\n${inst.stdout}\n${inst.stderr}`);
    assert.equal(JSON.parse(inst.stdout).scope, 'global');

    const res = run([INSTALL_JS, '--claude', '--global', '--config-dir', configDir]);
    assert.equal(res.status, 0, `install.js failed:\n${res.stdout}\n${res.stderr}`);

    const staged = path.join(configDir, STAGED_REL);
    assert.ok(fs.existsSync(staged), `expected staged skill at ${staged}`);
    assert.equal(fs.readFileSync(staged, 'utf8'), SKILL_BODY);

    assert.deepEqual(guarded.map(stamp), before, 'real ~/.claude/settings.json or ~/.gsd/consent.json changed');
  },
);
