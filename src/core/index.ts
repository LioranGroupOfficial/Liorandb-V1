import path from "path";
import fs from "fs";
import { ClassicLevel } from "classic-level";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";
import type { LCRCache } from "./lcrCache.js";

/* ----------------------------- TYPES ----------------------------- */

export interface IndexOptions {
  unique?: boolean;
  /**
   * Optional "covering index" fields. When set, the index stores these fields
   * (plus `_id`) alongside each entry so projected queries can avoid primary
   * document reads.
   */
  include?: string[];
}

export interface TextIndexOptions {
  /**
   * If true, splits on non-alphanumeric and lowercases (recommended).
   * If false, uses whitespace split only.
   */
  normalize?: boolean;
  /**
   * Optional stopwords to ignore.
   */
  stopwords?: string[];
}

type IndexValue = string;

const UNIQUE_PREFIX = "u:";
const ENTRY_PREFIX = "e:";
const VALUE_SEPARATOR = "\u0000";
const RANGE_END = "\uffff";

/* ----------------------------- INDEX ----------------------------- */

export class Index {
  readonly field: string;
  readonly unique: boolean;
  readonly include?: string[];
  readonly dir: string;
  readonly db: ClassicLevel<string, string>;
  private cache: LCRCache<any> | null = null;
  private selectivityEwma: number | null = null;

  constructor(
    baseDir: string,
    field: string,
    options: IndexOptions = {},
    dbOptions?: {
      writeBufferSize?: number;
      cacheSize?: number;
      blockSize?: number;
      maxOpenFiles?: number;
      compression?: boolean;
    }
  ) {
    this.field = field;
    this.unique = !!options.unique;
    this.include = Array.isArray(options.include)
      ? options.include.filter((f): f is string => typeof f === "string" && f.length > 0)
      : undefined;

    this.dir = path.join(baseDir, "__indexes", field + ".idx");
    fs.mkdirSync(this.dir, { recursive: true });

    this.db = new ClassicLevel(this.dir, { valueEncoding: "utf8", ...(dbOptions ?? {}) } as any);
  }

  setCache(cache: LCRCache<any> | null) {
    this.cache = cache;
  }

  observeSelectivity(actualCandidates: number) {
    const n = Math.max(0, Math.trunc(actualCandidates));
    if (this.selectivityEwma === null) {
      this.selectivityEwma = n;
      return;
    }
    // EWMA: favor recent observations.
    this.selectivityEwma = this.selectivityEwma * 0.85 + n * 0.15;
  }

  getSelectivityHint(): number | null {
    return this.selectivityEwma;
  }

  async estimateCandidates(cond: any): Promise<number | null> {
    try {
      if (!cond || typeof cond !== "object" || Array.isArray(cond)) {
        return await this.estimateEq(cond);
      }

      if ("$eq" in cond) {
        return await this.estimateEq(cond.$eq);
      }

      if ("$in" in cond && Array.isArray(cond.$in)) {
        let total = 0;
        for (const v of cond.$in) {
          const c = await this.estimateEq(v);
          total += c ?? 0;
          if (total > 100_000) return total; // cap
        }
        return total;
      }

      if ("$gt" in cond || "$gte" in cond || "$lt" in cond || "$lte" in cond) {
        return await this.estimateRange(cond);
      }

      return null;
    } catch {
      return null;
    }
  }

  /* ------------------------- INTERNAL ------------------------- */

  private escapeString(value: string): string {
    return value
      .replaceAll("\\", "\\\\")
      .replaceAll(VALUE_SEPARATOR, "\\0")
      .replaceAll(RANGE_END, "\\f");
  }

  private encodeNumber(value: number): string {
    const buffer = Buffer.allocUnsafe(8);
    buffer.writeDoubleBE(value, 0);

    if (value >= 0 || Object.is(value, 0)) {
      buffer[0] ^= 0x80;
    } else {
      for (let i = 0; i < buffer.length; i++) {
        buffer[i] ^= 0xff;
      }
    }

    return buffer.toString("hex");
  }

  private normalizeKey(value: any): string {
    if (value === null || value === undefined) return "0:";

    if (typeof value === "number") {
      return `1:${this.encodeNumber(value)}`;
    }

    if (typeof value === "bigint") {
      const sign = value < 0n ? "0" : "1";
      const abs = (value < 0n ? -value : value).toString().padStart(32, "0");
      return `2:${sign}:${abs}`;
    }

    if (typeof value === "boolean") {
      return `3:${value ? "1" : "0"}`;
    }

    if (typeof value === "string") {
      return `4:${this.escapeString(value)}`;
    }

    if (value instanceof Date) {
      return `5:${this.encodeNumber(value.getTime())}`;
    }

    return `6:${this.escapeString(JSON.stringify(value))}`;
  }

