import type { Collection, FindOptions } from "../core/collection.js";
import { shardForId } from "./hash.js";

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

    // Best-effort limit/offset handling for cross-shard queries.
    const offset = Math.max(0, Math.trunc((options as any)?.offset ?? 0));
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

