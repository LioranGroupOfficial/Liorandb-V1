import { ClassicLevel } from "classic-level";
import {
  matchDocument,
  applyUpdate,
  runIndexedQuery,
  selectIndex,
  getByPath
} from "./query.js";
import { v4 as uuid } from "uuid";
import {
  encryptData,
  decryptData,
  encryptDataWithKey,
  decryptDataWithKey
} from "../utils/encryption.js";
import type { ZodSchema } from "zod";
import { validateSchema } from "../utils/schema.js";
import { Index, type IndexOptions } from "./index.js";
import { compactCollectionEngine, rebuildIndexes } from "./compaction.js";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

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
  batchChunkSize?: number;
  scheduler?: CollectionScheduler;
}

export interface FindOptions {
  limit?: number;
  offset?: number;
  projection?: string[];
}

export type CollectionScheduler = {
  write: (op: string, args: any[]) => Promise<any>;
  maintenance: <R>(task: () => Promise<R>) => Promise<R>;
  getChunkSize: () => number;
  createIndex?: (field: string, options?: IndexOptions) => Promise<any>;
};

type QueryExecutionResult<R> = {
  results: R[];
  explain: {
    indexUsed?: string;
    indexType?: "btree";
    scannedDocuments: number;
    returnedDocuments: number;
    executionTimeMs: number;
    usedFullScan: boolean;
    candidateDocuments: number;
  };
};

const META_KEY_PREFIX = "\u0000__meta__:";
const COUNT_META_KEY = META_KEY_PREFIX + "count";

export class Collection<T = any> {
  dir: string;
  db: ClassicLevel<string, string>;
  private writeQueue: Promise<any> = Promise.resolve();

  private schema?: ZodSchema<T>;
  private schemaVersion: number = 1;
  private migrations: Migration<T>[] = [];

  private indexes = new Map<string, Index>();
  private readonlyMode: boolean;
  private docCount = 0;
  private metaLoaded = false;
  private metaLoadPromise: Promise<void> | null = null;
  private scheduler?: CollectionScheduler;
  private batchChunkSize: number;

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
    this.scheduler = options?.scheduler;
    this.batchChunkSize = Math.max(1, Math.trunc(options?.batchChunkSize ?? 500));

