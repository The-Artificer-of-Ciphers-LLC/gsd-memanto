'use strict';
// In-process resolution of this project's config (D-05). Mirrors the host:
// nested own-property lookup in the GSD_PROJECT / GSD_WORKSTREAM scoped
// config.json, then .planning/config.json, then the manifest default for
// declared keys. ~/.gsd/defaults.json is never read (the host does
// not consult it for capability keys). Unlike the host, a config.json that
// exists but cannot be read or parsed is reported, so the gate fails closed.

const path = require('node:path');
const { readRegularFile, MANIFEST_MAX_BYTES, CONFIG_MAX_BYTES } = require('./safe-read.cjs');

const MANIFEST_PATH = path.join(__dirname, '..', 'capability.json');
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function loadManifestDefaults() {
  const r = readRegularFile(MANIFEST_PATH, MANIFEST_MAX_BYTES);
  if (!r.ok) throw new Error(r.reason);
  const manifest = JSON.parse(r.text);
  const defaults = {};
  for (const [key, spec] of Object.entries(manifest.config || {})) {
    if (spec && hasOwn(spec, 'default')) defaults[key] = spec.default;
  }
  return defaults;
}

// Same name rule as gsd-core planning-workspace.cjs planningDir(): values are
// trimmed, blank means unset, and a path separator or '..' is rejected.
const BAD_SEGMENT = /[/\\]|\.\./;

function scopeName(env, variable) {
  const raw = env && typeof env[variable] === 'string' ? env[variable].trim() : '';
  if (!raw) return null;
  if (BAD_SEGMENT.test(raw)) {
    const err = new Error(`invalid ${variable} ${JSON.stringify(raw)}: contains a path separator or '..'`);
    err.code = 'MEMANTO_INVALID_PLANNING_NAME';
    err.variable = variable;
    throw err;
  }
  return raw;
}

function scopeNames(env) {
  return { project: scopeName(env, 'GSD_PROJECT'), workstream: scopeName(env, 'GSD_WORKSTREAM') };
}

function dirsFor(cwd, { project, workstream }) {
  const root = path.join(cwd, '.planning');
  let scoped = root;
  if (project) scoped = path.join(scoped, project);
  if (workstream) scoped = path.join(scoped, 'workstreams', workstream);
  return { root, scoped };
}

// root: <cwd>/.planning; scoped: <cwd>/.planning[/<GSD_PROJECT>][/workstreams/<GSD_WORKSTREAM>]
// (host planningDir / planningRoot). Throws MEMANTO_INVALID_PLANNING_NAME.
function planningDirs(cwd, env) {
  return dirsFor(cwd, scopeNames(env));
}

// Directories searched, most specific first. Host ladder (gsd-core 1.20.1
// planning-workspace readScopedConfigValue, #3963; pinned by
// test/config-contract.test.cjs): the scoped config, then <cwd>/.planning only
// under GSD_WORKSTREAM. GSD_PROJECT alone does not inherit the root, and
// .planning/<project>/config.json is not read under a workstream.
function configDirs(cwd, env) {
  const names = scopeNames(env);
  const { root, scoped } = dirsFor(cwd, names);
  return names.workstream ? [scoped, root] : [scoped];
}

function lookup(data, dottedKey) {
  let node = data;
  for (const segment of dottedKey.split('.')) {
    if (UNSAFE_SEGMENTS.has(segment)) return { found: false };
    if (node === null || typeof node !== 'object' || Array.isArray(node) || !hasOwn(node, segment)) {
      return { found: false };
    }
    node = node[segment];
  }
  return { found: true, value: node };
}

// Round-9 CR-01: a FIFO, device or oversized config.json is a read error
// (config-unreadable), never a blocking or unbounded read.
function readConfigFile(file) {
  const r = readRegularFile(file, CONFIG_MAX_BYTES);
  if (r.absent) return { ok: true, absent: true };
  if (!r.ok) return { ok: false, path: file, error: r.reason, kind: 'read', code: r.code };
  try {
    return { ok: true, data: JSON.parse(r.text) };
  } catch (e) {
    return { ok: false, path: file, error: e.message, kind: 'parse' };
  }
}

function resolveConfig({ cwd, env } = {}) {
  const root = cwd || process.cwd();
  const defaults = loadManifestDefaults();
  let dirs;
  try {
    dirs = configDirs(root, env || process.env);
  } catch (e) {
    if (!e || e.code !== 'MEMANTO_INVALID_PLANNING_NAME') throw e;
    // WR-03: an environment variable, not a file; path stays the variable name.
    return { ok: false, path: e.variable, variable: e.variable, error: e.message, kind: 'env' };
  }
  const sources = [];
  for (const dir of dirs) {
    const file = path.join(dir, 'config.json');
    const res = readConfigFile(file);
    if (!res.ok) return { ok: false, path: res.path, error: res.error, kind: res.kind, ...(res.code ? { code: res.code } : {}) };
    if (!res.absent) sources.push({ path: file, data: res.data });
  }
  function get(key) {
    for (const src of sources) {
      const hit = lookup(src.data, key);
      if (hit.found) return hit.value;
    }
    return hasOwn(defaults, key) ? defaults[key] : undefined;
  }
  return { ok: true, get, files: sources.map((s) => s.path) };
}

module.exports = { resolveConfig, loadManifestDefaults, planningDirs };
