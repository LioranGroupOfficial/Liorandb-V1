import fs from "fs";
import path from "path";

/* =========================
   TYPES
========================= */

export interface CheckpointData {
  lsn: number;        // Last durable LSN
  walGen: number;     // WAL generation at checkpoint
  time: number;       // Timestamp (ms)
  version: number;    // Format version
}

interface StoredCheckpoint {
  data: CheckpointData;
  crc: number;
}

/* =========================
   CONSTANTS
========================= */

const CHECKPOINT_A = "__checkpoint_A.json";
const CHECKPOINT_B = "__checkpoint_B.json";
const FORMAT_VERSION = 1;

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
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < input.length; i++) {
    crc = CRC32_TABLE[(crc ^ input.charCodeAt(i)) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

/* =========================
   CHECKPOINT MANAGER
========================= */

export class CheckpointManager {
  private baseDir: string;
  private data: CheckpointData;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.data = {
      lsn: 0,
      walGen: 1,
      time: 0,
      version: FORMAT_VERSION
    };

    this.load();
  }

  /* -------------------------
     LOAD (CRC + FALLBACK)
  ------------------------- */

  private load() {
    const a = this.readCheckpoint(CHECKPOINT_A);
    const b = this.readCheckpoint(CHECKPOINT_B);

    if (a && b) {
      // pick newest valid checkpoint
      this.data = a.data.lsn >= b.data.lsn ? a.data : b.data;
      return;
    }

    if (a) {
      this.data = a.data;
      return;
    }

    if (b) {
      this.data = b.data;
      return;
    }

    console.warn("No valid checkpoint found, starting from zero");
  }

  private readCheckpoint(file: string): StoredCheckpoint | null {
    const filePath = path.join(this.baseDir, file);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as StoredCheckpoint;

      if (!parsed?.data || typeof parsed.crc !== "number") {
        return null;
      }

      const expected = crc32(JSON.stringify(parsed.data));
      if (expected !== parsed.crc) {
        console.error(`Checkpoint CRC mismatch: ${file}`);
        return null;
      }

      return parsed;
    } catch {
      return null;
    }
  }

  /* -------------------------
     SAVE (DUAL WRITE)
  ------------------------- */

  save(lsn: number, walGen: number) {
    const data: CheckpointData = {
      lsn,
      walGen,
      time: Date.now(),
      version: FORMAT_VERSION
    };

    const stored: StoredCheckpoint = {
      data,
      crc: crc32(JSON.stringify(data))
    };

    // alternate between A/B for crash safety
    const target =
      lsn % 2 === 0 ? CHECKPOINT_A : CHECKPOINT_B;

    try {
      fs.writeFileSync(
        path.join(this.baseDir, target),
        JSON.stringify(stored, null, 2),
        "utf8"
      );
      this.data = data;
    } catch (err) {
      console.error("Failed to write checkpoint:", err);
    }
  }

  /* -------------------------
     GET CURRENT
  ------------------------- */

  get(): CheckpointData {
    return this.data;
  }
}