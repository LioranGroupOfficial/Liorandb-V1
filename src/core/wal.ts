import fs from "fs";
import path from "path";

/* =========================
   WAL RECORD TYPES
========================= */

export type WALRecord =
  | { lsn: number; tx: number; type: "op"; payload: any }
  | { lsn: number; tx: number; type: "commit" }
  | { lsn: number; tx: number; type: "applied" };

type StoredRecord = WALRecord & { crc: number };

/* =========================
   CONSTANTS
========================= */

const MAX_WAL_SIZE = 16 * 1024 * 1024; // 16 MB
const WAL_DIR = "__wal";

/* =========================
   CRC32 IMPLEMENTATION
   (no dependencies)
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
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < input.length; i++) {
    const byte = input.charCodeAt(i);
    crc = CRC32_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* =========================
   WAL MANAGER
========================= */

export class WALManager {
  private walDir: string;
  private currentGen = 1;
  private lsn = 0;
  private fd: fs.promises.FileHandle | null = null;

  constructor(baseDir: string) {
    this.walDir = path.join(baseDir, WAL_DIR);
    fs.mkdirSync(this.walDir, { recursive: true });
    this.currentGen = this.detectLastGeneration();
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
      if (m) max = Math.max(max, Number(m[1]));
    }

    return max || 1;
  }

  private async open() {
    if (!this.fd) {
      this.fd = await fs.promises.open(this.walPath(), "a");
    }
  }

  private async rotate() {
    if (this.fd) {
      await this.fd.close();
      this.fd = null;
    }
    this.currentGen++;
  }

  /* -------------------------
     APPEND
  ------------------------- */

  async append(record: Omit<WALRecord, "lsn">): Promise<number> {
    await this.open();

    const full: WALRecord = {
      ...(record as any),
      lsn: ++this.lsn
    };

    const body = JSON.stringify(full);
    const stored: StoredRecord = {
      ...full,
      crc: crc32(body)
    };

    await this.fd!.write(JSON.stringify(stored) + "\n");
    await this.fd!.sync();

    const stat = await this.fd!.stat();
    if (stat.size >= MAX_WAL_SIZE) {
      await this.rotate();
    }

    return full.lsn;
  }

  /* -------------------------
     REPLAY
  ------------------------- */

  async replay(
    fromLSN: number,
    apply: (r: WALRecord) => Promise<void>
  ): Promise<void> {
    if (!fs.existsSync(this.walDir)) return;

    const files = fs
      .readdirSync(this.walDir)
      .filter(f => f.startsWith("wal-"))
      .sort();

    for (const file of files) {
      const filePath = path.join(this.walDir, file);
      const data = fs.readFileSync(filePath, "utf8");
      const lines = data.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line.trim()) continue;

        let parsed: StoredRecord;
        try {
          parsed = JSON.parse(line);
        } catch {
          console.error("WAL parse error, stopping replay");
          return;
        }

        const { crc, ...record } = parsed;
        const expected = crc32(JSON.stringify(record));

        if (expected !== crc) {
          console.error(
            "WAL checksum mismatch, stopping replay",
            { file, line: i + 1 }
          );
          return;
        }

        if (record.lsn <= fromLSN) continue;

        this.lsn = Math.max(this.lsn, record.lsn);
        await apply(record);
      }
    }
  }

  /* -------------------------
     CLEANUP
  ------------------------- */

  async cleanup(beforeGen: number) {
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
}