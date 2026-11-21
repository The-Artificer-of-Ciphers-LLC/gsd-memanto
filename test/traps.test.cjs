'use strict';
// INST-04: every loader trap that silently drops a capability is reproduced by a
// negative fixture against the real host, and is absent from the shipped manifest.
//
// Each trap is proven at both host layers (RESEARCH F5):
//   1. `capability install` refuses the patched bundle and names the reason;
//   2. the loader skips the same manifest when it sits in the install root
//      (for example after a hand edit or a partial upgrade) and records a
//      warning whose reason names the trap, and the capability is not registered.

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const env = require('./helpers/gsd-env.cjs');

const manifest = JSON.parse(fs.readFileSync(path.join(env.REPO_ROOT, 'capability.json'), 'utf8'));

// The first-party mempalace capability produces this artifact at plan:pre.
// Assembled once so the literal appears in one place only.
const FIRST_PARTY_RECALL = 'MEMORY-' + 'RECALL.md';
const HOST_ARTIFACTS = new Set(['CONTEXT.md', 'PLAN.md', 'SUMMARY.md', 'UAT.md']);
const RESERVED_PREFIXES = ['gsd-', 'gsd-core-', 'anthropic-'];
const HOOK_GROUPS = ['gates', 'steps', 'contributions'];

after(() => env.cleanup());

function readManifest(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'capability.json'), 'utf8'));
}

// Copy the staged release bundle into a fresh temp dir named after the patched id.
function trapBundle(mutate) {
  const src = env.stageBundle();
  const m = readManifest(src);
  mutate(m);
  const dest = path.join(env.tmpDir('memanto-trap-stage-'), m.id);
  fs.cpSync(src, dest, { recursive: true });
  fs.writeFileSync(path.join(dest, 'capability.json'), JSON.stringify(m, null, 2) + '\n');
  return { dir: dest, id: m.id };
}

function ownWarnings(registry, id) {
  const warnings = (registry._overlay && registry._overlay.warnings) || [];
  return warnings.filter((w) => w.id === id);
}

function assertInstallRefused(bundle, reason) {
  const home = env.tmpDir('memanto-trap-home-');
  const res = env.gsd(env.installArgs(bundle.dir, null, true), { home });
  let status = null;
  try {
    status = JSON.parse(res.stdout).status;
  } catch {
    // A refused install prints its reason on stderr only.
  }
  assert.notEqual(status, 'installed', `trap bundle installed: ${res.stdout}`);
  assert.notEqual(res.status, 0, 'refused install exited 0');
  assert.match(res.stderr, reason, `install refusal does not name the trap: ${res.stderr}`);
  assert.equal(fs.existsSync(path.join(home, '.gsd', 'capabilities', bundle.id)), false, 'refused install left a bundle');
}

function assertLoaderSkips(bundle, reason) {
  const home = env.tmpDir('memanto-trap-home-');
  const project = env.makeProject({ config: { memanto: { enabled: true } } });
  env.installBundle({ home });
  const capsDir = path.join(home, '.gsd', 'capabilities');
  fs.rmSync(path.join(capsDir, 'memanto'), { recursive: true, force: true });
  fs.cpSync(bundle.dir, path.join(capsDir, bundle.id), { recursive: true });
  const registry = env.loadRegistry({ home, cwd: project });
  const own = ownWarnings(registry, bundle.id);
  assert.ok(own.length > 0, `loader recorded no warning for ${bundle.id}`);
  assert.ok(
    own.some((w) => reason.test(w.reason)),
    `no loader warning for ${bundle.id} names the trap: ${JSON.stringify(own)}`,
  );
  assert.equal(Boolean(registry.capabilities[bundle.id]), false, `${bundle.id} was registered despite the trap`);
}

