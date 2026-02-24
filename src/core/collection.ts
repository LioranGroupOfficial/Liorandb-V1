import { ClassicLevel } from "classic-level";
import {
  matchDocument,
  applyUpdate,
  runIndexedQuery
} from "./query.js";
import { v4 as uuid } from "uuid";
import { encryptData, decryptData } from "../utils/encryption.js";
import type { ZodSchema } from "zod";
import { validateSchema } from "../utils/schema.js";
import { Index } from "./index.js";
import { compactCollectionEngine, rebuildIndexes } from "./compaction.js";

export interface UpdateOptions {
  upsert?: boolean;
}

export class Collection<T = any> {
  dir: string;
  db: ClassicLevel<string, string>;
  private queue: Promise<any> = Promise.resolve();
  private schema?: ZodSchema<T>;
  private indexes = new Map<string, Index>();

  constructor(dir: string, schema?: ZodSchema<T>) {
    this.dir = dir;
    this.db = new ClassicLevel(dir, { valueEncoding: "utf8" });
    this.schema = schema;
  }

  /* ---------------------- INDEX MANAGEMENT ---------------------- */

  registerIndex(index: Index) {
    this.indexes.set(index.field, index);
  }

  getIndex(field: string) {
    return this.indexes.get(field);
  }

  /* -------------------------- CORE -------------------------- */

  setSchema(schema: ZodSchema<T>) {
    this.schema = schema;
  }

  private validate(doc: any): T {
    return this.schema ? validateSchema(this.schema, doc) : doc;
  }

  private _enqueue<R>(task: () => Promise<R>): Promise<R> {
    this.queue = this.queue.then(task).catch(console.error);
    return this.queue;
  }

  async close(): Promise<void> {
    for (const idx of this.indexes.values()) {
      try { await idx.close(); } catch {}
    }
    try { await this.db.close(); } catch {}
  }

  /* -------------------- COMPACTION ENGINE -------------------- */

  async compact(): Promise<void> {
    return this._enqueue(async () => {
      // Close active DB handles
      try { await this.db.close(); } catch {}

      // Run compaction engine
      await compactCollectionEngine(this);

      // Reopen fresh DB
      this.db = new ClassicLevel(this.dir, { valueEncoding: "utf8" });

      // Rebuild indexes
      await rebuildIndexes(this);
    });
  }

  async _exec(op: string, args: any[]) {
    switch (op) {
      case "insertOne": return this._insertOne(args[0]);
      case "insertMany": return this._insertMany(args[0]);
      case "find": return this._find(args[0]);
      case "findOne": return this._findOne(args[0]);
      case "updateOne": return this._updateOne(args[0], args[1], args[2]);
      case "updateMany": return this._updateMany(args[0], args[1]);
      case "deleteOne": return this._deleteOne(args[0]);
      case "deleteMany": return this._deleteMany(args[0]);
      case "countDocuments": return this._countDocuments(args[0]);
      default: throw new Error(`Unknown operation: ${op}`);
    }
  }

  /* ------------------ INDEX HOOK ------------------ */

  private async _updateIndexes(oldDoc: any, newDoc: any) {
    for (const index of this.indexes.values()) {
      await index.update(oldDoc, newDoc);
    }
  }

  /* ---------------- Storage ---------------- */

  private async _insertOne(doc: any) {
    const _id = doc._id ?? uuid();
    const final = this.validate({ _id, ...doc });

    await this.db.put(String(_id), encryptData(final));
    await this._updateIndexes(null, final);

    return final;
  }

  private async _insertMany(docs: any[]) {
    const batch: Array<{ type: "put"; key: string; value: string }> = [];
    const out = [];

    for (const d of docs) {
      const _id = d._id ?? uuid();
      const final = this.validate({ _id, ...d });

      batch.push({
        type: "put",
        key: String(_id),
        value: encryptData(final)
      });

      out.push(final);
    }

    await this.db.batch(batch);

    for (const doc of out) {
      await this._updateIndexes(null, doc);
    }

    return out;
  }

  /* ---------------- QUERY ENGINE (INDEXED) ---------------- */

  private async _getCandidateIds(query: any): Promise<Set<string>> {
    const indexedFields = new Set(this.indexes.keys());

    return runIndexedQuery(
      query,
      {
        indexes: indexedFields,

        findByIndex: async (field, value) => {
          const idx = this.indexes.get(field);
          if (!idx) return null;
          return new Set(await idx.find(value));
        }
      },
      async () => {
        const ids: string[] = [];
        for await (const [key] of this.db.iterator()) {
          ids.push(key);
        }
        return ids;
      }
    );
  }

