import fs from "fs";
import path from "path";
import {
  decryptStringWithKey,
  encryptStringWithKey,
  getEncryptionKey
} from "../utils/encryption.js";

/* =========================
   WAL RECORD TYPES
========================= */

export type WALRecord =
  | { lsn: number; tx: number; type: "op"; payload: any }
  | { lsn: number; tx: number; type: "commit" }
  | { lsn: number; tx: number; type: "applied" };

type StoredRecord = WALRecord & { crc: number };
type EncryptedStoredRecord = { v: 2; enc: string };

/* =========================
   CONSTANTS
========================= */

const MAX_WAL_SIZE = 16 * 1024 * 1024; // 16MB
const WAL_DIR = "__wal";

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

/* =========================
   WAL MANAGER
========================= */

export class WALManager {
  private walDir: string;
  private currentGen = 1;
  private lsn = 0;
  private fd: fs.promises.FileHandle | null = null;
  private readonlyMode: boolean;

  constructor(baseDir: string, options?: { readonly?: boolean }) {
    this.walDir = path.join(baseDir, WAL_DIR);
    this.readonlyMode = options?.readonly ?? false;

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
      const lines = fs.readFileSync(filePath, "utf8").split("\n");

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
      throw new Error("WAL is in readonly replica mode");
    }

    if (!this.fd) {
      this.fd = await fs.promises.open(this.walPath(), "a");
    }
  }

  private async rotate() {
    if (this.readonlyMode) return;

    if (this.fd) {
      await this.fd.sync();
      await this.fd.close();
      this.fd = null;
    }
    this.currentGen++;
  }

  async close(): Promise<void> {
    if (this.fd) {
      try {
        await this.fd.sync();
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

  async append(record: Omit<WALRecord, "lsn">): Promise<number> {
    if (this.readonlyMode) {
      throw new Error("Cannot append WAL in readonly replica mode");
    }

    await this.open();

    const full: WALRecord = {
      ...(record as any),
      lsn: ++this.lsn
    };

    const line = this.encodeRecord(full);

    await this.fd!.write(line);
    await this.fd!.sync();

    const stat = await this.fd!.stat();
    if (stat.size >= MAX_WAL_SIZE) {
      await this.rotate();
    }

    return full.lsn;
  }

  /* -------------------------
     REPLAY (Replica allowed)
  ------------------------- */

  async replay(
    fromLSN: number,
    apply: (r: WALRecord) => Promise<void>
  ): Promise<void> {
    if (!fs.existsSync(this.walDir)) return;

    const files = this.getSortedWalFiles();

    for (const file of files) {
      const filePath = path.join(this.walDir, file);

      const fd = fs.openSync(
        filePath,
        this.readonlyMode ? "r" : "r+"
      );

      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n");

      let validOffset = 0;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) {
          validOffset += line.length + 1;
          continue;
        }

        const record = this.decodeLine(line);
        if (!record) {
          break;
        }

        validOffset += line.length + 1;

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
  }

  /* -------------------------
     CLEANUP (Primary only)
  ------------------------- */

  async cleanup(beforeGen: number) {
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
    if (this.readonlyMode || !fs.existsSync(this.walDir)) return;

    if (this.fd) {
      await this.fd.sync();
      await this.fd.close();
      this.fd = null;
    }

    const files = this.getSortedWalFiles();

    for (const file of files) {
      const filePath = path.join(this.walDir, file);
      const lines = fs.readFileSync(filePath, "utf8").split("\n");
      const nextLines: string[] = [];

      for (const line of lines) {
        if (!line.trim()) continue;

        const record = this.decodeLine(line, oldKey);
        if (!record) {
          throw new Error(`Failed to decrypt WAL record in ${file}`);
        }

        nextLines.push(this.encodeRecord(record, newKey).trimEnd());
      }

      fs.writeFileSync(filePath, nextLines.join("\n") + (nextLines.length ? "\n" : ""), "utf8");
    }
  }
}
