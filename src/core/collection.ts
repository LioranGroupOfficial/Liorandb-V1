import { ClassicLevel } from "classic-level";
import { matchDocument, applyUpdate } from "./query.js";
import { v4 as uuid } from "uuid";
import { encryptData, decryptData } from "../utils/encryption.js";

export interface UpdateOptions {
  upsert?: boolean;
}

export class Collection<T = any> {
  dir: string;
  db: ClassicLevel<string, string>;
  private queue: Promise<any>;

  constructor(dir: string) {
    this.dir = dir;
    this.db = new ClassicLevel(dir);
    this.queue = Promise.resolve();
  }

  private _enqueue<R>(task: () => Promise<R>): Promise<R> {
    this.queue = this.queue.then(task).catch(console.error);
    return this.queue;
  }

  async close(): Promise<void> {
    try {
      await this.db.close();
    } catch {}
  }

  async insertOne(doc: T & { _id?: string }): Promise<T> {
    return this._enqueue(async () => {
      const _id = doc._id ?? uuid();
      const final = { _id, ...doc } as T;
      await this.db.put(String(_id), encryptData(final));
      return final;
    });
  }

  async insertMany(docs: (T & { _id?: string })[] = []): Promise<T[]> {
    return this._enqueue(async () => {
      const ops: Array<{ type: "put"; key: string; value: string }> = [];
      const out: T[] = [];

      for (const d of docs) {
        const _id = d._id ?? uuid();
        const final = { _id, ...d } as T;
        ops.push({
          type: "put",
          key: String(_id),
          value: encryptData(final)
        });
        out.push(final);
      }

      await this.db.batch(ops);
      return out;
    });
  }

  async find(query: any = {}): Promise<T[]> {
    return this._enqueue(async () => {
      const out: T[] = [];
      for await (const [, enc] of this.db.iterator()) {
        const value = decryptData(enc);
        if (matchDocument(value, query)) out.push(value);
      }
      return out;
    });
  }

  async findOne(query: any = {}): Promise<T | null> {
    return this._enqueue(async () => {
      for await (const [, enc] of this.db.iterator()) {
        const value = decryptData(enc);
        if (matchDocument(value, query)) return value;
      }
      return null;
    });
  }

  async updateOne(
    filter: any = {},
    update: any = {},
    options: UpdateOptions = { upsert: false }
  ): Promise<T | null> {
    return this._enqueue(async () => {
      for await (const [key, enc] of this.db.iterator()) {
        const value = decryptData(enc);
        if (matchDocument(value, filter)) {
          const updated = applyUpdate(value, update);
          updated._id = value._id;
          await this.db.put(key, encryptData(updated));
          return updated;
        }
      }

      if (options.upsert) {
        const doc = applyUpdate(filter, update);
        doc._id ??= uuid();
        await this.db.put(String(doc._id), encryptData(doc));
        return doc;
      }

      return null;
    });
  }

  async updateMany(filter: any = {}, update: any = {}): Promise<T[]> {
    return this._enqueue(async () => {
      const updated: T[] = [];
      for await (const [key, enc] of this.db.iterator()) {
        const value = decryptData(enc);
        if (matchDocument(value, filter)) {
          const doc = applyUpdate(value, update);
          doc._id = value._id;
          await this.db.put(key, encryptData(doc));
          updated.push(doc);
        }
      }
      return updated;
    });
  }

  async deleteOne(filter: any = {}): Promise<boolean> {
    return this._enqueue(async () => {
      for await (const [key, enc] of this.db.iterator()) {
        const value = decryptData(enc);
        if (matchDocument(value, filter)) {
          await this.db.del(key);
          return true;
        }
      }
      return false;
    });
  }

  async deleteMany(filter: any = {}): Promise<number> {
    return this._enqueue(async () => {
      let count = 0;
      for await (const [key, enc] of this.db.iterator()) {
        const value = decryptData(enc);
        if (matchDocument(value, filter)) {
          await this.db.del(key);
          count++;
        }
      }
      return count;
    });
  }

  async countDocuments(filter: any = {}): Promise<number> {
    return this._enqueue(async () => {
      let c = 0;
      for await (const [, enc] of this.db.iterator()) {
        const value = decryptData(enc);
        if (matchDocument(value, filter)) c++;
      }
      return c;
    });
  }
}
