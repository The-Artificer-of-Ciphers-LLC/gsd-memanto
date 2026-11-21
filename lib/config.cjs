'use strict';
// In-process resolution of this project's config (D-05). Mirrors the host:
// nested own-property lookup in .planning/config.json, then the manifest
// default for declared keys. ~/.gsd/defaults.json is never read (the host does
// not consult it for capability keys). Unlike the host, a config.json that
// exists but cannot be read or parsed is reported, so the gate fails closed.

const fs = require('node:fs');
const path = require('node:path');

const MANIFEST_PATH = path.join(__dirname, '..', 'capability.json');
const UNSAFE_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function loadManifestDefaults() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const defaults = {};
  for (const [key, spec] of Object.entries(manifest.config || {})) {
    if (spec && hasOwn(spec, 'default')) defaults[key] = spec.default;
  }
  return defaults;
}

// Directories searched, most specific first. Plan 01-03 adds the
// GSD_PROJECT / GSD_WORKSTREAM directories here; nothing else changes.
function configDirs(cwd /* , env */) {
  return [path.join(cwd, '.planning')];
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

function readConfigFile(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && e.code === 'ENOENT') return { ok: true, absent: true };
    return { ok: false, path: file, error: e && e.message ? e.message : String(e), kind: 'read' };
  }
  try {
    return { ok: true, data: JSON.parse(text) };
  } catch (e) {
    return { ok: false, path: file, error: e.message, kind: 'parse' };
  }
}

function resolveConfig({ cwd, env } = {}) {
  const root = cwd || process.cwd();
  const defaults = loadManifestDefaults();
  const sources = [];
  for (const dir of configDirs(root, env || process.env)) {
    const file = path.join(dir, 'config.json');
    const res = readConfigFile(file);
    if (!res.ok) return { ok: false, path: res.path, error: res.error, kind: res.kind };
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

module.exports = { resolveConfig, loadManifestDefaults };
