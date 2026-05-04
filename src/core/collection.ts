import { ClassicLevel } from "classic-level";
import {
  matchDocument,
  applyUpdate,
  runIndexedQuery,
  selectIndex,
  planQuery,
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
import { Index, TextIndex, type IndexOptions, type TextIndexOptions } from "./index.js";
import { compactCollectionEngine, rebuildIndexes } from "./compaction.js";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";
import { BlobStore, type TieredStorageOptions } from "./blobstore.js";
import type { LCRCache } from "./lcrCache.js";
import { withLatencyBudget, type LatencyViolationMode } from "../utils/latency.js";

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
  resolveCollection?: (name: string) => Collection<any>;
  tieredStorage?: TieredStorageOptions;
  cacheEngine?: any;
  leveldb?: {
    writeBufferSize?: number;
    cacheSize?: number;
    blockSize?: number;
    maxOpenFiles?: number;
    compression?: boolean;
  };
  onExplain?: (explain: {
    scannedDocuments: number;
    returnedDocuments: number;
    usedFullScan: boolean;
    candidateDocuments: number;
  }) => void;
  latency?: {
    enabled?: boolean;
    readBudgetMs?: number;
    onViolation?: LatencyViolationMode;
  };
}

export interface FindOptions {
  limit?: number;
  offset?: number;
  cursor?: string;
  projection?: string[];
}

