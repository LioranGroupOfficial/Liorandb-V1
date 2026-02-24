import { ClassicLevel } from "classic-level";
import { matchDocument, applyUpdate, extractIndexQuery } from "./query.js";
import { v4 as uuid } from "uuid";
import { encryptData, decryptData } from "../utils/encryption.js";
import type { ZodSchema } from "zod";
import { validateSchema } from "../utils/schema.js";
import { Index } from "./index.js";

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

  /* --------------------- PUBLIC API --------------------- */

  insertOne(doc: T & { _id?: string }) {
    return this._enqueue(() => this._exec("insertOne", [doc]));
  }

  insertMany(docs: (T & { _id?: string })[] = []) {
    return this._enqueue(() => this._exec("insertMany", [docs]));
  }

  find(query: any = {}) {
    return this._enqueue(() => this._exec("find", [query]));
  }

  findOne(query: any = {}) {
    return this._enqueue(() => this._exec("findOne", [query]));
  }

  updateOne(filter: any, update: any, options: UpdateOptions = {}) {
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

  private async _findOne(query: any) {
    if (query?._id) {
      try {
        const enc = await this.db.get(String(query._id));
        return enc ? decryptData(enc) : null;
      } catch { return null; }
    }

    const iq = extractIndexQuery(query);
    if (iq && this.indexes.has(iq.field)) {
      const ids = await this.indexes.get(iq.field)!.find(iq.value);
      if (!ids.length) return null;

      try {
        const enc = await this.db.get(ids[0]);
        return enc ? decryptData(enc) : null;
      } catch {
        return null;
      }
    }

    for await (const [, enc] of this.db.iterator()) {
      const v = decryptData(enc);
      if (matchDocument(v, query)) return v;
    }

    return null;
  }

  private async _updateOne(filter: any, update: any, options: UpdateOptions) {
    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        const updated = this.validate(applyUpdate(value, update)) as any;
        updated._id = value._id;

        await this.db.put(key, encryptData(updated));
        await this._updateIndexes(value, updated);

        return updated;
      }
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
    const out = [];

    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        const updated = this.validate(applyUpdate(value, update)) as any;
        updated._id = value._id;

        await this.db.put(key, encryptData(updated));
        await this._updateIndexes(value, updated);

        out.push(updated);
      }
    }

    return out;
  }

  private async _find(query: any) {
    const iq = extractIndexQuery(query);

    if (iq && this.indexes.has(iq.field)) {
      const ids = await this.indexes.get(iq.field)!.find(iq.value);
      const out = [];

      for (const id of ids) {
        try {
          const enc = await this.db.get(id);
          if (enc) out.push(decryptData(enc));
        } catch {}
      }

      return out;
    }

    const out = [];
    for await (const [, enc] of this.db.iterator()) {
      const v = decryptData(enc);
      if (matchDocument(v, query)) out.push(v);
    }

    return out;
  }

  private async _deleteOne(filter: any) {
    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        await this.db.del(key);
        await this._updateIndexes(value, null);
        return true;
      }
    }
    return false;
  }

  private async _deleteMany(filter: any) {
    let count = 0;

    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        await this.db.del(key);
        await this._updateIndexes(value, null);
        count++;
      }
    }

    return count;
  }

  private async _countDocuments(filter: any) {
    let c = 0;

    const iq = extractIndexQuery(filter);
    if (iq && this.indexes.has(iq.field)) {
      return (await this.indexes.get(iq.field)!.find(iq.value)).length;
    }

    for await (const [, enc] of this.db.iterator()) {
      if (matchDocument(decryptData(enc), filter)) c++;
    }

    return c;
  }
}