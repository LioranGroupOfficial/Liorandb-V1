import type { Collection, FindOptions } from "../core/collection.js";
import { shardForId } from "./hash.js";

function getByPath(obj: any, path: string): any {
  if (!path) return undefined;
  const parts = path.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function isExactIdFilter(filter: any): { ok: true; id: any } | { ok: false } {
  if (!filter || typeof filter !== "object") return { ok: false };
  if (Object.prototype.hasOwnProperty.call(filter, "_id")) {
    const v = (filter as any)._id;
    if (v && typeof v === "object" && "$in" in v) return { ok: false };
    return { ok: true, id: v };
  }
  return { ok: false };
}

export class ShardedCollection<T = any> {
  constructor(
    private physical: (shard: number) => Collection<T>,
    private shardCount: number
  ) {}

  private shardFor(docOrId: any) {
    return shardForId(docOrId, this.shardCount);
  }

  async insertOne(doc: any) {
    const sid = doc?._id !== undefined ? this.shardFor(doc._id) : 0;
    return await (this.physical(sid) as any).insertOne(doc);
  }

  async insertMany(docs: any[], options?: any) {
    const buckets = new Map<number, any[]>();
    for (const d of docs ?? []) {
      const sid = d?._id !== undefined ? this.shardFor(d._id) : 0;
      const arr = buckets.get(sid) ?? [];
      arr.push(d);
      buckets.set(sid, arr);
    }

    const out: any[] = [];
    const shards = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
    for (const [sid, chunk] of shards) {
      const inserted = await (this.physical(sid) as any).insertMany(chunk, options);
      out.push(...inserted);
    }
    return out;
  }

  async findOne(query: any = {}, options?: any) {
    const idFilter = isExactIdFilter(query);
    if (idFilter.ok) {
      const sid = this.shardFor(idFilter.id);
      return await (this.physical(sid) as any).findOne(query, options);
    }

    const sort = options?.sort && typeof options.sort === "object" && !Array.isArray(options.sort)
      ? Object.entries(options.sort).find(([, dir]) => dir === 1 || dir === -1)
      : undefined;
    if (sort) {
      const all = await this.find(query, { ...(options ?? {}), limit: Number.POSITIVE_INFINITY });
      return (all as any[])[0] ?? null;
    }

    for (let sid = 0; sid < this.shardCount; sid++) {
      const found = await (this.physical(sid) as any).findOne(query, options);
      if (found) return found;
    }
    return null;
  }

  async find(query: any = {}, options?: FindOptions) {
    const idFilter = isExactIdFilter(query);
    if (idFilter.ok) {
      const sid = this.shardFor(idFilter.id);
      return await (this.physical(sid) as any).find(query, options);
    }

    const all: any[] = [];
    for (let sid = 0; sid < this.shardCount; sid++) {
      const part = await (this.physical(sid) as any).find(query, options);
      if (Array.isArray(part)) all.push(...part);
      else if (part?.results && Array.isArray(part.results)) all.push(...part.results);
    }

    const sort = (options as any)?.sort && typeof (options as any).sort === "object" && !Array.isArray((options as any).sort)
      ? Object.entries((options as any).sort).find(([, dir]) => dir === 1 || dir === -1)
      : undefined;
    if (sort) {
      const [field, dir0] = sort as [string, 1 | -1];
      const dir = dir0 === -1 ? -1 : 1;
      all.sort((a, b) => {
        const av = getByPath(a, field);
        const bv = getByPath(b, field);
        if (av === bv) {
          const aid = String(a?._id ?? "");
          const bid = String(b?._id ?? "");
          return aid < bid ? -1 : aid > bid ? 1 : 0;
        }
        if (av === undefined) return 1;
        if (bv === undefined) return -1;
        if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
        const as = typeof av === "string" ? av : JSON.stringify(av);
        const bs = typeof bv === "string" ? bv : JSON.stringify(bv);
        if (as === bs) return 0;
        return (as < bs ? -1 : 1) * dir;
      });
    }

    // Best-effort limit/offset handling for cross-shard queries.
    const offset = Math.max(0, Math.trunc((options as any)?.offset ?? (options as any)?.skip ?? 0));
    const limit = (options as any)?.limit !== undefined ? Math.max(0, Math.trunc((options as any).limit)) : undefined;
    const sliced = limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit);
    return sliced;
  }

  async updateOne(filter: any, update: any, options?: any) {
    const idFilter = isExactIdFilter(filter);
    if (idFilter.ok) {
      const sid = this.shardFor(idFilter.id);
      return await (this.physical(sid) as any).updateOne(filter, update, options);
    }
    // Cross-shard: first match wins.
    for (let sid = 0; sid < this.shardCount; sid++) {
      const res = await (this.physical(sid) as any).updateOne(filter, update, options);
      if (res) return res;
    }
    return null;
  }

  async deleteOne(filter: any) {
    const idFilter = isExactIdFilter(filter);
    if (idFilter.ok) {
      const sid = this.shardFor(idFilter.id);
      return await (this.physical(sid) as any).deleteOne(filter);
    }
    for (let sid = 0; sid < this.shardCount; sid++) {
      const ok = await (this.physical(sid) as any).deleteOne(filter);
      if (ok) return ok;
    }
    return false;
  }
}
