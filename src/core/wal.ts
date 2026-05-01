import fs from "fs";
import path from "path";
import {
  decryptStringWithKey,
  encryptStringWithKey,
  getEncryptionKey
} from "../utils/encryption.js";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

export type WALFlushStrategy = "immediate" | "batch" | "async";

export type WALDurabilityOptions = {
  flushStrategy?: WALFlushStrategy;
  batch?: {
    maxRecords?: number;
    maxDelayMs?: number;
  };
};

/* =========================
   WAL RECORD TYPES
========================= */

export type WALRecord =
  | { lsn: number; tx: number; time?: number; type: "op"; payload: any }
  | { lsn: number; tx: number; time?: number; type: "commit" }
  | { lsn: number; tx: number; time?: number; type: "applied" };

type StoredRecord = WALRecord & { crc: number };
type EncryptedStoredRecord = { v: 2; enc: string };

/* =========================
   CONSTANTS
========================= */

const MAX_WAL_SIZE = 16 * 1024 * 1024; // 16MB
const WAL_DIR = "__wal";
const WAL_FRAME_MAGIC = Buffer.from("LWA3");
const WAL_FRAME_HEADER_BYTES = 12; // magic(4) + len(4) + crc(4)

/* =========================
   CRC32 (no deps)
========================= */

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(input: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc = CRC32_TABLE[(crc ^ input.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function encodeFrame(payload: string): Buffer {
  const payloadBytes = Buffer.from(payload, "utf8");
  const header = Buffer.allocUnsafe(WAL_FRAME_HEADER_BYTES);
  WAL_FRAME_MAGIC.copy(header, 0);
  header.writeUInt32BE(payloadBytes.length >>> 0, 4);
  header.writeUInt32BE(crc32(payload), 8);
  return Buffer.concat([header, payloadBytes]);
}

function decodeFramedRecords(fileBytes: Buffer): { lines: string[]; validOffset: number } {
  const lines: string[] = [];
  let offset = 0;

  while (offset + WAL_FRAME_HEADER_BYTES <= fileBytes.length) {
    if (!fileBytes.subarray(offset, offset + 4).equals(WAL_FRAME_MAGIC)) {
      break;
    }

    const len = fileBytes.readUInt32BE(offset + 4);
    const expectedCrc = fileBytes.readUInt32BE(offset + 8);
    const start = offset + WAL_FRAME_HEADER_BYTES;
    const end = start + len;

    if (end > fileBytes.length) {
      break; // partial frame
    }

    const payloadBytes = fileBytes.subarray(start, end);
    const payload = payloadBytes.toString("utf8");
    if ((crc32(payload) >>> 0) !== (expectedCrc >>> 0)) {
      break; // corruption or partial write
    }

    lines.push(payload);
    offset = end;
  }

  return { lines, validOffset: offset };
}

/* =========================
   WAL MANAGER
========================= */

export class WALManager {
  private walDir: string;
  private currentGen = 1;
  private lsn = 0;
  private fd: fs.promises.FileHandle | null = null;
  private openPromise: Promise<void> | null = null;
  private readonlyMode: boolean;
  private durability: {
    flushStrategy: WALFlushStrategy;
    batch: { maxRecords: number; maxDelayMs: number };
  };
  private pendingSinceSync = 0;
  private syncTimer: NodeJS.Timeout | null = null;
  private fsyncTail: Promise<void> = Promise.resolve();

  constructor(
    baseDir: string,
    options?: { readonly?: boolean; durability?: WALDurabilityOptions }
  ) {
    this.walDir = path.join(baseDir, WAL_DIR);
    this.readonlyMode = options?.readonly ?? false;
    this.durability = {
      flushStrategy: options?.durability?.flushStrategy ?? "immediate",
      batch: {
        maxRecords: Math.max(1, Math.trunc(options?.durability?.batch?.maxRecords ?? 128)),
        maxDelayMs: Math.max(0, Math.trunc(options?.durability?.batch?.maxDelayMs ?? 10))
      }
    };

    if (!this.readonlyMode) {
      fs.mkdirSync(this.walDir, { recursive: true });
    }

    if (fs.existsSync(this.walDir)) {
      this.currentGen = this.detectLastGeneration();
      this.recoverLSNFromExistingLogs();
    }
  }

  /* -------------------------
     INTERNAL HELPERS
  ------------------------- */

  private walPath(gen = this.currentGen) {
    return path.join(
      this.walDir,
      `wal-${String(gen).padStart(6, "0")}.log`
    );
  }

  private detectLastGeneration(): number {
    if (!fs.existsSync(this.walDir)) return 1;

    const files = fs.readdirSync(this.walDir);
    let max = 0;

    for (const f of files) {
      const m = f.match(/^wal-(\d+)\.log$/);
      if (m) {
        const gen = Number(m[1]);
        if (!Number.isNaN(gen)) {
          max = Math.max(max, gen);
        }
      }
    }

    return max || 1;
  }

  private recoverLSNFromExistingLogs() {
    const files = this.getSortedWalFiles();

    for (const file of files) {
      const filePath = path.join(this.walDir, file);
      const fileBytes = fs.readFileSync(filePath);
      const isFramed = fileBytes.length >= 4 && fileBytes.subarray(0, 4).equals(WAL_FRAME_MAGIC);

      const lines = isFramed
        ? decodeFramedRecords(fileBytes).lines
        : fileBytes.toString("utf8").split("\n");

      for (const line of lines) {
        if (!line.trim()) continue;

        const record = this.decodeLine(line, getEncryptionKey());
        if (!record) {
          break;
        }

        this.lsn = Math.max(this.lsn, record.lsn);
      }
    }
  }

  private getSortedWalFiles(): string[] {
    if (!fs.existsSync(this.walDir)) return [];

    return fs
      .readdirSync(this.walDir)
      .filter(f => /^wal-\d+\.log$/.test(f))
      .sort((a, b) => {
        const ga = Number(a.match(/^wal-(\d+)\.log$/)![1]);
        const gb = Number(b.match(/^wal-(\d+)\.log$/)![1]);
        return ga - gb;
      });
  }

  private async open() {
    if (this.readonlyMode) {
      throw new LiorandbError("READONLY_MODE", "WAL is in readonly replica mode");
    }

    if (this.fd) return;
    if (this.openPromise) return this.openPromise;

    this.openPromise = (async () => {
      this.fd = await fs.promises.open(this.walPath(), "a");
    })();

    try {
      await this.openPromise;
    } finally {
      this.openPromise = null;
    }
  }

  private queueFsync(): Promise<void> {
    if (!this.fd) return Promise.resolve();

    this.fsyncTail = this.fsyncTail.then(async () => {
      if (!this.fd) return;
      await this.fd.sync();
      this.pendingSinceSync = 0;
    });

    return this.fsyncTail;
  }

  private requestFlush(): void {
    if (this.readonlyMode) return;
    if (!this.fd) return;

    if (this.durability.flushStrategy === "immediate" || this.durability.flushStrategy === "async") {
      this.queueFsync().catch(() => {});
      return;
    }

    // batch
    if (this.pendingSinceSync >= this.durability.batch.maxRecords) {
      this.queueFsync().catch(() => {});
      return;
    }

    if (!this.syncTimer) {
      const ms = this.durability.batch.maxDelayMs;
      this.syncTimer = setTimeout(() => {
        this.syncTimer = null;
        this.queueFsync().catch(() => {});
      }, ms);
      this.syncTimer.unref?.();
    }
  }

  async flush(): Promise<void> {
    if (this.syncTimer) {
      clearTimeout(this.syncTimer);
      this.syncTimer = null;
    }
    await this.queueFsync();
  }

  private async rotate() {
    if (this.readonlyMode) return;

    if (this.fd) {
      await this.flush();
      await this.fd.close();
      this.fd = null;
    }
    this.currentGen++;
  }

  async close(): Promise<void> {
    if (this.openPromise) {
      try { await this.openPromise; } catch {}
      this.openPromise = null;
    }
    if (this.fd) {
      try {
        await this.flush();
      } catch {}
      try {
        await this.fd.close();
      } catch {}
      this.fd = null;
    }
  }

  private encodeRecord(record: WALRecord, key = getEncryptionKey()) {
    const payload: StoredRecord = {
      ...record,
      crc: crc32(JSON.stringify(record))
    };

    const encrypted: EncryptedStoredRecord = {
      v: 2,
      enc: encryptStringWithKey(JSON.stringify(payload), key)
    };

    return JSON.stringify(encrypted) + "\n";
  }

  private decodeLegacyLine(line: string): WALRecord | null {
    try {
      const parsed: StoredRecord = JSON.parse(line);
      const { crc, ...record } = parsed;

      if (crc32(JSON.stringify(record)) !== crc) {
        return null;
      }

      return record;
    } catch {
      return null;
    }
  }

  private decodeLine(line: string, key = getEncryptionKey()): WALRecord | null {
    try {
      const wrapper = JSON.parse(line) as EncryptedStoredRecord;
      if (wrapper && wrapper.v === 2 && typeof wrapper.enc === "string") {
        const raw = decryptStringWithKey(wrapper.enc, key);
        const parsed = JSON.parse(raw) as StoredRecord;
        const { crc, ...record } = parsed;

        if (crc32(JSON.stringify(record)) !== crc) {
          return null;
        }

        return record;
      }
    } catch {}

    return this.decodeLegacyLine(line);
  }

  /* -------------------------
     APPEND (Primary only)
  ------------------------- */

  async append(
    record: Omit<WALRecord, "lsn">,
    options: { flush?: "none" | "request" | "await" } = {}
  ): Promise<number> {
    try {
      if (this.readonlyMode) {
        throw new LiorandbError("READONLY_MODE", "Cannot append WAL in readonly replica mode");
      }

      await this.open();

      const full: WALRecord = {
        ...(record as any),
        lsn: ++this.lsn
      };

      const line = this.encodeRecord(full).trimEnd();
      const frame = encodeFrame(line);
      await this.fd!.write(frame);
      this.pendingSinceSync++;

      const flushMode = options.flush ?? "await";
      if (flushMode === "await") {
        await this.flush();
      } else if (flushMode === "request") {
        this.requestFlush();
      }

      const stat = await this.fd!.stat();
      if (stat.size >= MAX_WAL_SIZE) {
        await this.rotate();
      }

      return full.lsn;
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "Failed to append WAL record",
        details: { walDir: this.walDir }
      });
    }
  }

  /* -------------------------
     REPLAY (Replica allowed)
  ------------------------- */

  async replay(
    fromLSN: number,
    apply: (r: WALRecord) => Promise<void>
  ): Promise<void> {
    try {
      if (!fs.existsSync(this.walDir)) return;

      const files = this.getSortedWalFiles();

      for (const file of files) {
        const filePath = path.join(this.walDir, file);

        const fd = fs.openSync(
          filePath,
          this.readonlyMode ? "r" : "r+"
        );

        const fileBytes = fs.readFileSync(filePath);
        const isFramed = fileBytes.length >= 4 && fileBytes.subarray(0, 4).equals(WAL_FRAME_MAGIC);

        let lines: string[] = [];
        let validOffset = 0;

        if (isFramed) {
          const decoded = decodeFramedRecords(fileBytes);
          lines = decoded.lines;
          validOffset = decoded.validOffset;
        } else {
          const content = fileBytes.toString("utf8");
          const rawLines = content.split("\n");

          let offset = 0;
          for (const rawLine of rawLines) {
            // Account for the exact bytes present on disk (including if final newline is missing).
            const lineBytes = Buffer.byteLength(rawLine, "utf8");
            const hasNewline = offset + lineBytes < fileBytes.length && fileBytes[offset + lineBytes] === 0x0a;
            const advance = lineBytes + (hasNewline ? 1 : 0);

            if (!rawLine.trim()) {
              offset += advance;
              validOffset = offset;
              continue;
            }

            const record = this.decodeLine(rawLine);
            if (!record) {
              break;
            }

            lines.push(rawLine);
            offset += advance;
            validOffset = offset;
          }
        }

        for (const line of lines) {
          const record = this.decodeLine(line);
          if (!record) break;

          if (record.lsn <= fromLSN) continue;
          this.lsn = Math.max(this.lsn, record.lsn);
          await apply(record);
        }

        if (!this.readonlyMode) {
          const stat = fs.fstatSync(fd);
          if (validOffset < stat.size) {
            fs.ftruncateSync(fd, validOffset);
          }
        }

        fs.closeSync(fd);
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "WAL replay failed",
        details: { walDir: this.walDir, fromLSN }
      });
    }
  }

  async read(fromLSN: number, limit = 10_000): Promise<{ records: WALRecord[]; lastLSN: number }> {
    const records: WALRecord[] = [];
    let lastLSN = fromLSN;

    await this.replay(fromLSN, async r => {
      records.push(r);
      lastLSN = Math.max(lastLSN, r.lsn);
      if (records.length >= limit) {
        // Abort replay early (caught below)
        throw new LiorandbError("INTERNAL", "__WAL_READ_LIMIT__");
      }
    }).catch(err => {
      if (err instanceof LiorandbError && err.message === "__WAL_READ_LIMIT__") {
        return;
      }
      throw err;
    });

    return { records, lastLSN };
  }

  /* -------------------------
     CLEANUP (Primary only)
  ------------------------- */

  async cleanup(beforeGen: number) {
    try {
      if (this.readonlyMode) return;
      if (!fs.existsSync(this.walDir)) return;

      const files = fs.readdirSync(this.walDir);

      for (const f of files) {
        const m = f.match(/^wal-(\d+)\.log$/);
        if (!m) continue;

        const gen = Number(m[1]);
        if (gen < beforeGen) {
          fs.unlinkSync(path.join(this.walDir, f));
        }
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "IO_ERROR",
        message: "WAL cleanup failed",
        details: { walDir: this.walDir, beforeGen }
      });
    }
  }

  /* -------------------------
     GETTERS
  ------------------------- */

  getCurrentLSN() {
    return this.lsn;
  }

  getCurrentGen() {
    return this.currentGen;
  }

  isReadonly() {
    return this.readonlyMode;
  }

  async rotateEncryptionKey(oldKey: Buffer, newKey: Buffer) {
    try {
      if (this.readonlyMode || !fs.existsSync(this.walDir)) return;

      if (this.fd) {
        await this.fd.sync();
        await this.fd.close();
        this.fd = null;
      }

      const files = this.getSortedWalFiles();

      for (const file of files) {
        const filePath = path.join(this.walDir, file);
        const fileBytes = fs.readFileSync(filePath);
        const isFramed = fileBytes.length >= 4 && fileBytes.subarray(0, 4).equals(WAL_FRAME_MAGIC);

        const lines = isFramed
          ? decodeFramedRecords(fileBytes).lines
          : fileBytes.toString("utf8").split("\n");

        if (isFramed) {
          const frames: Buffer[] = [];
          for (const line of lines) {
            if (!line.trim()) continue;

            const record = this.decodeLine(line, oldKey);
            if (!record) {
              throw new LiorandbError("CORRUPTION", `Failed to decrypt WAL record in ${file}`, {
                details: { file }
              });
            }

            frames.push(encodeFrame(this.encodeRecord(record, newKey).trimEnd()));
          }
          fs.writeFileSync(filePath, Buffer.concat(frames));
        } else {
          const nextLines: string[] = [];
          for (const line of lines) {
            if (!line.trim()) continue;

            const record = this.decodeLine(line, oldKey);
            if (!record) {
              throw new LiorandbError("CORRUPTION", `Failed to decrypt WAL record in ${file}`, {
                details: { file }
              });
            }

            nextLines.push(this.encodeRecord(record, newKey).trimEnd());
          }
          fs.writeFileSync(filePath, nextLines.join("\n") + (nextLines.length ? "\n" : ""), "utf8");
        }
      }
    } catch (err) {
      throw asLiorandbError(err, {
        code: "ENCRYPTION_ERROR",
        message: "WAL re-encryption failed",
        details: { walDir: this.walDir }
      });
    }
  }
}
