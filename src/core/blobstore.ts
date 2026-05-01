import fs from "fs";
import path from "path";
import { v4 as uuid } from "uuid";
import { encryptString, decryptString } from "../utils/encryption.js";
import { asLiorandbError, LiorandbError } from "../utils/errors.js";

export type BlobRef = { __blob: { id: string } };

export type TieredStorageOptions = {
  fields: string[];
  thresholdBytes?: number;
};

const BLOB_DIR = "__blobs";

function isBlobRef(v: any): v is BlobRef {
  return !!v && typeof v === "object" && "__blob" in v && typeof v.__blob?.id === "string";
}

export class BlobStore {
  readonly dir: string;
  readonly thresholdBytes: number;
  private fields: Set<string>;

  constructor(collectionDir: string, options: TieredStorageOptions) {
    this.dir = path.join(collectionDir, BLOB_DIR);
    this.thresholdBytes = Math.max(1, Math.trunc(options.thresholdBytes ?? 8 * 1024));
    this.fields = new Set((options.fields ?? []).map(String));
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private blobPath(id: string) {
    return path.join(this.dir, `${id}.blob`);
  }

  shouldExternalizeField(field: string) {
    return this.fields.has(field);
  }

  externalizeDoc(doc: any): { doc: any; created: Array<{ field: string; id: string }>; removed: string[] } {
    const next = structuredClone(doc);
    const created: Array<{ field: string; id: string }> = [];
    const removed: string[] = [];

    for (const field of this.fields) {
      const value = next?.[field];
      if (value === undefined) continue;

      if (isBlobRef(value)) {
        continue;
      }

      const raw = typeof value === "string" ? value : JSON.stringify(value);
      const bytes = Buffer.byteLength(raw, "utf8");
      if (bytes < this.thresholdBytes) continue;

      const id = uuid();
      const enc = encryptString(raw);
      fs.writeFileSync(this.blobPath(id), enc, "utf8");
      next[field] = { __blob: { id } };
      created.push({ field, id });
    }

    return { doc: next, created, removed };
  }

  hydrateDoc(doc: any): any {
    if (!doc || typeof doc !== "object") return doc;
    const next = structuredClone(doc);
    for (const field of this.fields) {
      const value = next?.[field];
      if (!isBlobRef(value)) continue;
      const id = value.__blob.id;
      try {
        const enc = fs.readFileSync(this.blobPath(id), "utf8");
        const raw = decryptString(enc);
        try {
          next[field] = JSON.parse(raw);
        } catch {
          next[field] = raw;
        }
      } catch (err) {
        throw asLiorandbError(err, {
          code: "IO_ERROR",
          message: "Failed to read externalized blob",
          details: { field, id }
        });
      }
    }
    return next;
  }

  collectBlobIds(doc: any): string[] {
    if (!doc || typeof doc !== "object") return [];
    const ids: string[] = [];
    for (const field of this.fields) {
      const value = doc?.[field];
      if (isBlobRef(value)) ids.push(value.__blob.id);
    }
    return ids;
  }

  deleteBlobs(ids: string[]) {
    for (const id of ids) {
      try {
        fs.unlinkSync(this.blobPath(id));
      } catch {}
    }
  }

  validateConfig() {
    if (this.fields.size === 0) {
      throw new LiorandbError("VALIDATION_FAILED", "Tiered storage requires at least one field", {
        details: { fields: [] }
      });
    }
  }
}