  private makeUniqueKey(value: any): string {
    return UNIQUE_PREFIX + this.normalizeKey(value);
  }

  private makeEntryPrefix(value: any): string {
    return ENTRY_PREFIX + this.normalizeKey(value) + VALUE_SEPARATOR;
  }

  private makeEntryKey(value: any, id: string): string {
    return this.makeEntryPrefix(value) + String(id);
  }

  private buildCover(doc: any): any | null {
    if (!this.include || this.include.length === 0) return null;
    const out: Record<string, any> = { _id: doc?._id };

    for (const field of this.include) {
      if (!field || field === "_id") continue;
      const parts = field.split(".");
      let source: any = doc;
      for (const part of parts) {
        if (source == null) {
          source = undefined;
          break;
        }
        source = source[part];
      }
      if (source === undefined) continue;

      let target: Record<string, any> = out;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        const existing = target[part];
        if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
          target[part] = {};
        }
        target = target[part];
      }
      target[parts.at(-1)!] = source;
    }

    return out;
  }

  private decodeUniqueValueToId(raw: string): string {
    if (!raw) return "";
    if (raw[0] === "{") {
      try {
        const parsed = JSON.parse(raw);
        return String(parsed?._id ?? parsed?.id ?? "");
      } catch {
        return raw;
      }
    }
    return raw;
  }

  private async getRaw(key: string): Promise<IndexValue | null> {
    try {
      const value = await this.db.get(key);
      return value === undefined ? null : value;
    } catch {
      return null;
    }
  }

  private async setRaw(key: string, value: IndexValue) {
    await this.db.put(key, value);
  }

  private async delRaw(key: string) {
    try { await this.db.del(key); } catch {}
  }

  /* --------------------------- API --------------------------- */

  /**
   * Returns true if this document is already indexed for this index field.
   *
   * - For non-unique indexes: checks presence of the exact entry key.
   * - For unique indexes: checks that the unique mapping exists and points to the same document id.
   *
   * Documents with `undefined` value for the indexed field are treated as "already satisfied"
   * (i.e., they should not produce index entries).
   */
  async isIndexed(doc: any): Promise<boolean> {
    const val = doc?.[this.field];
    if (val === undefined) return true;

    if (this.unique) {
      const key = this.makeUniqueKey(val);
      const existing = await this.getRaw(key);
      if (!existing) return false;

      const docId = String(doc?._id);
      const existingId = this.decodeUniqueValueToId(existing);
      if (existingId === docId) return true;

      throw new LiorandbError(
        "UNIQUE_INDEX_VIOLATION",
        `Unique index violation on "${this.field}"`,
        { details: { field: this.field, value: val, existingId, docId } }
      );
    }

    const existing = await this.getRaw(this.makeEntryKey(val, doc?._id));
    return !!existing;
  }

  async insert(doc: any) {
    try {
      const val = doc[this.field];
      if (val === undefined) return;

      if (this.unique) {
        const key = this.makeUniqueKey(val);
        const existing = await this.getRaw(key);
        const docId = String(doc._id);

        // Idempotent: allow re-inserting the same mapping (important for retries/repairs).
        const existingId = existing ? this.decodeUniqueValueToId(existing) : "";
        if (existingId === docId) return;

        if (existing) {
          throw new LiorandbError(
            "UNIQUE_INDEX_VIOLATION",
            `Unique index violation on "${this.field}"`,
            { details: { field: this.field, value: val, existingId, docId } }
          );
        }

        const cover = this.buildCover(doc);
        await this.setRaw(key, cover ? JSON.stringify(cover) : docId);
        return;
      }

      const cover = this.buildCover(doc);
      await this.setRaw(this.makeEntryKey(val, doc._id), cover ? JSON.stringify(cover) : "1");
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to insert index entry",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  async delete(doc: any) {
    try {
      const val = doc[this.field];
      if (val === undefined) return;

      if (this.unique) {
        const key = this.makeUniqueKey(val);
        const existing = await this.getRaw(key);
        const docId = String(doc._id);

        // Safety: never delete a unique mapping we don't own (corruption/partial failures).
        const existingId = existing ? this.decodeUniqueValueToId(existing) : "";
        if (existingId !== docId) return;

        await this.delRaw(key);
        return;
      }

      await this.delRaw(this.makeEntryKey(val, doc._id));
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to delete index entry",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  async update(oldDoc: any, newDoc: any) {
    try {
      const oldVal = oldDoc?.[this.field];
      const newVal = newDoc?.[this.field];

      if (oldVal === newVal) return;

      if (oldDoc) await this.delete(oldDoc);
      if (newDoc) await this.insert(newDoc);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to update index entry",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  async find(value: any): Promise<string[]> {
    try {
      if (this.cache) {
        const key = this.cache.makeKey({ t: "idx", d: this.dir, op: "find", v: value });
        const cached = this.cache.get(key);
        if (cached !== null) return cached as string[];
        const res = await this.findUncached(value);
        this.cache.set(key, res);
        return res;
      }

      return await this.findUncached(value);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to query index",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  private async estimateEq(value: any): Promise<number> {
    if (value === undefined) return 0;

    if (this.unique) {
      const key = this.makeUniqueKey(value);
      const existing = await this.getRaw(key);
      return existing ? 1 : 0;
    }

    const prefix = this.makeEntryPrefix(value);
    // Count entries with this prefix (bounded for safety).
    let count = 0;
    const max = 50_000;
    for await (const [k] of this.db.iterator({ gte: prefix, lt: prefix + RANGE_END } as any)) {
      if (!k.startsWith(prefix)) break;
      count++;
      if (count >= max) break;
    }
    return count;
  }

  private async estimateRange(cond: any): Promise<number> {
    // Very rough: scan index keyspace for the range prefixes.
    // If cond isn't representable, return a conservative value.
    let gte = ENTRY_PREFIX;
    let lt = ENTRY_PREFIX + RANGE_END;

    const hasLower = cond.$gt !== undefined || cond.$gte !== undefined;
    const hasUpper = cond.$lt !== undefined || cond.$lte !== undefined;

    if (hasLower) {
      const v = cond.$gt !== undefined ? cond.$gt : cond.$gte;
      gte = this.makeEntryPrefix(v);
    }

    if (hasUpper) {
      const v = cond.$lt !== undefined ? cond.$lt : cond.$lte;
      lt = this.makeEntryPrefix(v) + RANGE_END;
    }

    let count = 0;
    const max = 50_000;
    for await (const [k] of this.db.iterator({ gte, lt } as any)) {
      if (!k.startsWith(ENTRY_PREFIX)) continue;
      count++;
      if (count >= max) break;
    }
    return count;
  }

  private async findUncached(value: any): Promise<string[]> {
    if (this.unique) {
      const raw = await this.getRaw(this.makeUniqueKey(value));
      const id = raw ? this.decodeUniqueValueToId(raw) : "";
      return id ? [id] : [];
    }

    const prefix = this.makeEntryPrefix(value);
    const ids: string[] = [];

    for await (const [key] of this.db.iterator({
      gte: prefix,
      lte: prefix + RANGE_END
    })) {
      ids.push(key.slice(prefix.length));
    }

    return ids;
  }

  async findRange(cond: any): Promise<string[]> {
    try {
      if (this.cache) {
        const key = this.cache.makeKey({ t: "idx", d: this.dir, op: "range", c: cond });
        const cached = this.cache.get(key);
        if (cached !== null) return cached as string[];
        const res = await this.findRangeUncached(cond);
        this.cache.set(key, res);
        return res;
      }

      return await this.findRangeUncached(cond);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to query index range",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  private async findRangeUncached(cond: any): Promise<string[]> {
    const normalizedGte = cond.$gt !== undefined
      ? this.normalizeKey(cond.$gt) + RANGE_END
      : cond.$gte !== undefined
        ? this.normalizeKey(cond.$gte)
        : "";
    const normalizedLte = cond.$lt !== undefined
      ? this.normalizeKey(cond.$lt)
      : cond.$lte !== undefined
        ? this.normalizeKey(cond.$lte) + RANGE_END
        : RANGE_END;

    const prefix = this.unique ? UNIQUE_PREFIX : ENTRY_PREFIX;
    const ids: string[] = [];

    for await (const [key, value] of this.db.iterator({
      gte: prefix + normalizedGte,
      lte: prefix + normalizedLte
    })) {
      if (this.unique) {
        const id = this.decodeUniqueValueToId(value);
        if (id) ids.push(id);
        continue;
      }

      const separatorAt = key.lastIndexOf(VALUE_SEPARATOR);
      ids.push(key.slice(separatorAt + VALUE_SEPARATOR.length));
    }

    return ids;
  }

  async findCover(value: any): Promise<any[] | null> {
    if (!this.include || this.include.length === 0) return null;

    try {
      if (this.unique) {
        const raw = await this.getRaw(this.makeUniqueKey(value));
        if (!raw) return [];
        if (raw[0] !== "{") return null;
        try {
          return [JSON.parse(raw)];
        } catch {
          return null;
        }
      }

      const prefix = this.makeEntryPrefix(value);
      const out: any[] = [];

      for await (const [, stored] of this.db.iterator({
        gte: prefix,
        lte: prefix + RANGE_END
      })) {
        if (!stored || stored[0] !== "{") return null;
        try {
          out.push(JSON.parse(stored));
        } catch {
          return null;
        }
      }

      return out;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to query covering index",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  async findRangeCover(cond: any): Promise<any[] | null> {
    if (!this.include || this.include.length === 0) return null;

    try {
      const normalizedGte = cond.$gt !== undefined
        ? this.normalizeKey(cond.$gt) + RANGE_END
        : cond.$gte !== undefined
          ? this.normalizeKey(cond.$gte)
          : "";
      const normalizedLte = cond.$lt !== undefined
        ? this.normalizeKey(cond.$lt)
        : cond.$lte !== undefined
          ? this.normalizeKey(cond.$lte) + RANGE_END
          : RANGE_END;

      const prefix = this.unique ? UNIQUE_PREFIX : ENTRY_PREFIX;
      const out: any[] = [];

      for await (const [, stored] of this.db.iterator({
        gte: prefix + normalizedGte,
        lte: prefix + normalizedLte
      })) {
        if (!stored || stored[0] !== "{") return null;
        try {
          out.push(JSON.parse(stored));
        } catch {
          return null;
        }
      }

      return out;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to query covering index range",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  async bulkInsert(docs: any[]) {
    try {
      if (docs.length === 0) return;

      const ops: Array<{ type: "put"; key: string; value: string }> = [];

      if (this.unique) {
        const seen = new Set<string>();

        for (const doc of docs) {
          const val = doc[this.field];
          if (val === undefined) continue;

          const key = this.makeUniqueKey(val);
          const docId = String(doc._id);

          if (seen.has(key)) {
            throw new LiorandbError(
              "UNIQUE_INDEX_VIOLATION",
              `Unique index violation on "${this.field}"`,
              { details: { field: this.field, value: val } }
            );
          }

          const existing = await this.getRaw(key);
          const existingId = existing ? this.decodeUniqueValueToId(existing) : "";
          if (existing && existingId !== docId) {
            throw new LiorandbError(
              "UNIQUE_INDEX_VIOLATION",
              `Unique index violation on "${this.field}"`,
              { details: { field: this.field, value: val, existingId, docId } }
            );
          }

          seen.add(key);

          // Idempotent: if already mapped to same doc, no-op.
          if (existingId === docId) continue;

          const cover = this.buildCover(doc);
          ops.push({ type: "put", key, value: cover ? JSON.stringify(cover) : docId });
        }
      } else {
        for (const doc of docs) {
          const val = doc[this.field];
          if (val === undefined) continue;

          const cover = this.buildCover(doc);
          ops.push({
            type: "put",
            key: this.makeEntryKey(val, doc._id),
            value: cover ? JSON.stringify(cover) : "1"
          });
        }
      }

      if (ops.length > 0) {
        await this.db.batch(ops);
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to bulk insert index entries",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  async close() {
    try { await this.db.close(); } catch {}
  }
}

/* ----------------------------- TEXT INDEX ----------------------------- */

const TEXT_TOKEN_PREFIX = "t:";
const TEXT_DOC_PREFIX = "d:";

function defaultTokenize(input: string, normalize: boolean): string[] {
  const s = normalize ? input.toLowerCase() : input;
  const parts = normalize
    ? s.split(/[^a-z0-9_]+/i)
    : s.split(/\s+/);
  return parts.map(p => p.trim()).filter(Boolean);
}

export class TextIndex {
  readonly field: string;
  readonly dir: string;
  readonly db: ClassicLevel<string, string>;
  readonly options: TextIndexOptions;
  private normalize: boolean;
  private stopwords: Set<string>;

  constructor(
    baseDir: string,
    field: string,
    options: TextIndexOptions = {},
    dbOptions?: {
      writeBufferSize?: number;
      cacheSize?: number;
      blockSize?: number;
      maxOpenFiles?: number;
      compression?: boolean;
    }
  ) {
    this.field = field;
    this.options = { ...options };
    this.dir = path.join(baseDir, "__indexes", field + ".textidx");
    fs.mkdirSync(this.dir, { recursive: true });
    this.db = new ClassicLevel(this.dir, { valueEncoding: "utf8", ...(dbOptions ?? {}) } as any);
    this.normalize = options.normalize ?? true;
    this.stopwords = new Set((options.stopwords ?? []).map(s => s.toLowerCase()));
  }

  private tokenizeDoc(doc: any): string[] {
    const raw = doc?.[this.field];
    const text = raw === null || raw === undefined ? "" : String(raw);
    const tokens = defaultTokenize(text, this.normalize)
      .map(t => (this.normalize ? t.toLowerCase() : t))
      .filter(t => (this.stopwords.size ? !this.stopwords.has(t) : true));
    return Array.from(new Set(tokens));
  }

  private makeTokenKey(token: string, id: string) {
    return TEXT_TOKEN_PREFIX + token + VALUE_SEPARATOR + id;
  }

  private makeDocKey(id: string) {
    return TEXT_DOC_PREFIX + id;
  }

  async insert(doc: any) {
    try {
      const id = String(doc?._id);
      if (!id) return;
      const tokens = this.tokenizeDoc(doc);
      const ops: Array<{ type: "put"; key: string; value: string }> = [];
      for (const t of tokens) {
        ops.push({ type: "put", key: this.makeTokenKey(t, id), value: "1" });
      }
      ops.push({ type: "put", key: this.makeDocKey(id), value: JSON.stringify(tokens) });
      await this.db.batch(ops);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to insert text index entry",
        details: { field: this.field }
      });
    }
  }

  async delete(doc: any) {
    try {
      const id = String(doc?._id);
      if (!id) return;
      const raw = await this.db.get(this.makeDocKey(id)).catch(() => null);
      const tokens: string[] = raw ? JSON.parse(raw) : [];
      const ops: Array<{ type: "del"; key: string }> = [];
      for (const t of tokens) {
        ops.push({ type: "del", key: this.makeTokenKey(t, id) });
      }
      ops.push({ type: "del", key: this.makeDocKey(id) });
      if (ops.length) await this.db.batch(ops as any);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to delete text index entry",
        details: { field: this.field }
      });
    }
  }

  async update(oldDoc: any, newDoc: any) {
    try {
      const oldTokens = oldDoc ? this.tokenizeDoc(oldDoc) : [];
      const newTokens = newDoc ? this.tokenizeDoc(newDoc) : [];
      if (JSON.stringify(oldTokens) === JSON.stringify(newTokens)) return;
      if (oldDoc) await this.delete(oldDoc);
      if (newDoc) await this.insert(newDoc);
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to update text index entry",
        details: { field: this.field }
      });
    }
  }

  async bulkInsert(docs: any[]) {
    for (const d of docs) {
      await this.insert(d);
    }
  }

  async search(search: string): Promise<Set<string>> {
    const tokens = defaultTokenize(search, this.normalize)
      .map(t => (this.normalize ? t.toLowerCase() : t))
      .filter(t => (this.stopwords.size ? !this.stopwords.has(t) : true));

    if (tokens.length === 0) return new Set();

    const sets: Set<string>[] = [];
    for (const token of tokens) {
      const prefix = TEXT_TOKEN_PREFIX + token + VALUE_SEPARATOR;
      const ids: string[] = [];
      for await (const [key] of this.db.iterator({ gte: prefix, lte: prefix + RANGE_END })) {
        ids.push(key.slice(prefix.length));
      }
      sets.push(new Set(ids));
    }

    sets.sort((a, b) => a.size - b.size);
    const out = new Set(sets[0]);
    for (let i = 1; i < sets.length; i++) {
      for (const id of out) {
        if (!sets[i].has(id)) out.delete(id);
      }
      if (out.size === 0) break;
    }
    return out;
  }

  async close() {
    try { await this.db.close(); } catch {}
  }
}