  private async _find(query: any) {
    const ids = await this._getCandidateIds(query);
    const out = [];

    for (const id of ids) {
      try {
        const enc = await this.db.get(id);
        if (!enc) continue;

        const doc = decryptData(enc);
        if (matchDocument(doc, query)) out.push(doc);
      } catch {}
    }

    return out;
  }

  private async _findOne(query: any) {
    if (query?._id) {
      try {
        const enc = await this.db.get(String(query._id));
        return enc ? decryptData(enc) : null;
      } catch { return null; }
    }

    const ids = await this._getCandidateIds(query);

    for (const id of ids) {
      try {
        const enc = await this.db.get(id);
        if (!enc) continue;

        const doc = decryptData(enc);
        if (matchDocument(doc, query)) return doc;
      } catch {}
    }

    return null;
  }

  private async _countDocuments(filter: any) {
    const ids = await this._getCandidateIds(filter);
    let count = 0;

    for (const id of ids) {
      try {
        const enc = await this.db.get(id);
        if (!enc) continue;

        if (matchDocument(decryptData(enc), filter)) count++;
      } catch {}
    }

    return count;
  }

  /* ---------------- UPDATE ---------------- */

  private async _updateOne(filter: any, update: any, options: UpdateOptions) {
    const ids = await this._getCandidateIds(filter);

    for (const id of ids) {
      try {
        const enc = await this.db.get(id);
        if (!enc) continue;

        const value = decryptData(enc);

        if (matchDocument(value, filter)) {
          const updated = this.validate(applyUpdate(value, update)) as any;
          updated._id = value._id;

          await this.db.put(id, encryptData(updated));
          await this._updateIndexes(value, updated);

          return updated;
        }
      } catch {}
    }

    if (options?.upsert) {
      const doc = this.validate({
        _id: uuid(),
        ...applyUpdate({}, update)
      }) as any;

      await this.db.put(String(doc._id), encryptData(doc));
      await this._updateIndexes(null, doc);

      return doc;
    }

    return null;
  }

  private async _updateMany(filter: any, update: any) {
    const ids = await this._getCandidateIds(filter);
    const out = [];

    for (const id of ids) {
      try {
        const enc = await this.db.get(id);
        if (!enc) continue;

        const value = decryptData(enc);

        if (matchDocument(value, filter)) {
          const updated = this.validate(applyUpdate(value, update)) as any;
          updated._id = value._id;

          await this.db.put(id, encryptData(updated));
          await this._updateIndexes(value, updated);

          out.push(updated);
        }
      } catch {}
    }

    return out;
  }

  /* ---------------- DELETE ---------------- */

  private async _deleteOne(filter: any) {
    const ids = await this._getCandidateIds(filter);

    for (const id of ids) {
      try {
        const enc = await this.db.get(id);
        if (!enc) continue;

        const value = decryptData(enc);

        if (matchDocument(value, filter)) {
          await this.db.del(id);
          await this._updateIndexes(value, null);
          return true;
        }
      } catch {}
    }

    return false;
  }

  private async _deleteMany(filter: any) {
    const ids = await this._getCandidateIds(filter);
    let count = 0;

    for (const id of ids) {
      try {
        const enc = await this.db.get(id);
        if (!enc) continue;

        const value = decryptData(enc);

        if (matchDocument(value, filter)) {
          await this.db.del(id);
          await this._updateIndexes(value, null);
          count++;
        }
      } catch {}
    }

    return count;
  }

  /* ---------------- PUBLIC API (Mongo-style) ---------------- */

  insertOne(doc: any) {
    return this._enqueue(() => this._exec("insertOne", [doc]));
  }

  insertMany(docs: any[]) {
    return this._enqueue(() => this._exec("insertMany", [docs]));
  }

  find(query: any = {}) {
    return this._enqueue(() => this._exec("find", [query]));
  }

  findOne(query: any = {}) {
    return this._enqueue(() => this._exec("findOne", [query]));
  }

  updateOne(filter: any, update: any, options?: UpdateOptions) {
    return this._enqueue(() =>
      this._exec("updateOne", [filter, update, options])
    );
  }

  updateMany(filter: any, update: any) {
    return this._enqueue(() =>
      this._exec("updateMany", [filter, update])
    );
  }

  deleteOne(filter: any) {
    return this._enqueue(() =>
      this._exec("deleteOne", [filter])
    );
  }

  deleteMany(filter: any) {
    return this._enqueue(() =>
      this._exec("deleteMany", [filter])
    );
  }

  countDocuments(filter: any = {}) {
    return this._enqueue(() =>
      this._exec("countDocuments", [filter])
    );
  }
}