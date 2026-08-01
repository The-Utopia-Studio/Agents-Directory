// File-backed collection store. Async, with an in-memory cache and a
// per-collection write queue so concurrent writes can't corrupt a file.
//
// This is the persistence SEAM: the routes and adapters only touch this
// interface (all / get / put / query / append). Swapping to Postgres or
// Supabase at scale means reimplementing this one module — nothing above it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const IMMUTABLE_COLLECTIONS = Object.freeze([
  "traces",
  "feedback",
  "loopRuns",
  "learnings",
]);

export function createStore(dataDir) {
  const cache = new Map();       // collection -> Map(id -> doc)
  const writeQueues = new Map(); // collection -> Promise chain
  let ready = null;

  async function init() {
    await mkdir(dataDir, { recursive: true });
  }

  function file(coll) { return join(dataDir, `${coll}.json`); }

  async function load(coll) {
    if (cache.has(coll)) return cache.get(coll);
    let docs = [];
    try { docs = JSON.parse(await readFile(file(coll), "utf8")); } catch { /* new */ }
    const map = new Map(docs.map((d) => [d.id, d]));
    cache.set(coll, map);
    return map;
  }

  function flush(coll) {
    const map = cache.get(coll) || new Map();
    const prev = writeQueues.get(coll) || Promise.resolve();
    const next = prev
      .catch(() => {})
      .then(() => writeFile(file(coll), JSON.stringify([...map.values()], null, 2)));
    writeQueues.set(coll, next);
    return next;
  }

  // Clone on the boundary so callers can never mutate the cache by holding a
  // reference — the same isolation a DB-backed store gives you (read a copy,
  // write it back). Keeps the persistence seam swappable without surprises.
  const clone = (v) => (v == null ? v : structuredClone(v));

  return {
    async ready() { return (ready ??= init()); },

    async all(coll) { return [...(await load(coll)).values()].map(clone); },

    async get(coll, id) { return clone((await load(coll)).get(id) || null); },

    async put(coll, doc) {
      const map = await load(coll);
      const stored = clone(doc);
      if (IMMUTABLE_COLLECTIONS.includes(coll) && map.has(stored.id)) {
        throw new Error(
          `${coll} records are immutable; cannot replace ${stored.id}`,
        );
      }
      map.set(stored.id, stored);
      await flush(coll);
      return clone(stored);
    },

    /** Append a doc, assigning a sortable id if none given. */
    async append(coll, doc) {
      const id = doc.id || `${coll}_${Date.now().toString(36)}_${Math.round(Math.random() * 1e6).toString(36)}`;
      return this.put(coll, { ...doc, id });
    },

    async query(coll, predicate) {
      return (await this.all(coll)).filter(predicate);
    },

    /** Seed a collection only if it's currently empty (idempotent). */
    async seedIfEmpty(coll, docs) {
      const map = await load(coll);
      if (map.size) return false;
      for (const d of docs) map.set(d.id, clone(d));
      await flush(coll);
      return true;
    },
  };
}
