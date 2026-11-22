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

function kindOf(st) {
  if (st.isFIFO()) return 'a FIFO';
  if (st.isSocket()) return 'a socket';
  if (st.isCharacterDevice() || st.isBlockDevice()) return 'a device';
  if (st.isDirectory()) return 'a directory';
  return 'not a regular file';
}

function refuse(file, code, why) {
  return { ok: false, absent: false, code, reason: `${file} is unreadable: ${why}` };
}

// Returns { ok: true, text } for a regular file of at most maxBytes,
// { ok: false, absent: true, code: 'ENOENT' } when nothing is at the path, and
// { ok: false, absent: false, code, reason } for anything else. Never throws,
// never blocks.
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
      return refuse(file, (e && e.code) || 'EIO', 'it is a symlink whose target cannot be read');
    }
    what = 'a symlink to ';
  }
  if (!st.isFile()) return refuse(file, 'ENOTREG', `it is ${what}${kindOf(st)}, not a regular file`);
  if (st.size > maxBytes) return refuse(file, 'EFBIG', `it is ${st.size} bytes, more than the ${maxBytes}-byte limit`);
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK || 0);
  let fd;
  try {
    fd = fs.openSync(file, flags);
  } catch (e) {
    return refuse(file, (e && e.code) || 'EIO', e && e.message ? e.message : String(e));
  }
  try {
    const fst = fs.fstatSync(fd);
    if (!fst.isFile()) return refuse(file, 'ENOTREG', `it is ${kindOf(fst)}, not a regular file`);
    if (fst.size > maxBytes) return refuse(file, 'EFBIG', `it is ${fst.size} bytes, more than the ${maxBytes}-byte limit`);
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

module.exports = { readRegularFile, readJsonOrNull, MANIFEST_MAX_BYTES, CONFIG_MAX_BYTES, LEDGER_MAX_BYTES };
