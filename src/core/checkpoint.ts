import fs from "fs";
import path from "path";

/* =========================
   TYPES
========================= */

export interface CheckpointData {
  lsn: number;        // Last durable LSN
  walGen: number;     // WAL generation at checkpoint
  time: number;       // Timestamp (ms)
  version: number;    // For future format upgrades
}

/* =========================
   CONSTANTS
========================= */

const CHECKPOINT_FILE = "__checkpoint.json";
const TMP_SUFFIX = ".tmp";
const FORMAT_VERSION = 1;

/* =========================
   CHECKPOINT MANAGER
========================= */

export class CheckpointManager {
  private filePath: string;
  private data: CheckpointData;

  constructor(baseDir: string) {
    this.filePath = path.join(baseDir, CHECKPOINT_FILE);
    this.data = {
      lsn: 0,
      walGen: 1,
      time: 0,
      version: FORMAT_VERSION
    };

    this.load();
  }

  /* -------------------------
     LOAD (Crash-safe)
  ------------------------- */

  private load() {
    if (!fs.existsSync(this.filePath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as CheckpointData;

      if (
        typeof parsed.lsn === "number" &&
        typeof parsed.walGen === "number"
      ) {
        this.data = parsed;
      }
    } catch {
      console.error("Checkpoint corrupted, starting from zero");
      this.data = {
        lsn: 0,
        walGen: 1,
        time: 0,
        version: FORMAT_VERSION
      };
    }
  }

  /* -------------------------
     SAVE (Atomic Write)
  ------------------------- */

  save(lsn: number, walGen: number) {
    const newData: CheckpointData = {
      lsn,
      walGen,
      time: Date.now(),
      version: FORMAT_VERSION
    };

    const tmpPath = this.filePath + TMP_SUFFIX;

    try {
      // Write to temp file first
      fs.writeFileSync(
        tmpPath,
        JSON.stringify(newData, null, 2),
        { encoding: "utf8" }
      );

      // Atomic rename
      fs.renameSync(tmpPath, this.filePath);

      this.data = newData;
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