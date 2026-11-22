'use strict';
// Round-9 CR-01: the one reader for every file doctor and the gate's lib code
// read from a project or capability directory (capability.json, the capability
// ledger, .planning/config.json). A cloned repository controls the project
// files, so a plain fs.readFileSync is not safe: a FIFO blocks forever with no
// writer, and a device or an oversized file is read without a bound.
//
// The protocol follows gsd-core's readSmallRegularFile (capability-ledger.cjs,
// #1459 finding 2), with an lstat first so the reason can name what the path is:
//   1. lstatSync(path): missing -> absent. A FIFO, socket, device or directory
//      is refused. A symlink is followed once with statSync and refused unless
//      its target is a regular file (gsd-core follows symlinks the same way).
//   2. the size from that stat must be at most maxBytes.
//   3. openSync(O_RDONLY | O_NONBLOCK) never blocks, even when the path was
//      swapped for a FIFO after step 1; fstatSync on the open fd re-checks the
//      type and size of what is actually read.
//   4. exactly that many bytes are read, then the fd is closed.

const fs = require('node:fs');

const MiB = 1024 * 1024;
// capability.json and config.json are a few KiB of JSON. gsd-core accepts a
// capability.json of up to 8 MiB; doctor is stricter and calls a larger one
// unreadable, which only ever fails closed.
const MANIFEST_MAX_BYTES = 1 * MiB;
const CONFIG_MAX_BYTES = MANIFEST_MAX_BYTES;
// A scope ledger lists every capability in the scope: gsd-core's own cap
// (capability-loader.cjs LEDGER_MAX_BYTES).
const LEDGER_MAX_BYTES = 8 * MiB;

// The file type of a non-regular stat, as 'fifo' | 'socket' | 'device' | 'directory' | 'other'.
function typeOf(st) {
  if (st.isFIFO()) return 'fifo';
  if (st.isSocket()) return 'socket';
  if (st.isCharacterDevice() || st.isBlockDevice()) return 'device';
  if (st.isDirectory()) return 'directory';
  return 'other';
}

const TYPE_TEXT = { fifo: 'a FIFO', socket: 'a socket', device: 'a device', directory: 'a directory', other: 'not a regular file' };

// what: the thing at the path, for a remedy ("a FIFO", "a symlink to a device").
function refuse(file, code, why, extra = {}) {
  return { ok: false, absent: false, code, reason: `${file} is unreadable: ${why}`, what: why, ...extra };
}

const notRegular = (file, st, via) =>
  refuse(file, 'ENOTREG', `it is ${via}${TYPE_TEXT[typeOf(st)]}, not a regular file`, { what: `${via}${TYPE_TEXT[typeOf(st)]}`, type: typeOf(st), symlink: Boolean(via) });
const tooBig = (file, size, maxBytes) => refuse(file, 'EFBIG', `it is ${size} bytes, more than the ${maxBytes}-byte limit`, { what: `${size} bytes, more than the ${maxBytes}-byte limit`, size });

// Returns { ok: true, text } for a regular file of at most maxBytes,
// { ok: false, absent: true, code: 'ENOENT' } when nothing is at the path, and
// { ok: false, absent: false, code, reason, what } for anything else. A
// non-regular file has code ENOTREG, a type (typeOf) and symlink: true when it
// was reached through a symlink; a symlink whose target cannot be stat()ed has
// symlink: true too. Never throws, never blocks.
function readRegularFile(file, maxBytes) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (e) {
    // Only ENOENT is "absent", as in gsd-core; ENOTDIR (a parent is a file) is refused.
    if (e && e.code === 'ENOENT') return { ok: false, absent: true, code: 'ENOENT', reason: `${file} does not exist` };
    return refuse(file, (e && e.code) || 'EIO', e && e.message ? e.message : String(e));
  }
  let what = '';
  if (st.isSymbolicLink()) {
    try {
      st = fs.statSync(file);
    } catch (e) {
      return refuse(file, (e && e.code) || 'EIO', 'it is a symlink whose target cannot be read', { what: 'a symlink whose target cannot be read', symlink: true });
    }
    what = 'a symlink to ';
  }
  if (!st.isFile()) return notRegular(file, st, what);
  if (st.size > maxBytes) return tooBig(file, st.size, maxBytes);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
  let fd;
  try {
    fd = fs.openSync(file, flags);
  } catch (e) {
    return refuse(file, (e && e.code) || 'EIO', e && e.message ? e.message : String(e));
  }
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile()) return notRegular(file, fst, '');
    if (fst.size > maxBytes) return tooBig(file, fst.size, maxBytes);
    const buf = Buffer.alloc(fst.size);
    let got = 0;
    while (got < buf.length) {
      const n = fs.readSync(fd, buf, got, buf.length - got, got);
      if (n === 0) break;
      got += n;
    }
    return { ok: true, absent: false, text: buf.subarray(0, got).toString('utf8') };
  } catch (e) {
    return refuse(file, (e && e.code) || 'EIO', e && e.message ? e.message : String(e));
  } finally {
    fs.closeSync(fd);
  }
}

// Round-10 IN-01: whether a plain blocking read of the whole file would block
// or never end. gsd-core reads .planning/config.json that way (verified against
// the 1.20.1 host: a FIFO and /dev/zero block capability list and render-hooks;
// a directory, a socket and /dev/null fail or end at once). Returns 'fifo' (it
// blocks until a writer opens it), 'device' (a device with no data yet, or
// more than maxBytes of it, as /dev/zero), or null. A device is probed with a
// non-blocking read of at most maxBytes + 1 bytes; nothing else is read.
function plainReadBlocks(file, maxBytes) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  if (st.isFIFO()) return 'fifo';
  if (!st.isCharacterDevice() && !st.isBlockDevice()) return null;
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0));
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(64 * 1024);
    let total = 0;
    while (total <= maxBytes) {
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) return null;
      total += n;
    }
    return 'device';
  } catch (e) {
    return e && e.code === 'EAGAIN' ? 'device' : null;
  } finally {
    fs.closeSync(fd);
  }
}

// The parsed JSON of a regular file, or null (missing, unreadable or invalid).
function readJsonOrNull(file, maxBytes) {
  const r = readRegularFile(file, maxBytes);
  if (!r.ok) return null;
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}

module.exports = { readRegularFile, readJsonOrNull, plainReadBlocks, MANIFEST_MAX_BYTES, CONFIG_MAX_BYTES, LEDGER_MAX_BYTES };
