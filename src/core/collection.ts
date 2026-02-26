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

/* ===================== SCHEMA VERSIONING ===================== */

export interface Migration<T = any> {
  from: number;
  to: number;
  migrate: (doc: any) => T;
}

export interface UpdateOptions {
  upsert?: boolean;
}

export interface CollectionOptions {
  readonly?: boolean;
}

export class Collection<T = any> {
  dir: string;
  db: ClassicLevel<string, string>;
  private queue: Promise<any> = Promise.resolve();

  private schema?: ZodSchema<T>;
  private schemaVersion: number = 1;
  private migrations: Migration<T>[] = [];

  private indexes = new Map<string, Index>();
  private readonlyMode: boolean;

  constructor(
    dir: string,
    schema?: ZodSchema<T>,
    schemaVersion: number = 1,
    options?: CollectionOptions
  ) {
    this.dir = dir;
    this.schema = schema;
    this.schemaVersion = schemaVersion;
    this.readonlyMode = options?.readonly ?? false;

    this.db = new ClassicLevel(dir, {
      valueEncoding: "utf8",
      readOnly: this.readonlyMode
    } as any);
  }

  /* ===================== INTERNAL ===================== */

  private assertWritable() {
    if (this.readonlyMode) {
      throw new Error("Collection is in readonly replica mode");
    }
  }

  /* ===================== SCHEMA ===================== */

  setSchema(schema: ZodSchema<T>, version: number) {
    this.schema = schema;
    this.schemaVersion = version;
  }

  addMigration(migration: Migration<T>) {
    this.migrations.push(migration);
    this.migrations.sort((a, b) => a.from - b.from);
  }

  private validate(doc: any): T {
    return this.schema ? validateSchema(this.schema, doc) : doc;
  }

  private migrateIfNeeded(doc: any): T {
    let currentVersion = doc.__v ?? 1;

    if (currentVersion === this.schemaVersion) {
      return doc;
    }

    let working = doc;

    for (const migration of this.migrations) {
      if (migration.from === currentVersion) {
        working = migration.migrate(working);
        currentVersion = migration.to;
      }
    }

    working.__v = this.schemaVersion;
    return this.validate(working);
  }

  /* ===================== QUEUE ===================== */

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

  /* ===================== INDEX MANAGEMENT ===================== */

  registerIndex(index: Index) {
    this.indexes.set(index.field, index);
  }

  getIndex(field: string) {
    return this.indexes.get(field);
  }

  private async _updateIndexes(oldDoc: any, newDoc: any) {
    if (this.readonlyMode) return;
    for (const index of this.indexes.values()) {
      await index.update(oldDoc, newDoc);
    }
  }

  /* ===================== COMPACTION ===================== */

  async compact(): Promise<void> {
    this.assertWritable();

    return this._enqueue(async () => {
      try { await this.db.close(); } catch {}

      await compactCollectionEngine(this);

      this.db = new ClassicLevel(this.dir, { valueEncoding: "utf8" });

      await rebuildIndexes(this);
    });
  }

  /* ===================== INTERNAL EXEC ===================== */

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

  /* ===================== STORAGE ===================== */

  private async _insertOne(doc: any) {
    this.assertWritable();

    const _id = doc._id ?? uuid();
    const final = this.validate({
      _id,
      ...doc,
      __v: this.schemaVersion
    });

    await this.db.put(String(_id), encryptData(final));
    await this._updateIndexes(null, final);

    return final;
  }

  private async _insertMany(docs: any[]) {
    this.assertWritable();

    const batch: any[] = [];
    const out = [];

    for (const d of docs) {
      const _id = d._id ?? uuid();
      const final = this.validate({
        _id,
        ...d,
        __v: this.schemaVersion
      });

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

  /* ===================== QUERY ===================== */

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

  private async _readAndMigrate(id: string) {
    const enc = await this.db.get(id).catch(() => null);
    if (!enc) return null;

    const raw = decryptData(enc);
    const migrated = this.migrateIfNeeded(raw);

    if (!this.readonlyMode && raw.__v !== this.schemaVersion) {
      await this.db.put(id, encryptData(migrated));
      await this._updateIndexes(raw, migrated);
    }

    return migrated;
  }

  private async _find(query: any) {
    const ids = await this._getCandidateIds(query);
    const out = [];

    for (const id of ids) {
      try {
        const doc = await this._readAndMigrate(id);
        if (doc && matchDocument(doc, query)) {
          out.push(doc);
        }
      } catch {}
    }

    return out;
  }

  private async _findOne(query: any) {
    if (query?._id) {
      return this._readAndMigrate(String(query._id));
    }

    const ids = await this._getCandidateIds(query);

    for (const id of ids) {
      try {
        const doc = await this._readAndMigrate(id);
        if (doc && matchDocument(doc, query)) {
          return doc;
        }
      } catch {}
    }

    return null;
  }

  private async _countDocuments(filter: any) {
    const ids = await this._getCandidateIds(filter);
    let count = 0;

    for (const id of ids) {
      try {
        const doc = await this._readAndMigrate(id);
        if (doc && matchDocument(doc, filter)) {
          count++;
        }
      } catch {}
    }

    return count;
  }

  /* ===================== UPDATE ===================== */

  private async _updateOne(filter: any, update: any, options: UpdateOptions) {
    this.assertWritable();

    const ids = await this._getCandidateIds(filter);

    for (const id of ids) {
      const existing = await this._readAndMigrate(id);
      if (!existing) continue;

      if (matchDocument(existing, filter)) {
        const updated = this.validate({
          ...applyUpdate(existing, update),
          _id: (existing as any)._id,
          __v: this.schemaVersion
        });

        await this.db.put(id, encryptData(updated));
        await this._updateIndexes(existing, updated);

        return updated;
      }
    }

    if (options?.upsert) {
      return this._insertOne(applyUpdate({}, update));
    }

    return null;
  }

  private async _updateMany(filter: any, update: any) {
    this.assertWritable();

    const ids = await this._getCandidateIds(filter);
    const out = [];

    for (const id of ids) {
      const existing = await this._readAndMigrate(id);
      if (!existing) continue;

      if (matchDocument(existing, filter)) {
        const updated = this.validate({
          ...applyUpdate(existing, update),
          _id: (existing as any)._id,
          __v: this.schemaVersion
        });

        await this.db.put(id, encryptData(updated));
        await this._updateIndexes(existing, updated);

        out.push(updated);
      }
    }

    return out;
  }

  /* ===================== DELETE ===================== */

  private async _deleteOne(filter: any) {
    this.assertWritable();

    const ids = await this._getCandidateIds(filter);

    for (const id of ids) {
      const existing = await this._readAndMigrate(id);
      if (!existing) continue;

      if (matchDocument(existing, filter)) {
        await this.db.del(id);
        await this._updateIndexes(existing, null);
        return true;
      }
    }

    return false;
  }

  private async _deleteMany(filter: any) {
    this.assertWritable();

    const ids = await this._getCandidateIds(filter);
    let count = 0;

    for (const id of ids) {
      const existing = await this._readAndMigrate(id);
      if (!existing) continue;

      if (matchDocument(existing, filter)) {
        await this.db.del(id);
        await this._updateIndexes(existing, null);
        count++;
      }
    }

    return count;
  }

  /* ===================== PUBLIC API ===================== */

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