export type CollectionScheduler = {
  write: (op: string, args: any[]) => Promise<any>;
  maintenance: <R>(task: () => Promise<R>) => Promise<R>;
  getChunkSize: () => number;
  createIndex?: (field: string, options?: IndexOptions) => Promise<any>;
  createTextIndex?: (field: string, options?: TextIndexOptions) => Promise<any>;
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
  private textIndexes = new Map<string, TextIndex>();
  private readonlyMode: boolean;
  private get globalQueryCache(): LCRCache<any[]> | null {
    const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
    if (!engine || !engine.isEnabled()) return null;
    return engine.query;
  }

  private get globalDocCache(): LCRCache<any> | null {
    const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
    if (!engine || !engine.isEnabled()) return null;
    return engine.docs;
  }
  private docCount = 0;
  private metaLoaded = false;
  private metaLoadPromise: Promise<void> | null = null;
  private scheduler?: CollectionScheduler;
  private resolveCollection?: (name: string) => Collection<any>;
  private batchChunkSize: number;
  private blobStore?: BlobStore;
  private onExplain?: CollectionOptions["onExplain"];
  private leveldbOptions?: CollectionOptions["leveldb"];
  private latency?: CollectionOptions["latency"];

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
    this.resolveCollection = options?.resolveCollection;
    this.onExplain = options?.onExplain;
    this.leveldbOptions = options?.leveldb;
    this.latency = options?.latency;
    (this as any)._leveldbOptions = this.leveldbOptions;
    if (options?.tieredStorage) {
      this.blobStore = new BlobStore(this.dir, options.tieredStorage);
      this.blobStore.validateConfig();
    }
    this.batchChunkSize = Math.max(1, Math.trunc(options?.batchChunkSize ?? 500));

    const leveldb = options?.leveldb;
    this.db = new ClassicLevel(dir, {
      valueEncoding: "utf8",
      readOnly: this.readonlyMode,
      writeBufferSize: Math.max(1, Math.trunc(leveldb?.writeBufferSize ?? 64 * 1024 * 1024)),
      cacheSize: Math.max(1, Math.trunc(leveldb?.cacheSize ?? 256 * 1024 * 1024)),
      blockSize: Math.max(1024, Math.trunc(leveldb?.blockSize ?? 16 * 1024)),
      maxOpenFiles: Math.max(50, Math.trunc(leveldb?.maxOpenFiles ?? 500)),
      compression: leveldb?.compression ?? true
    } as any);

    // injected by LioranDB when created via DB-managed collections
    (this as any)._cacheEngine = options?.cacheEngine;
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
    for (const idx of this.textIndexes.values()) {
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
    try {
      const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
      if (engine?.isEnabled()) {
        (index as any).setCache?.(engine.index);
      }
    } catch {}
  }

  getIndex(field: string) {
    return this.indexes.get(field);
  }

  registerTextIndex(index: TextIndex) {
    this.textIndexes.set(index.field, index);
  }

  getTextIndex(field: string) {
    return this.textIndexes.get(field);
  }

  private async _updateIndexes(oldDoc: any, newDoc: any) {
    if (this.readonlyMode) return;
    const indexes = Array.from(this.indexes.values());
    const textIndexes = Array.from(this.textIndexes.values());
    await Promise.all([
      ...indexes.map(index => index.update(oldDoc, newDoc)),
      ...textIndexes.map(index => index.update(oldDoc, newDoc))
    ]);
  }

  private async _rollbackIndexesForDocs(docs: any[]) {
    if (this.readonlyMode) return;
    const indexes = Array.from(this.indexes.values());
    const textIndexes = Array.from(this.textIndexes.values());

    await Promise.all([...indexes, ...textIndexes].map(async (index: any) => {
      for (const doc of docs) {
        try {
          await index.delete(doc);
        } catch {}
      }
    }));
  }

  private async _insertIndexesForDocs(docs: any[]) {
    if (this.readonlyMode) return;

    const indexes = Array.from(this.indexes.values());
    const textIndexes = Array.from(this.textIndexes.values());
    if (indexes.length + textIndexes.length === 0 || docs.length === 0) return;

    // Run per-index in parallel; each index uses its own LevelDB instance.
    await Promise.all([...indexes, ...textIndexes].map((index: any) => {
      return docs.length === 1
        ? index.insert(docs[0])
        : index.bulkInsert(docs);
    }));
  }

  private _runRead<R>(task: () => Promise<R>): Promise<R> {
    const enabled = this.latency?.enabled ?? true;
    const budget = enabled ? this.latency?.readBudgetMs ?? 100 : undefined;
    const mode = this.latency?.onViolation;

    if (this.scheduler) {
      return withLatencyBudget(`read:${this.dir}`, budget, mode, () => this.scheduler!.maintenance(task));
    }

    // Best-effort read-after-write consistency for local (non-scheduler) mode.
    return withLatencyBudget(`read:${this.dir}`, budget, mode, () => this.writeQueue.then(task));
  }

  /* ===================== COMPACTION ===================== */

  async compact(options: { aggressive?: boolean } = {}): Promise<void> {
    this.assertWritable();
    const aggressive = options.aggressive ?? true;

    if (this.scheduler) {
      return this.scheduler.maintenance(() => this._compactInternal(aggressive));
    }

    return this._enqueueWrite(() => this._compactInternal(aggressive));
  }

  async _compactInternal(aggressive = true): Promise<void> {
    await compactCollectionEngine(this, aggressive);
  }

  /* ===================== INTERNAL EXEC ===================== */

  async _exec(op: string, args: any[]): Promise<any> {
    try {
      switch (op) {
        case "insertOne": {
          const r = await this._insertOne(args[0]);
          this.globalQueryCache?.clear();
          this.globalDocCache?.clear();
          try {
            const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
            engine?.index?.clear();
          } catch {}
          return r;
        }
        case "insertMany": {
          const r = await this._insertMany(args[0]);
          this.globalQueryCache?.clear();
          this.globalDocCache?.clear();
          try {
            const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
            engine?.index?.clear();
          } catch {}
          return r;
        }
        case "find": return this._find(args[0], args[1]);
        case "findOne": return this._findOne(args[0], args[1]);
        case "aggregate": return this._aggregate(args[0]);
        case "explain": return this._explain(args[0], args[1]);
        case "updateOne": {
          const r = await this._updateOne(args[0], args[1], args[2]);
          this.globalQueryCache?.clear();
          this.globalDocCache?.clear();
          try {
            const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
            engine?.index?.clear();
          } catch {}
          return r;
        }
        case "updateMany": {
          const r = await this._updateMany(args[0], args[1]);
          this.globalQueryCache?.clear();
          this.globalDocCache?.clear();
          try {
            const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
            engine?.index?.clear();
          } catch {}
          return r;
        }
        case "deleteOne": {
          const r = await this._deleteOne(args[0]);
          this.globalQueryCache?.clear();
          this.globalDocCache?.clear();
          try {
            const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
            engine?.index?.clear();
          } catch {}
          return r;
        }
        case "deleteMany": {
          const r = await this._deleteMany(args[0]);
          this.globalQueryCache?.clear();
          this.globalDocCache?.clear();
          try {
            const engine = (this as any)._cacheEngine as import("./cacheEngine.js").GlobalCacheEngine | undefined;
            engine?.index?.clear();
          } catch {}
          return r;
        }
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

    const externalized = this.blobStore ? this.blobStore.externalizeDoc(doc).doc : doc;

    const final = this.validate({
      _id,
      ...externalized,
      __v: this.schemaVersion
    });

    // Index first, then primary doc write.
    // This avoids "inserted-but-not-indexed" states on index-based queries.
    try {
      await this._insertIndexesForDocs([final]);
    } catch (err) {
      if (this.blobStore) {
        this.blobStore.deleteBlobs(this.blobStore.collectBlobIds(final));
      }
      await this._rollbackIndexesForDocs([final]);
      throw err;
    }

    const nextCount = this.docCount + 1;

    try {
      await this.db.batch([
        {
          type: "put",
          key: String(_id),
          value: encryptData(final)
        },
        {
          type: "put",
          key: COUNT_META_KEY,
          value: String(nextCount)
        }
      ]);

      this.docCount = nextCount;
    } catch (err) {
      if (this.blobStore) {
        this.blobStore.deleteBlobs(this.blobStore.collectBlobIds(final));
      }
      await this._rollbackIndexesForDocs([final]);
      throw err;
    }

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
      const externalized = this.blobStore ? this.blobStore.externalizeDoc(d).doc : d;
      const final = this.validate({
        _id,
        ...externalized,
        __v: this.schemaVersion
      });

      batch.push({
        type: "put",
        key: id,
        value: encryptData(final)
      });

      out.push(final);
    }

    // Index first, then primary doc write (see `_insertOne`).
    try {
      await this._insertIndexesForDocs(out);
    } catch (err) {
      if (this.blobStore) {
        for (const doc of out) {
          this.blobStore.deleteBlobs(this.blobStore.collectBlobIds(doc));
        }
      }
      await this._rollbackIndexesForDocs(out);
      throw err;
    }

    const nextCount = this.docCount + out.length;
    batch.push({
      type: "put",
      key: COUNT_META_KEY,
      value: String(nextCount)
    });

    try {
      await this.db.batch(batch);
      this.docCount = nextCount;
    } catch (err) {
      if (this.blobStore) {
        for (const doc of out) {
          this.blobStore.deleteBlobs(this.blobStore.collectBlobIds(doc));
        }
      }
      await this._rollbackIndexesForDocs(out);
      throw err;
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

    const allDocIds = async () => {
      const ids: string[] = [];
      for await (const [key] of this.db.iterator()) {
        if (key.startsWith(META_KEY_PREFIX)) continue;
        ids.push(key);
      }
      return ids;
    };

    // Text search (optional) can pre-filter candidates (AND semantics).
    let textCandidate: Set<string> | null = null;
    if (query && typeof query === "object" && typeof query !== "function" && "$text" in query) {
      const spec = (query as any).$text;
      const search = typeof spec === "string" ? spec : spec?.$search ?? spec?.search;
      const fields = Array.isArray(spec?.$fields ?? spec?.fields) ? (spec.$fields ?? spec.fields) : undefined;

      if (typeof search === "string" && search.trim().length > 0) {
        const indexes = fields
          ? fields.map((f: any) => this.textIndexes.get(String(f))).filter(Boolean) as TextIndex[]
          : Array.from(this.textIndexes.values());

        if (indexes.length === 0) {
          throw new LiorandbError("UNSUPPORTED_QUERY", "Text search requires a text index", {
            details: { search, fields }
          });
        }

        if (indexes.length > 0) {
          const sets = await Promise.all(indexes.map(idx => idx.search(search)));
          sets.sort((a, b) => a.size - b.size);
          textCandidate = new Set(sets[0]);
          for (let i = 1; i < sets.length; i++) {
            for (const id of textCandidate) {
              if (!sets[i].has(id)) textCandidate.delete(id);
            }
            if (textCandidate.size === 0) break;
          }
        }
      }
    }

    const indexedFields = new Set(this.indexes.keys());

    const plan = await planQuery(
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
      allDocIds
    );

    if (textCandidate) {
      for (const id of plan.candidateIds) {
        if (!textCandidate.has(id)) plan.candidateIds.delete(id);
      }
    }

    return plan.candidateIds;
  }

  private async _readAndMigrate(id: string) {
    const docCache = this.globalDocCache;
    if (docCache) {
      const cached = docCache.get(docCache.makeKey({ c: this.dir, id }));
      if (cached !== null) return cached;
    }

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

    const hydrated = this.blobStore ? this.blobStore.hydrateDoc(migrated) : migrated;
    if (docCache) {
      docCache.set(docCache.makeKey({ c: this.dir, id }), hydrated);
    }
    return hydrated;
  }

  private normalizeFindOptions(options?: FindOptions) {
    const cursor = typeof options?.cursor === "string" && options.cursor.length > 0
      ? options.cursor
      : undefined;
    const offset = cursor ? 0 : Math.max(0, Math.trunc(options?.offset ?? 0));
    const rawLimit = options?.limit;
    const limit = rawLimit === undefined
      ? Number.POSITIVE_INFINITY
      : Math.max(0, Math.trunc(rawLimit));
    const projection = Array.isArray(options?.projection)
      ? options!.projection.filter(
          (field): field is string => typeof field === "string" && field.length > 0
        )
      : undefined;

    return { offset, limit, projection, cursor };
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
    const out: R[] = [];
    const { offset, limit, projection, cursor } = this.normalizeFindOptions(options);
    const finalLimit = limitOverride === undefined ? limit : Math.min(limit, limitOverride);
    let indexUsed: string | undefined = undefined;
    let usedFullScan = true;
    let skipped = 0;

    const finalize = (execution: QueryExecutionResult<R>) => {
      try {
        this.onExplain?.({
          scannedDocuments: execution.explain.scannedDocuments,
          returnedDocuments: execution.explain.returnedDocuments,
          usedFullScan: execution.explain.usedFullScan,
          candidateDocuments: execution.explain.candidateDocuments
        });
      } catch {}
      return execution;
    };

    if (finalLimit === 0) {
      return finalize({
        results: out,
        explain: {
          indexUsed,
          indexType: indexUsed ? "btree" : undefined,
          scannedDocuments: 0,
          returnedDocuments: 0,
          executionTimeMs: Date.now() - startedAt,
          usedFullScan,
          candidateDocuments: 0
        }
      });
    }

    let scannedDocuments = 0;

    const isPlainObject =
      query !== null &&
      typeof query === "object" &&
      typeof query !== "function" &&
      !Array.isArray(query);

    // O(1) `_id` fast path (exact lookup): avoid planner + candidate resolution.
    if (isPlainObject && "_id" in query && Object.keys(query).length === 1) {
      const cond = (query as any)._id;
      const isScalar = !cond || typeof cond !== "object" || Array.isArray(cond);
      const isEqObject = !!cond && typeof cond === "object" && !Array.isArray(cond) && "$eq" in cond;

      if (isScalar || isEqObject) {
        const id = String(isScalar ? cond : cond.$eq);
        const enc = await this.db.get(id).catch(() => null);
        scannedDocuments = 1;

        if (!enc) {
          return finalize({
            results: out,
            explain: {
              indexUsed: "_id",
              indexType: "btree",
              scannedDocuments,
              returnedDocuments: 0,
              executionTimeMs: Date.now() - startedAt,
              usedFullScan: false,
              candidateDocuments: 1
            }
          });
        }

        let raw: any;
        try {
          raw = decryptData(enc);
        } catch {
          return finalize({
            results: out,
            explain: {
              indexUsed: "_id",
              indexType: "btree",
              scannedDocuments,
              returnedDocuments: 0,
              executionTimeMs: Date.now() - startedAt,
              usedFullScan: false,
              candidateDocuments: 1
            }
          });
        }

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

        out.push(this.projectDocument(this.blobStore ? this.blobStore.hydrateDoc(migrated) : migrated, projection) as unknown as R);

        return finalize({
          results: out,
          explain: {
            indexUsed: "_id",
            indexType: "btree",
            scannedDocuments,
            returnedDocuments: 1,
            executionTimeMs: Date.now() - startedAt,
            usedFullScan: false,
            candidateDocuments: 1
          }
        });
      }
    }

    const isTrivialQuery =
      !query ||
      (isPlainObject && Object.keys(query).length === 0);

    // Fast-path for `find({})`: avoid building an id list + per-doc `db.get()`.
    // Instead, stream through LevelDB iterator (key,value) once.
    if (isTrivialQuery) {
      const iteratorOptions = cursor ? ({ gt: cursor } as any) : undefined;
      for await (const [key, enc] of this.db.iterator(iteratorOptions)) {
        if (key.startsWith(META_KEY_PREFIX) || !enc) continue;
        scannedDocuments++;

        let raw: any;
        try {
          raw = decryptData(enc);
        } catch {
          continue;
        }

        const migrated = this.migrateIfNeeded(raw);

        if (!this.readonlyMode && raw.__v !== this.schemaVersion) {
          const persist = async () => {
            await this.db.put(key, encryptData(migrated));
            await this._updateIndexes(raw, migrated);
          };

          if (this.scheduler) {
            void this.scheduler.maintenance(persist).catch(() => {});
          } else {
            await persist();
          }
        }

        if (skipped < offset) {
          skipped++;
          continue;
        }

        out.push(this.projectDocument(migrated, projection) as unknown as R);
        if (out.length >= finalLimit) break;
      }

      return finalize({
        results: out,
        explain: {
          indexUsed: undefined,
          indexType: undefined,
          scannedDocuments,
          returnedDocuments: out.length,
          executionTimeMs: Date.now() - startedAt,
          usedFullScan: true,
          candidateDocuments: scannedDocuments
        }
      });
    }

    // Cursor-friendly `_id` range scan: avoids building an id list + per-doc `db.get()`.
    if (isPlainObject && "_id" in query && Object.keys(query).length === 1) {
      const cond = (query as any)._id;
      const isObj = !!cond && typeof cond === "object" && !Array.isArray(cond);
      if (isObj && ("$gt" in cond || "$gte" in cond || "$lt" in cond || "$lte" in cond)) {
        const it: any = {};
        if (cond.$gt !== undefined) it.gt = String(cond.$gt);
        if (cond.$gte !== undefined) it.gte = String(cond.$gte);
        if (cond.$lt !== undefined) it.lt = String(cond.$lt);
        if (cond.$lte !== undefined) it.lte = String(cond.$lte);

        for await (const [key, enc] of this.db.iterator(it)) {
          if (key.startsWith(META_KEY_PREFIX) || !enc) continue;
          scannedDocuments++;

          let raw: any;
          try {
            raw = decryptData(enc);
          } catch {
            continue;
          }

          const migrated = this.migrateIfNeeded(raw);

          if (!this.readonlyMode && raw.__v !== this.schemaVersion) {
            const persist = async () => {
              await this.db.put(key, encryptData(migrated));
              await this._updateIndexes(raw, migrated);
            };

            if (this.scheduler) {
              void this.scheduler.maintenance(persist).catch(() => {});
            } else {
              await persist();
            }
          }

          if (skipped < offset) {
            skipped++;
            continue;
          }

          out.push(this.projectDocument(this.blobStore ? this.blobStore.hydrateDoc(migrated) : migrated, projection) as unknown as R);
          if (out.length >= finalLimit) break;
        }

        return finalize({
          results: out,
          explain: {
            indexUsed: "_id",
            indexType: "btree",
            scannedDocuments,
            returnedDocuments: out.length,
            executionTimeMs: Date.now() - startedAt,
            usedFullScan: false,
            candidateDocuments: scannedDocuments
          }
        });
      }
    }

    // Covering index fast-path: if the projection is satisfied by the index itself,
    // return directly from the index without primary document reads.
    if (
      isPlainObject &&
      projection &&
      projection.length > 0 &&
      Object.keys(query).length === 1
    ) {
      const field = Object.keys(query)[0];
      if (field !== "_id" && field !== "$text") {
        const idx = this.indexes.get(field);
        const cond = (query as any)[field];
        const isScalar = !cond || typeof cond !== "object" || Array.isArray(cond);
        const isEqObject = !!cond && typeof cond === "object" && !Array.isArray(cond) && "$eq" in cond;

        const include = (idx as any)?.include as string[] | undefined;
        const hasCover = Array.isArray(include) && include.length > 0;
        const projectionCovered = hasCover
          ? projection.every(p => p === "_id" || include.includes(p))
          : false;

        if (idx && projectionCovered && (isScalar || isEqObject)) {
          const value = isScalar ? cond : cond.$eq;
          const covered = await (idx as any).findCover?.(value);
          if (Array.isArray(covered)) {
            scannedDocuments = covered.length;
            const sliced = covered.slice(offset, Number.isFinite(finalLimit) ? offset + finalLimit : undefined);
            return finalize({
              results: sliced as unknown as R[],
              explain: {
                indexUsed: field,
                indexType: "btree",
                scannedDocuments,
                returnedDocuments: sliced.length,
                executionTimeMs: Date.now() - startedAt,
                usedFullScan: false,
                candidateDocuments: covered.length
              }
            });
          }
        }
      }
    }

    // Planner (best-effort) for explain output. Avoids the trivial-query fast path above.
    const allDocIds = async () => {
      const ids: string[] = [];
      for await (const [key] of this.db.iterator()) {
        if (key.startsWith(META_KEY_PREFIX)) continue;
        ids.push(key);
      }
      return ids;
    };

    const plan = await planQuery(
      query,
      {
        indexes: new Set(this.indexes.keys()),
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
      allDocIds
    );

    if (plan.usedIndexes.length > 0) {
      indexUsed = plan.usedIndexes.join("&");
      usedFullScan = false;
    }

    const ids = await this._getCandidateIds(query);

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

    const result = {
      results: out,
      explain: {
        indexUsed,
        indexType: indexUsed ? ("btree" as const) : undefined,
        scannedDocuments,
        returnedDocuments: out.length,
        executionTimeMs: Date.now() - startedAt,
        usedFullScan,
        candidateDocuments: ids.size
      }
    };

    return finalize(result);
  }

  private async _find(query: any, options?: FindOptions) {
    if (typeof query === "function") {
      const execution = await this.executeQuery<T>(query, options);
      return execution.results;
    }

    const cache = this.globalQueryCache;
    if (!cache) {
      const execution = await this.executeQuery<T>(query, options);
      return execution.results;
    }

    const key = cache.makeKey({
      c: this.dir,
      q: query ?? {},
      o: {
        limit: options?.limit,
        offset: options?.offset,
        cursor: options?.cursor,
        projection: options?.projection
      }
    });

    const cached = cache.get(key);
    if (cached !== null) return cached as T[];

    const execution = await this.executeQuery<T>(query, options);
    cache.set(key, execution.results);
    return execution.results;
  }

  private async _findOne(query: any, options?: FindOptions) {
    if (typeof query === "function") {
      const execution = await this.executeQuery<T>(query, options, 1);
      return execution.results[0] ?? null;
    }

    const cache = this.globalQueryCache;
    if (!cache) {
      const execution = await this.executeQuery<T>(query, options, 1);
      return execution.results[0] ?? null;
    }

    const key = cache.makeKey({
      c: this.dir,
      q: query ?? {},
      o: {
        limit: 1,
        offset: options?.offset,
        cursor: options?.cursor,
        projection: options?.projection
      }
    });

    const cached = cache.get(key);
    if (cached !== null) return (cached[0] as T) ?? null;

    const execution = await this.executeQuery<T>(query, options, 1);
    cache.set(key, execution.results);
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

      if (stage.$lookup) {
        const spec = stage.$lookup;
        const from = String(spec?.from ?? "");
        const localField = String(spec?.localField ?? "");
        const foreignField = String(spec?.foreignField ?? "");
        const as = String(spec?.as ?? "");

        if (!from || !localField || !foreignField || !as) {
          throw new LiorandbError("VALIDATION_FAILED", "Invalid $lookup spec", {
            details: { spec }
          });
        }

        const foreignCol = this.resolveCollection?.(from);
        if (!foreignCol) {
          throw new LiorandbError("INTERNAL", "$lookup requires a DB-managed collection resolver", {
            details: { from }
          });
        }

        const next: any[] = [];
        for (const doc of working) {
          const localValue = getByPath(doc, localField);
          const matches = await foreignCol.find({ [foreignField]: { $eq: localValue } }, { limit: Number.POSITIVE_INFINITY });
          next.push({ ...doc, [as]: matches });
        }
        working = next;

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
        const oldBlobIds = this.blobStore ? this.blobStore.collectBlobIds(existing) : [];
        const applied = applyUpdate(existing, update);
        const externalized = this.blobStore ? this.blobStore.externalizeDoc(applied).doc : applied;

        const updated = this.validate({
          ...externalized,
          _id: (existing as any)._id,
          __v: this.schemaVersion
        });

        await this.db.put(id, encryptData(updated));
        try {
          await this._updateIndexes(existing, updated);
        } catch (err) {
          // Best-effort rollback: keep indexes + primary storage consistent.
          try { await this.db.put(id, encryptData(existing)); } catch {}
          try { await this._updateIndexes(updated, existing); } catch {}
          if (this.blobStore) {
            const updatedIds = this.blobStore.collectBlobIds(updated);
            for (const bid of updatedIds) {
              if (!oldBlobIds.includes(bid)) this.blobStore.deleteBlobs([bid]);
            }
          }
          throw err;
        }

        if (this.blobStore) {
          const updatedIds = this.blobStore.collectBlobIds(updated);
          const toDelete = oldBlobIds.filter(bid => !updatedIds.includes(bid));
          this.blobStore.deleteBlobs(toDelete);
        }

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
        const oldBlobIds = this.blobStore ? this.blobStore.collectBlobIds(existing) : [];
        const applied = applyUpdate(existing, update);
        const externalized = this.blobStore ? this.blobStore.externalizeDoc(applied).doc : applied;

        const updated = this.validate({
          ...externalized,
          _id: (existing as any)._id,
          __v: this.schemaVersion
        });

        await this.db.put(id, encryptData(updated));
        try {
          await this._updateIndexes(existing, updated);
        } catch (err) {
          try { await this.db.put(id, encryptData(existing)); } catch {}
          try { await this._updateIndexes(updated, existing); } catch {}
          if (this.blobStore) {
            const updatedIds = this.blobStore.collectBlobIds(updated);
            for (const bid of updatedIds) {
              if (!oldBlobIds.includes(bid)) this.blobStore.deleteBlobs([bid]);
            }
          }
          throw err;
        }

        if (this.blobStore) {
          const updatedIds = this.blobStore.collectBlobIds(updated);
          const toDelete = oldBlobIds.filter(bid => !updatedIds.includes(bid));
          this.blobStore.deleteBlobs(toDelete);
        }

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
        const oldBlobIds = this.blobStore ? this.blobStore.collectBlobIds(existing) : [];
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
        if (this.blobStore) this.blobStore.deleteBlobs(oldBlobIds);
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

      if (this.blobStore) {
        for (const doc of matchedDocs) {
          this.blobStore.deleteBlobs(this.blobStore.collectBlobIds(doc));
        }
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
      ? { unique: !!defOrField.unique, include: defOrField.include }
      : options;

    if (this.scheduler?.createIndex) {
      await this.scheduler.createIndex(field, resolvedOptions);
      return;
    }

    // Fallback: local index creation without DB meta persistence.
    // (Most users should create indexes via `db.createIndex(...)` or a DB-managed Collection instance.)
    this.assertWritable();

    if (this.indexes.has(field)) return;

    const index = new Index(this.dir, field, resolvedOptions, this.leveldbOptions);
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

  async createTextIndex(defOrField: any, options: TextIndexOptions = {}) {
    const field = typeof defOrField === "object" && defOrField
      ? String(defOrField.field)
      : String(defOrField);
    const resolvedOptions: TextIndexOptions = typeof defOrField === "object" && defOrField
      ? { normalize: defOrField.normalize ?? true, stopwords: defOrField.stopwords }
      : options;

    if (this.scheduler?.createTextIndex) {
      await this.scheduler.createTextIndex(field, resolvedOptions);
      return;
    }

    // Fallback: local-only text index creation.
    this.assertWritable();
    if (this.textIndexes.has(field)) return;

    const index = new TextIndex(this.dir, field, resolvedOptions, this.leveldbOptions);
    const docs: any[] = [];
    const flush = async () => {
      if (docs.length === 0) return;
      await index.bulkInsert(docs);
      docs.length = 0;
    };

    for await (const [key, enc] of this.db.iterator()) {
      if (key.startsWith(META_KEY_PREFIX) || !enc) continue;
      try {
        docs.push(decryptData(enc));
      } catch {
        continue;
      }
      if (docs.length >= 5000) await flush();
    }

    await flush();
    this.registerTextIndex(index);
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
    const finalOptions =
      options && typeof options === "object" && options.limit !== undefined
        ? options
        : { ...(options ?? {}), limit: 100 };

    return this._runRead(() => this._exec("find", [query, finalOptions]));
  }

  findOne(query: any = {}, options?: FindOptions) {
    return this._runRead(() => this._exec("findOne", [query, options]));
  }

  aggregate(pipeline: any[]) {
    return this._runRead(() => this._exec("aggregate", [pipeline]));
  }

  explain(query: any = {}, options?: FindOptions) {
    return this._runRead(() => this._exec("explain", [query, options]));
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
    return this._runRead(() => this._exec("countDocuments", [filter]));
  }

  count() {
    return this._runRead(() => this._count());
  }
}
