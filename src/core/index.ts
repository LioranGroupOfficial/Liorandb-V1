import path from "path";
import fs from "fs";
import { ClassicLevel } from "classic-level";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

/* ----------------------------- TYPES ----------------------------- */

export interface IndexOptions {
  unique?: boolean;
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
  readonly dir: string;
  readonly db: ClassicLevel<string, string>;

  constructor(baseDir: string, field: string, options: IndexOptions = {}) {
    this.field = field;
    this.unique = !!options.unique;

    this.dir = path.join(baseDir, "__indexes", field + ".idx");
    fs.mkdirSync(this.dir, { recursive: true });

    this.db = new ClassicLevel(this.dir, { valueEncoding: "utf8" });
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

  async insert(doc: any) {
    try {
      const val = doc[this.field];
      if (val === undefined) return;

      if (this.unique) {
        const key = this.makeUniqueKey(val);
        const existing = await this.getRaw(key);
        if (existing) {
          throw new LiorandbError(
            "UNIQUE_INDEX_VIOLATION",
            `Unique index violation on "${this.field}"`,
            { details: { field: this.field, value: val, existingId: existing } }
          );
        }

        await this.setRaw(key, String(doc._id));
        return;
      }

      await this.setRaw(this.makeEntryKey(val, doc._id), "1");
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
        await this.delRaw(this.makeUniqueKey(val));
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
      if (this.unique) {
        const raw = await this.getRaw(this.makeUniqueKey(value));
        return raw ? [raw] : [];
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
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to query index",
        details: { field: this.field, unique: this.unique }
      });
    }
  }

  async findRange(cond: any): Promise<string[]> {
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
      const ids: string[] = [];

      for await (const [key, value] of this.db.iterator({
        gte: prefix + normalizedGte,
        lte: prefix + normalizedLte
      })) {
        if (this.unique) {
          ids.push(value);
          continue;
        }

        const separatorAt = key.lastIndexOf(VALUE_SEPARATOR);
        ids.push(key.slice(separatorAt + VALUE_SEPARATOR.length));
      }

      return ids;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to query index range",
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
          if (seen.has(key) || await this.getRaw(key)) {
            throw new LiorandbError(
              "UNIQUE_INDEX_VIOLATION",
              `Unique index violation on "${this.field}"`,
              { details: { field: this.field, value: val } }
            );
          }

          seen.add(key);
          ops.push({ type: "put", key, value: String(doc._id) });
        }
      } else {
        for (const doc of docs) {
          const val = doc[this.field];
          if (val === undefined) continue;

          ops.push({
            type: "put",
            key: this.makeEntryKey(val, doc._id),
            value: "1"
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