    this.db = new ClassicLevel(dir, {
      valueEncoding: "utf8",
      readOnly: this.readonlyMode
    } as any);
  }

  /* ===================== INTERNAL ===================== */

  private assertWritable() {
    if (this.readonlyMode) {
      throw new LiorandbError("READONLY_MODE", "Collection is in readonly replica mode");
    }
  }

  private async ensureMetaLoaded() {
    if (this.metaLoaded) return;
    if (this.metaLoadPromise) return this.metaLoadPromise;

    this.metaLoadPromise = (async () => {
      const rawCount = await this.db.get(COUNT_META_KEY).catch(() => null);
      if (rawCount !== null) {
        const parsed = Number(rawCount);
        if (Number.isFinite(parsed) && parsed >= 0) {
          this.docCount = parsed;
          this.metaLoaded = true;
          return;
        }
      }

      let count = 0;
      for await (const [key] of this.db.iterator()) {
        if (key.startsWith(META_KEY_PREFIX)) continue;
        count++;
      }

      this.docCount = count;
      this.metaLoaded = true;
      await this.persistMeta();
    })();

    try {
      await this.metaLoadPromise;
    } finally {
      this.metaLoadPromise = null;
    }
  }

  private async persistMeta() {
    if (!this.metaLoaded || this.readonlyMode) return;
    await this.db.put(COUNT_META_KEY, String(this.docCount));
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

  /* ===================== WRITE SERIALIZATION ===================== */

  private _enqueueWrite<R>(task: () => Promise<R>): Promise<R> {
    const resultPromise = this.writeQueue.then(task);
    this.writeQueue = resultPromise.then(
      () => undefined,
      () => undefined
    );
    return resultPromise;
  }

  async close(): Promise<void> {
    for (const idx of this.indexes.values()) {
      try { await idx.close(); } catch {}
    }
    try { await this.db.close(); } catch {}
  }

  async reencryptAll(oldKey: Buffer, newKey: Buffer): Promise<void> {
    this.assertWritable();

    const task = async () => {
      const batch: Array<{ type: "put"; key: string; value: string }> = [];

      for await (const [key, value] of this.db.iterator()) {
        if (key.startsWith(META_KEY_PREFIX) || !value) continue;

        const doc = decryptDataWithKey(value, oldKey);
        batch.push({
          type: "put",
          key,
          value: encryptDataWithKey(doc, newKey)
        });

        if (batch.length >= 1000) {
          await this.db.batch(batch);
          batch.length = 0;
        }
      }

      if (batch.length > 0) {
        await this.db.batch(batch);
      }
    };

    if (this.scheduler) {
      return this.scheduler.maintenance(task);
    }

    return this._enqueueWrite(task);
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

    if (this.scheduler) {
      return this.scheduler.maintenance(() => this._compactInternal());
    }

    return this._enqueueWrite(() => this._compactInternal());
  }

  async _compactInternal(): Promise<void> {
    await compactCollectionEngine(this);
  }

  /* ===================== INTERNAL EXEC ===================== */

  async _exec(op: string, args: any[]): Promise<any> {
    try {
      switch (op) {
        case "insertOne": return this._insertOne(args[0]);
        case "insertMany": return this._insertMany(args[0]);
        case "find": return this._find(args[0], args[1]);
        case "findOne": return this._findOne(args[0], args[1]);
        case "aggregate": return this._aggregate(args[0]);
        case "explain": return this._explain(args[0], args[1]);
        case "updateOne": return this._updateOne(args[0], args[1], args[2]);
        case "updateMany": return this._updateMany(args[0], args[1]);
        case "deleteOne": return this._deleteOne(args[0]);
        case "deleteMany": return this._deleteMany(args[0]);
        case "countDocuments": return this._countDocuments(args[0]);
        case "count": return this._count();
        default:
          throw new LiorandbError("UNKNOWN_OPERATION", `Unknown operation: ${op}`, {
            details: { op }
          });
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "INTERNAL",
        message: `Collection operation failed: ${op}`,
        details: { op, dir: this.dir }
      });
    }
  }

  /* ===================== STORAGE ===================== */

  private async _insertOne(doc: any) {
    this.assertWritable();
    await this.ensureMetaLoaded();

    const _id = doc._id ?? uuid();
    if (String(_id).startsWith(META_KEY_PREFIX)) {
      throw new LiorandbError(
        "RESERVED_KEY",
        `Document _id cannot start with reserved prefix "${META_KEY_PREFIX}"`,
        { details: { _id: String(_id), reservedPrefix: META_KEY_PREFIX } }
      );
    }
    const existing = await this.db.get(String(_id)).catch(() => null);

    if (existing) {
      throw new LiorandbError("DUPLICATE_KEY", `Document with _id "${_id}" already exists`, {
        details: { _id: String(_id) }
      });
    }

    const final = this.validate({
      _id,
      ...doc,
      __v: this.schemaVersion
    });

    this.docCount++;
    await this.db.batch([
      {
        type: "put",
        key: String(_id),
        value: encryptData(final)
      },
      {
        type: "put",
        key: COUNT_META_KEY,
        value: String(this.docCount)
      }
    ]);
    await this._updateIndexes(null, final);

    return final;
  }

  private async _insertMany(docs: any[]) {
    this.assertWritable();
    await this.ensureMetaLoaded();

    const batch: any[] = [];
    const out = [];
    const seenIds = new Set<string>();

    for (const d of docs) {
      const _id = d._id ?? uuid();
      const id = String(_id);
      if (id.startsWith(META_KEY_PREFIX)) {
        throw new LiorandbError(
          "RESERVED_KEY",
          `Document _id cannot start with reserved prefix "${META_KEY_PREFIX}"`,
          { details: { _id: id, reservedPrefix: META_KEY_PREFIX } }
        );
      }

      if (seenIds.has(id)) {
        throw new LiorandbError("DUPLICATE_KEY", `Duplicate _id "${id}" in insertMany batch`, {
          details: { _id: id }
        });
      }

      const existing = await this.db.get(id).catch(() => null);
      if (existing) {
        throw new LiorandbError("DUPLICATE_KEY", `Document with _id "${id}" already exists`, {
          details: { _id: id }
        });
      }

      seenIds.add(id);
      const final = this.validate({
        _id,
        ...d,
        __v: this.schemaVersion
      });

      batch.push({
        type: "put",
        key: id,
        value: encryptData(final)
      });

      out.push(final);
    }

    this.docCount += out.length;
    batch.push({
      type: "put",
      key: COUNT_META_KEY,
      value: String(this.docCount)
    });

    await this.db.batch(batch);

    for (const index of this.indexes.values()) {
      await index.bulkInsert(out);
    }

    return out;
  }

  /* ===================== QUERY ===================== */

  private async _getCandidateIds(query: any): Promise<Set<string>> {
    if (query && typeof query === "object" && typeof query !== "function" && "_id" in query) {
      const cond = (query as any)._id;

      if (cond && typeof cond === "object" && !Array.isArray(cond)) {
        if ("$eq" in cond) {
          return new Set([String(cond.$eq)]);
        }
        if ("$in" in cond && Array.isArray(cond.$in)) {
          return new Set(cond.$in.map((v: any) => String(v)));
        }
      } else {
        return new Set([String(cond)]);
      }
    }

    const indexedFields = new Set(this.indexes.keys());

    return runIndexedQuery(
      query,
      {
        indexes: indexedFields,
        findByIndex: async (field, value) => {
          const idx = this.indexes.get(field);
          if (!idx) return null;
          return new Set(await idx.find(value));
        },
        rangeByIndex: async (field, cond) => {
        const idx = this.indexes.get(field);
        if (!idx) return null;
        return new Set(await idx.findRange(cond));
        }
      },
      async () => {
        const ids: string[] = [];
        for await (const [key] of this.db.iterator()) {
          if (key.startsWith(META_KEY_PREFIX)) continue;
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
      const persist = async () => {
        await this.db.put(id, encryptData(migrated));
        await this._updateIndexes(raw, migrated);
      };

      if (this.scheduler) {
        void this.scheduler.maintenance(persist).catch(() => {});
      } else {
        await persist();
      }
    }

    return migrated;
  }

  private normalizeFindOptions(options?: FindOptions) {
    const offset = Math.max(0, Math.trunc(options?.offset ?? 0));
    const rawLimit = options?.limit;
    const limit = rawLimit === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.trunc(rawLimit));
    const projection = Array.isArray(options?.projection)
      ? options!.projection.filter(
          (field): field is string => typeof field === "string" && field.length > 0
        )
      : undefined;

    return { offset, limit, projection };
  }

  private projectDocument(doc: T, projection?: string[]): T {
    if (!projection || projection.length === 0) {
      return doc;
    }

    const out: Record<string, any> = {};

    for (const field of projection) {
      const parts = field.split(".");
      let source: any = doc;

      for (const part of parts) {
        if (source == null) {
          source = undefined;
          break;
        }
        source = source[part];
      }

      if (source === undefined) {
        continue;
      }

      let target: Record<string, any> = out;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const existing = target[part];
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
          target[part] = {};
        }
        target = target[part];
      }

      target[parts[parts.length - 1]] = source;
    }

    return out as T;
  }

  private normalizeProjectSpec(spec: string[] | Record<string, any>) {
    if (Array.isArray(spec)) {
      return spec.filter(
        (field): field is string => typeof field === "string" && field.length > 0
      );
    }

    const out: string[] = [];
    for (const [field, value] of Object.entries(spec ?? {})) {
      if (value === 1 || value === true) {
        out.push(field);
      } else if (typeof value === "string" && value.startsWith("$")) {
        out.push(value.slice(1));
      }
    }
    return out;
  }

  private computeAccumulator(docs: any[], expr: any) {
    if (!expr || typeof expr !== "object" || Array.isArray(expr)) {
      return expr;
    }

    if ("$sum" in expr) {
      const source = expr.$sum;
      if (source === 1) return docs.length;
      return docs.reduce((total, doc) => total + Number(getByPath(doc, String(source).replace(/^\$/, "")) ?? 0), 0);
    }

    if ("$avg" in expr) {
      if (docs.length === 0) return null;
      const total = docs.reduce(
        (sum, doc) => sum + Number(getByPath(doc, String(expr.$avg).replace(/^\$/, "")) ?? 0),
        0
      );
      return total / docs.length;
    }

    if ("$min" in expr) {
      return docs.reduce((min, doc) => {
        const value = getByPath(doc, String(expr.$min).replace(/^\$/, ""));
        return min === undefined || value < min ? value : min;
      }, undefined as any);
    }

    if ("$max" in expr) {
      return docs.reduce((max, doc) => {
        const value = getByPath(doc, String(expr.$max).replace(/^\$/, ""));
        return max === undefined || value > max ? value : max;
      }, undefined as any);
    }

    if ("$push" in expr) {
      return docs.map(doc => getByPath(doc, String(expr.$push).replace(/^\$/, "")));
    }

    if ("$first" in expr) {
      return docs.length === 0
        ? null
        : getByPath(docs[0], String(expr.$first).replace(/^\$/, ""));
    }

    if ("$last" in expr) {
      return docs.length === 0
        ? null
        : getByPath(docs[docs.length - 1], String(expr.$last).replace(/^\$/, ""));
    }

    throw new LiorandbError(
      "UNSUPPORTED_QUERY",
      `Unsupported aggregation accumulator: ${Object.keys(expr)[0]}`,
      { details: { expr } }
    );
  }

  private applyGroupStage(docs: any[], spec: Record<string, any>) {
    const idExpr = spec._id;
    const groups = new Map<string, any[]>();

    for (const doc of docs) {
      const keyValue =
        typeof idExpr === "string" && idExpr.startsWith("$")
          ? getByPath(doc, idExpr.slice(1))
          : idExpr;
      const key = JSON.stringify(keyValue);

      if (!groups.has(key)) {
        groups.set(key, []);
      }

      groups.get(key)!.push(doc);
    }

    const results: any[] = [];

    for (const [key, groupedDocs] of groups) {
      const out: Record<string, any> = {
        _id: JSON.parse(key)
      };

      for (const [field, expr] of Object.entries(spec)) {
        if (field === "_id") continue;
        out[field] = this.computeAccumulator(groupedDocs, expr);
      }

      results.push(out);
    }

    return results;
  }

  private async executeQuery<R = T>(
    query: any,
    options?: FindOptions,
    limitOverride?: number
  ): Promise<QueryExecutionResult<R>> {
    const startedAt = Date.now();
    const ids = await this._getCandidateIds(query);
    const out: R[] = [];
    const { offset, limit, projection } = this.normalizeFindOptions(options);
    const finalLimit = limitOverride === undefined ? limit : Math.min(limit, limitOverride);
    const selection = selectIndex(query, new Set(this.indexes.keys()));
    const indexUsable = selection
      ? (
          "$eq" in selection.cond ||
          "$in" in selection.cond ||
          "$gt" in selection.cond ||
          "$gte" in selection.cond ||
          "$lt" in selection.cond ||
          "$lte" in selection.cond
        )
      : false;
    const indexUsed = selection && indexUsable ? selection.field : undefined;
    const usedFullScan = !indexUsed;
    let skipped = 0;

    if (finalLimit === 0) {
      return {
        results: out,
        explain: {
          indexUsed,
          indexType: indexUsed ? "btree" : undefined,
          scannedDocuments: 0,
          returnedDocuments: 0,
          executionTimeMs: Date.now() - startedAt,
          usedFullScan,
          candidateDocuments: ids.size
        }
      };
    }

    let scannedDocuments = 0;

    for (const id of ids) {
      scannedDocuments++;

      try {
        const doc = await this._readAndMigrate(id);
        if (doc && matchDocument(doc, query)) {
          if (skipped < offset) {
            skipped++;
            continue;
          }

          out.push(this.projectDocument(doc, projection) as unknown as R);

          if (out.length >= finalLimit) {
            break;
          }
        }
      } catch {}
    }

    return {
      results: out,
      explain: {
        indexUsed,
        indexType: indexUsed ? "btree" : undefined,
        scannedDocuments,
        returnedDocuments: out.length,
        executionTimeMs: Date.now() - startedAt,
        usedFullScan,
        candidateDocuments: ids.size
      }
    };
  }

  private async _find(query: any, options?: FindOptions) {
    const execution = await this.executeQuery<T>(query, options);
    return execution.results;
  }

  private async _findOne(query: any, options?: FindOptions) {
    const execution = await this.executeQuery<T>(query, options, 1);
    return execution.results[0] ?? null;
  }

  private async _aggregate(pipeline: any[]) {
    if (!Array.isArray(pipeline)) {
      throw new LiorandbError("VALIDATION_FAILED", "Aggregation pipeline must be an array", {
        details: { pipelineType: typeof pipeline }
      });
    }

    let working: any[];
    let stageIndex = 0;

    if (pipeline[0]?.$match) {
      working = await this._find(pipeline[0].$match);
      stageIndex = 1;
    } else {
      working = await this._find({});
    }

    for (; stageIndex < pipeline.length; stageIndex++) {
      const stage = pipeline[stageIndex];

      if (stage.$match) {
        working = working.filter(doc => matchDocument(doc, stage.$match));
        continue;
      }

      if (stage.$project) {
        const projection = this.normalizeProjectSpec(stage.$project);
        working = working.map(doc => this.projectDocument(doc, projection));
        continue;
      }

      if (stage.$skip !== undefined) {
        working = working.slice(Math.max(0, Math.trunc(stage.$skip)));
        continue;
      }

      if (stage.$limit !== undefined) {
        working = working.slice(0, Math.max(0, Math.trunc(stage.$limit)));
        continue;
      }

      if (stage.$group) {
        working = this.applyGroupStage(working, stage.$group);
        continue;
      }

      throw new LiorandbError(
        "UNSUPPORTED_QUERY",
        `Unsupported aggregation stage: ${Object.keys(stage ?? {})[0] ?? "unknown"}`,
        { details: { stage } }
      );
    }

    return working;
  }

  private async _explain(query: any = {}, options?: FindOptions) {
    const execution = await this.executeQuery(query, options);
    return execution.explain;
  }

  private async _countDocuments(filter: any) {
    await this.ensureMetaLoaded();

    if (!filter || Object.keys(filter).length === 0) {
      return this.docCount;
    }

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

  private async _count() {
    await this.ensureMetaLoaded();
    return this.docCount;
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
    await this.ensureMetaLoaded();

    const ids = await this._getCandidateIds(filter);

    for (const id of ids) {
      const existing = await this._readAndMigrate(id);
      if (!existing) continue;

      if (matchDocument(existing, filter)) {
        this.docCount--;
        await this.db.batch([
          {
            type: "del",
            key: id
          },
          {
            type: "put",
            key: COUNT_META_KEY,
            value: String(this.docCount)
          }
        ]);
        await this._updateIndexes(existing, null);
        return true;
      }
    }

    return false;
  }

  private async _deleteMany(filter: any) {
    this.assertWritable();
    await this.ensureMetaLoaded();

    const ids = await this._getCandidateIds(filter);
    const matchedDocs: any[] = [];
    const deleteOps: Array<
      | { type: "del"; key: string }
      | { type: "put"; key: string; value: string }
    > = [];
    let count = 0;

    for (const id of ids) {
      const existing = await this._readAndMigrate(id);
      if (!existing) continue;

      if (matchDocument(existing, filter)) {
        deleteOps.push({
          type: "del",
          key: id
        });
        matchedDocs.push(existing);
        count++;
      }
    }

    if (count > 0) {
      this.docCount -= count;
      deleteOps.push({
        type: "put",
        key: COUNT_META_KEY,
        value: String(this.docCount)
      });
      await this.db.batch(deleteOps);

      for (const doc of matchedDocs) {
        await this._updateIndexes(doc, null);
      }
    }

    return count;
  }

  /* ===================== PUBLIC API ===================== */

  insertOne(doc: any) {
    if (this.scheduler) {
      return this.scheduler.write("insertOne", [doc]);
    }
    return this._enqueueWrite(() => this._exec("insertOne", [doc]));
  }

  async createIndex(defOrField: any, options: IndexOptions = {}) {
    const field = typeof defOrField === "object" && defOrField
      ? String(defOrField.field)
      : String(defOrField);
    const resolvedOptions: IndexOptions = typeof defOrField === "object" && defOrField
      ? { unique: !!defOrField.unique }
      : options;

    if (this.scheduler?.createIndex) {
      await this.scheduler.createIndex(field, resolvedOptions);
      return;
    }

    // Fallback: local index creation without DB meta persistence.
    // (Most users should create indexes via `db.createIndex(...)` or a DB-managed Collection instance.)
    this.assertWritable();

    if (this.indexes.has(field)) return;

    const index = new Index(this.dir, field, resolvedOptions);
    const docs: any[] = [];

    const flush = async () => {
      if (docs.length === 0) return;
      await index.bulkInsert(docs);
      docs.length = 0;
    };

    for await (const [key, enc] of this.db.iterator()) {
      if (key.startsWith(META_KEY_PREFIX) || !enc) continue;

      let doc: any;
      try {
        doc = decryptData(enc);
      } catch {
        continue;
      }

      docs.push(doc);
      if (docs.length >= 5000) {
        await flush();
      }
    }

    await flush();
    this.registerIndex(index);
  }

  async insertMany(docs: any[], options?: { chunkSize?: number }) {
    const chunkSize = Math.max(
      1,
      Math.trunc(
        options?.chunkSize ?? this.scheduler?.getChunkSize() ?? this.batchChunkSize
      )
    );

    if (!Array.isArray(docs) || docs.length === 0) {
      return [];
    }

    if (docs.length <= chunkSize) {
      if (this.scheduler) {
        return await this.scheduler.write("insertMany", [docs]);
      }
      return await this._enqueueWrite(() => this._exec("insertMany", [docs]));
    }

    const out: any[] = [];

    for (let i = 0; i < docs.length; i += chunkSize) {
      const chunk = docs.slice(i, i + chunkSize);
      const inserted = this.scheduler
        ? await this.scheduler.write("insertMany", [chunk])
        : await this._enqueueWrite(() => this._exec("insertMany", [chunk]));
      out.push(...inserted);
    }

    return out;
  }

  async insertManyStream(
    docs: Iterable<any> | AsyncIterable<any>,
    options?: { chunkSize?: number }
  ): Promise<number> {
    const chunkSize = Math.max(
      1,
      Math.trunc(
        options?.chunkSize ?? this.scheduler?.getChunkSize() ?? this.batchChunkSize
      )
    );

    let count = 0;
    let chunk: any[] = [];

    for await (const doc of docs as any) {
      chunk.push(doc);
      if (chunk.length >= chunkSize) {
        if (this.scheduler) {
          await this.scheduler.write("insertMany", [chunk]);
        } else {
          await this._enqueueWrite(() => this._exec("insertMany", [chunk]));
        }
        count += chunk.length;
        chunk = [];
      }
    }

    if (chunk.length > 0) {
      if (this.scheduler) {
        await this.scheduler.write("insertMany", [chunk]);
      } else {
        await this._enqueueWrite(() => this._exec("insertMany", [chunk]));
      }
      count += chunk.length;
    }

    return count;
  }

  find(query: any = {}, options?: FindOptions) {
    return this._exec("find", [query, options]);
  }

  findOne(query: any = {}, options?: FindOptions) {
    return this._exec("findOne", [query, options]);
  }

  aggregate(pipeline: any[]) {
    return this._exec("aggregate", [pipeline]);
  }

  explain(query: any = {}, options?: FindOptions) {
    return this._exec("explain", [query, options]);
  }

  updateOne(filter: any, update: any, options?: UpdateOptions) {
    if (this.scheduler) {
      return this.scheduler.write("updateOne", [filter, update, options]);
    }
    return this._enqueueWrite(() => this._exec("updateOne", [filter, update, options]));
  }

  updateMany(filter: any, update: any) {
    if (this.scheduler) {
      return this.scheduler.write("updateMany", [filter, update]);
    }
    return this._enqueueWrite(() => this._exec("updateMany", [filter, update]));
  }

  deleteOne(filter: any) {
    if (this.scheduler) {
      return this.scheduler.write("deleteOne", [filter]);
    }
    return this._enqueueWrite(() => this._exec("deleteOne", [filter]));
  }

  deleteMany(filter: any) {
    if (this.scheduler) {
      return this.scheduler.write("deleteMany", [filter]);
    }
    return this._enqueueWrite(() => this._exec("deleteMany", [filter]));
  }

  countDocuments(filter: any = {}) {
    return this._exec("countDocuments", [filter]);
  }

  count() {
    return this._count();
  }
}