const TRAPS = [
  {
    name: 'a plan:pre step producing the first-party mempalace recall artifact',
    mutate: (m) => {
      m.steps = [...(m.steps || []), {
        point: 'plan:pre',
        ref: { command: 'memanto probe' },
        produces: [FIRST_PARTY_RECALL],
        consumes: [],
        onError: 'skip',
      }];
    },
    install: /duplicate-producer/,
    loader: /duplicate-producer/,
  },
  {
    name: 'a verify:post step consuming a non-host artifact',
    mutate: (m) => {
      m.steps = [...(m.steps || []), {
        point: 'verify:post',
        ref: { command: 'memanto probe' },
        produces: [],
        consumes: ['VERIFICATION.md'],
        onError: 'skip',
      }];
    },
    install: /never produced by any host artifact/,
    loader: /never produced by any host artifact/,
  },
  {
    name: 'a discuss:pre contribution into planner',
    mutate: (m) => {
      m.contributions = [...(m.contributions || []), {
        point: 'discuss:pre',
        into: 'planner',
        produces: [],
        consumes: [],
        fragment: { inline: 'trap fixture' },
      }];
    },
    install: /is not in the step's agentRoles/,
    loader: /is not in the step's agentRoles/,
  },
  {
    name: 'the gate gated on an undeclared config key',
    mutate: (m) => {
      m.gates = m.gates.map((g, i) => (i === 0 ? { ...g, when: 'memanto.nope' } : g));
    },
    install: /is not defined in capability config keys/,
    loader: /is not defined in capability config keys/,
  },
  {
    name: 'an id with the reserved gsd- prefix',
    mutate: (m) => {
      m.id = 'gsd-memanto';
    },
    install: /reserved/,
    loader: /reserved first-party prefix/,
  },
];

for (const trap of TRAPS) {
  test(`trap (install refuses): ${trap.name}`, () => {
    assertInstallRefused(trapBundle(trap.mutate), trap.install);
  });

  test(`trap (loader skips): ${trap.name}`, () => {
    assertLoaderSkips(trapBundle(trap.mutate), trap.loader);
  });
}

function hooks(m) {
  const out = [];
  for (const group of HOOK_GROUPS) for (const h of m[group] || []) out.push({ group, hook: h });
  return out;
}

test('shipped manifest: every consumes entry is a host artifact', () => {
  for (const { group, hook } of hooks(manifest)) {
    for (const c of hook.consumes || []) {
      assert.ok(HOST_ARTIFACTS.has(c), `${group} at ${hook.point} consumes non-host artifact ${c}`);
    }
  }
});

test('shipped manifest: no produces entry is the first-party mempalace recall artifact', () => {
  for (const { group, hook } of hooks(manifest)) {
    assert.ok(!(hook.produces || []).includes(FIRST_PARTY_RECALL), `${group} at ${hook.point} produces ${FIRST_PARTY_RECALL}`);
  }
});

test('shipped manifest: every when names a boolean key declared in its own config', () => {
  for (const { group, hook } of hooks(manifest)) {
    if (hook.when === undefined) continue;
    const decl = manifest.config[hook.when];
    assert.ok(decl, `${group} at ${hook.point} has when "${hook.when}" with no config declaration`);
    assert.equal(decl.type, 'boolean', `${group} at ${hook.point} when "${hook.when}" is not boolean`);
  }
});

test('shipped manifest: id and every skill stem avoid the reserved prefixes', () => {
  const stems = [...(manifest.skills || [])];
  for (const { hook } of hooks(manifest)) if (hook.ref && hook.ref.skill) stems.push(hook.ref.skill);
  for (const name of [manifest.id, ...stems]) {
    for (const prefix of RESERVED_PREFIXES) {
      assert.ok(!name.startsWith(prefix), `"${name}" uses reserved prefix ${prefix}`);
    }
  }
});

test('shipped bundle installs and loads with zero memanto warnings', () => {
  const home = env.tmpDir('memanto-home-');
  const project = env.makeProject({ config: { memanto: { enabled: true } } });
  env.installBundle({ home });
  const registry = env.loadRegistry({ home, cwd: project });
  assert.ok(registry.capabilities.memanto, 'shipped memanto did not load');
  assert.deepStrictEqual(ownWarnings(registry, 'memanto'), []);
});
