// Shared Step 2 hash tree: DDA's option lists for the locality cascade, one tree
// per scheme, shared by every window and kept on disk.
//
// The step2_form link is /<scheme>/<loc>/<sector>/<pocket>/<block>/<tower>, and
// each hash comes from one of DDA's lists (step1_form's locality list, then
// searchSector, searchpocketbysector, blockbypocket, searchtowerbyblock). The
// hashes are DDA's ids, the same for every user and all day (20 Oct: one link
// used 8,334 times). So the LISTS are kept, not just one window's path: a
// window whose block differs from another's finds the shared levels here and
// asks DDA only for what is missing, and a restart or a new window needs no
// lookups at all for what was seen before.
//
//   tree[schemeId] = { touchedAt, lists: { "<level>|<parent path>": { options, at, partial } } }
//   level: loc (parent "") | sec (loc) | poc (loc/sec) | blk (loc/sec/poc) | twr (loc/sec/poc/blk)
//
// options are [{ hash, name }] as parsed by step2Resolver. A list learned from a
// page's own cascade holds only the path that page chose (partial): a preference
// that is not in a partial list is asked from DDA, never treated as missing.

import fs from 'fs';
import path from 'path';

// A scheme's tree lives this long after it was last used (a booking day plus
// spare); a link DDA refuses drops it at once (dropScheme).
export const STEP2_TREE_TTL_MS = 36 * 60 * 60 * 1000;
const MAX_SCHEMES = 20;
const MAX_OPTIONS = 400;
const SAVE_DELAY_MS = 1500;

const LEVELS = new Set(['loc', 'sec', 'poc', 'blk', 'twr']);
const HASH_RE = /^[A-Za-z0-9_-]{1,40}$/;

let filePath = '';
let tree = {};
let saveTimer = null;

const listKey = (level, parent) => `${level}|${parent || ''}`;

function cleanOptions(options) {
  if (!Array.isArray(options)) return [];
  const out = [];
  const seen = new Set();
  for (const o of options) {
    const hash = typeof o?.hash === 'string' ? o.hash.trim() : '';
    const name = typeof o?.name === 'string' ? o.name.trim().toUpperCase().slice(0, 120) : '';
    if (!HASH_RE.test(hash) || hash === '0' || !name || seen.has(hash)) continue;
    seen.add(hash);
    out.push({ hash, name });
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

function prune(now = Date.now()) {
  const ids = Object.keys(tree);
  for (const id of ids) {
    if (!tree[id] || now - (tree[id].touchedAt || 0) > STEP2_TREE_TTL_MS) delete tree[id];
  }
  const left = Object.keys(tree);
  if (left.length > MAX_SCHEMES) {
    left
      .sort((a, b) => (tree[a].touchedAt || 0) - (tree[b].touchedAt || 0))
      .slice(0, left.length - MAX_SCHEMES)
      .forEach((id) => delete tree[id]);
  }
}

function scheduleSave() {
  if (!filePath || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    saveNow();
  }, SAVE_DELAY_MS);
}

export function saveNow() {
  if (!filePath) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  try {
    prune();
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tree));
    fs.renameSync(tmp, filePath);
  } catch (err) {
    console.warn('[Step2 Tree] save failed:', err?.message || err);
  }
}

// Load the tree saved by an earlier run (an unreadable file starts empty)
export function initStep2Tree(file) {
  filePath = file;
  tree = {};
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) tree = parsed;
  } catch (_) {}
  prune();
  return summary();
}

// The list kept for this level, or null (unknown, or older than the TTL)
export function getList(schemeId, level, parent) {
  const node = tree[schemeId];
  if (!node || !LEVELS.has(level)) return null;
  const entry = node.lists?.[listKey(level, parent)];
  if (!entry || !Array.isArray(entry.options) || !entry.options.length) return null;
  if (Date.now() - (entry.at || 0) > STEP2_TREE_TTL_MS) return null;
  node.touchedAt = Date.now();
  return { options: entry.options, partial: Boolean(entry.partial) };
}

// Keep a list. A full list from DDA replaces what was there; a partial one
// (one page's chosen option) is added to it.
export function putList(schemeId, level, parent, options, { partial = false } = {}) {
  if (!HASH_RE.test(String(schemeId || '')) || !LEVELS.has(level)) return false;
  const clean = cleanOptions(options);
  if (!clean.length) return false;
  const node = (tree[schemeId] ||= { touchedAt: 0, lists: {} });
  node.lists ||= {};
  const key = listKey(level, parent);
  const prev = node.lists[key];
  let next;
  if (!partial || !prev) {
    next = { options: clean, at: Date.now(), partial };
  } else {
    const byHash = new Map(prev.options.map((o) => [o.hash, o]));
    for (const o of clean) if (!byHash.has(o.hash)) byHash.set(o.hash, o);
    next = { options: [...byHash.values()].slice(0, MAX_OPTIONS), at: Date.now(), partial: Boolean(prev.partial) };
  }
  node.lists[key] = next;
  node.touchedAt = Date.now();
  scheduleSave();
  return true;
}

// A link DDA refused: forget the scheme (the next build asks DDA again)
export function dropScheme(schemeId) {
  if (!tree[schemeId]) return false;
  delete tree[schemeId];
  scheduleSave();
  return true;
}

export function clearStep2Tree() {
  tree = {};
  scheduleSave();
}

export function summary() {
  const ids = Object.keys(tree);
  const lists = ids.reduce((n, id) => n + Object.keys(tree[id]?.lists || {}).length, 0);
  return { schemes: ids.length, lists };
}

// The interface step2Resolver uses ({ get, put } for one scheme)
export function treeFor(schemeId) {
  return {
    get: (level, parent) => getList(schemeId, level, parent),
    put: (level, parent, options, opts) => putList(schemeId, level, parent, options, opts),
  };
}

// A path a page chose through DDA's own dropdowns: each level's chosen option,
// kept as partial lists. hashes/names as in localStorage["dda_locality_hashes"].
export function putLearnedPath(schemeId, p) {
  if (!p) return 0;
  const lv = [
    ['loc', p.localityHash, p.localityName],
    ['sec', p.sectorHash, p.sectorName],
    ['poc', p.pocketHash, p.pocketName],
    ['blk', p.blockHash, p.blockName],
    ['twr', p.towerHash, p.towerName],
  ];
  const parents = [];
  let n = 0;
  for (const [level, hash, name] of lv) {
    if (!hash || hash === '0' || !name) break;
    if (putList(schemeId, level, parents.join('/'), [{ hash: String(hash), name: String(name) }], { partial: true })) n++;
    parents.push(String(hash));
  }
  return n;
}
