import fs from "fs";
import path from "path";
import { ClassicLevel } from "classic-level";
import { matchDocument, applyUpdate } from "./query.js";
import { v4 as uuid } from "uuid";
import { encryptData, decryptData } from "../utils/encryption.js";
import type { ZodSchema } from "zod";
import { validateSchema } from "../utils/schema.js";

export interface UpdateOptions {
  upsert?: boolean;
}

export class Collection<T = any> {
  dir: string;
  db: ClassicLevel<string, string>;
  private queue: Promise<any>;
  private walPath: string;
  private schema?: ZodSchema<T>;

  constructor(dir: string, schema?: ZodSchema<T>) {
    this.dir = dir;
    this.db = new ClassicLevel(dir);
    this.queue = Promise.resolve();
    this.walPath = path.join(dir, "__wal.log");
    this.schema = schema;

    this.recoverFromWAL().catch(console.error);
  }

  setSchema(schema: ZodSchema<T>) {
    this.schema = schema;
  }

  private validate(doc: any): T {
    return this.schema ? validateSchema(this.schema, doc) : doc;
  }

  /* ---------------- WAL ---------------- */

  private async writeWAL(entry: any) {
    await fs.promises.appendFile(
      this.walPath,
      JSON.stringify(entry) + "\n"
    );
  }

  private async clearWAL() {
    if (fs.existsSync(this.walPath)) {
      await fs.promises.unlink(this.walPath);
    }
  }

  private async recoverFromWAL() {
    if (!fs.existsSync(this.walPath)) return;

    const lines = (await fs.promises.readFile(this.walPath, "utf8"))
      .split("\n")
      .filter(Boolean);

    for (const line of lines) {
      try {
        const { op, args } = JSON.parse(line);
        await this._exec(op, args, false);
      } catch (err) {
        console.error("WAL recovery failed:", err);
      }
    }

    await this.clearWAL();
  }

  /* ---------------- Queue ---------------- */

  private _enqueue<R>(task: () => Promise<R>): Promise<R> {
    this.queue = this.queue.then(task).catch(console.error);
    return this.queue;
  }

  /* ---------------- Core Executor ---------------- */

  private async _exec(op: string, args: any[], log = true) {
    if (log) await this.writeWAL({ op, args });

    let result: any;

    switch (op) {
      case "insertOne":
        result = await this._insertOne(args[0]);
        break;

      case "insertMany":
        result = await this._insertMany(args[0]);
        break;

      case "find":
        result = await this._find(args[0]);
        break;

      case "findOne":
        result = await this._findOne(args[0]);
        break;

      case "updateOne":
        result = await this._updateOne(args[0], args[1], args[2]);
        break;

      case "updateMany":
        result = await this._updateMany(args[0], args[1]);
        break;

      case "deleteOne":
        result = await this._deleteOne(args[0]);
        break;

      case "deleteMany":
        result = await this._deleteMany(args[0]);
        break;

      case "countDocuments":
        result = await this._countDocuments(args[0]);
        break;

      default:
        throw new Error(`Unknown operation: ${op}`);
    }

    if (log) await this.clearWAL();
    return result;
  }

  /* ---------------- Public API ---------------- */

  async close(): Promise<void> {
    try {
      await this.db.close();
    } catch {}
  }

  insertOne(doc: T & { _id?: string }): Promise<T> {
    return this._enqueue(() => this._exec("insertOne", [doc]));
  }

  insertMany(docs: (T & { _id?: string })[] = []): Promise<T[]> {
    return this._enqueue(() => this._exec("insertMany", [docs]));
  }

  find(query: any = {}): Promise<T[]> {
    return this._enqueue(() => this._exec("find", [query]));
  }

  findOne(query: any = {}): Promise<T | null> {
    return this._enqueue(() => this._exec("findOne", [query]));
  }

  updateOne(
    filter: any = {},
    update: any = {},
    options: UpdateOptions = { upsert: false }
  ): Promise<T | null> {
    return this._enqueue(() =>
      this._exec("updateOne", [filter, update, options])
    );
  }

  updateMany(filter: any = {}, update: any = {}): Promise<T[]> {
    return this._enqueue(() =>
      this._exec("updateMany", [filter, update])
    );
  }

  deleteOne(filter: any = {}): Promise<boolean> {
    return this._enqueue(() => this._exec("deleteOne", [filter]));
  }

  deleteMany(filter: any = {}): Promise<number> {
    return this._enqueue(() => this._exec("deleteMany", [filter]));
  }

  countDocuments(filter: any = {}): Promise<number> {
    return this._enqueue(() =>
      this._exec("countDocuments", [filter])
    );
  }

  /* ---------------- Internal Ops ---------------- */

  private async _insertOne(doc: T & { _id?: string }): Promise<T> {
    const _id = doc._id ?? uuid();
    const final = this.validate({ _id, ...doc });

    await this.db.put(String(_id), encryptData(final));
    return final;
  }

  private async _insertMany(
    docs: (T & { _id?: string })[]
  ): Promise<T[]> {
    const ops: Array<{ type: "put"; key: string; value: string }> = [];
    const out: T[] = [];

    for (const d of docs) {
      const _id = d._id ?? uuid();
      const final = this.validate({ _id, ...d });

      ops.push({
        type: "put",
        key: String(_id),
        value: encryptData(final)
      });

      out.push(final);
    }

    await this.db.batch(ops);
    return out;
  }

  private async _updateOne(
    filter: any,
    update: any,
    options: UpdateOptions
  ): Promise<T | null> {
    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        const updated = applyUpdate(value, update);
        updated._id = value._id;

        const validated = this.validate(updated);
        await this.db.put(key, encryptData(validated));

        return validated;
      }
    }

    if (options?.upsert) {
      const doc = applyUpdate(filter, update);
      doc._id ??= uuid();

      const validated = this.validate(doc);
      await this.db.put(String(doc._id), encryptData(validated));

      return validated;
    }

    return null;
  }

  private async _updateMany(filter: any, update: any): Promise<T[]> {
    const updated: T[] = [];

    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        const doc = applyUpdate(value, update);
        doc._id = value._id;

        const validated = this.validate(doc);
        await this.db.put(key, encryptData(validated));

        updated.push(validated);
      }
    }

    return updated;
  }

  private async _find(query: any): Promise<T[]> {
    const out: T[] = [];

    for await (const [, enc] of this.db.iterator()) {
      const value = decryptData(enc);
      if (matchDocument(value, query)) out.push(value);
    }

    return out;
  }

  private async _findOne(query: any): Promise<T | null> {
    for await (const [, enc] of this.db.iterator()) {
      const value = decryptData(enc);
      if (matchDocument(value, query)) return value;
    }

    return null;
  }

  private async _deleteOne(filter: any): Promise<boolean> {
    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        await this.db.del(key);
        return true;
      }
    }

    return false;
  }

  private async _deleteMany(filter: any): Promise<number> {
    let count = 0;

    for await (const [key, enc] of this.db.iterator()) {
      const value = decryptData(enc);

      if (matchDocument(value, filter)) {
        await this.db.del(key);
        count++;
      }
    }

    return count;
  }

  private async _countDocuments(filter: any): Promise<number> {
    let c = 0;

    for await (const [, enc] of this.db.iterator()) {
      const value = decryptData(enc);
      if (matchDocument(value, filter)) c++;
    }

    return c;
  }
}
