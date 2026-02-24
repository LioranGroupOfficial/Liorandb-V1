import path from "path";
import fs from "fs";
import { ClassicLevel } from "classic-level";

/* ----------------------------- TYPES ----------------------------- */

export interface IndexOptions {
  unique?: boolean;
}

type IndexValue = string | string[];

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

  private normalizeKey(value: any): string {
    if (value === null || value === undefined) return "__null__";

    if (typeof value === "object") {
      return JSON.stringify(value);
    }

    return String(value);
  }

  private async getRaw(key: string): Promise<IndexValue | null> {
    try {
      const v = await this.db.get(key);
      if (v === undefined) return null;
      return JSON.parse(v);
    } catch {
      return null;
    }
  }

  private async setRaw(key: string, value: IndexValue) {
    await this.db.put(key, JSON.stringify(value));
  }

  private async delRaw(key: string) {
    try { await this.db.del(key); } catch {}
  }

  /* --------------------------- API --------------------------- */

  async insert(doc: any) {
    const val = doc[this.field];
    if (val === undefined) return;

    const key = this.normalizeKey(val);

    if (this.unique) {
      const existing = await this.getRaw(key);
      if (existing) {
        throw new Error(
          `Unique index violation on "${this.field}" = ${val}`
        );
      }

      await this.setRaw(key, doc._id);
      return;
    }

    const arr = (await this.getRaw(key)) as string[] | null;

    if (!arr) {
      await this.setRaw(key, [doc._id]);
    } else {
      if (!arr.includes(doc._id)) {
        arr.push(doc._id);
        await this.setRaw(key, arr);
      }
    }
  }

  async delete(doc: any) {
    const val = doc[this.field];
    if (val === undefined) return;

    const key = this.normalizeKey(val);

    if (this.unique) {
      await this.delRaw(key);
      return;
    }

    const arr = (await this.getRaw(key)) as string[] | null;
    if (!arr) return;

    const next = arr.filter(id => id !== doc._id);

    if (next.length === 0) {
      await this.delRaw(key);
    } else {
      await this.setRaw(key, next);
    }
  }

  async update(oldDoc: any, newDoc: any) {
    const oldVal = oldDoc?.[this.field];
    const newVal = newDoc?.[this.field];

    if (oldVal === newVal) return;

    if (oldDoc) await this.delete(oldDoc);
    if (newDoc) await this.insert(newDoc);
  }

  async find(value: any): Promise<string[]> {
    const key = this.normalizeKey(value);

    const raw = await this.getRaw(key);
    if (!raw) return [];

    if (this.unique) return [raw as string];

    return raw as string[];
  }

  async close() {
    try { await this.db.close(); } catch {}
  }
}