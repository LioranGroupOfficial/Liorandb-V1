import fs from "fs";
import path from "path";
import { manager } from "../config/database";

const DB_META = "__db_meta.json";

export async function logDiskIntegrityWarnings() {
  try {
    const root = manager.rootPath;
    if (!fs.existsSync(root)) return;

    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (name.startsWith(".")) continue;

      const dbPath = path.join(root, name);
      const metaPath = path.join(dbPath, DB_META);
      if (!fs.existsSync(metaPath)) {
        console.warn(`[integrity] missing ${DB_META} for db "${name}" (${dbPath})`);
      }

      const walDir = path.join(dbPath, "__wal");
      if (fs.existsSync(walDir)) {
        try {
          const walFiles = (await fs.promises.readdir(walDir)).filter((f) => /^wal-\d+\.log$/.test(f));
          if (walFiles.length === 0) {
            console.warn(`[integrity] empty __wal directory for db "${name}" (${walDir})`);
          }
        } catch {}
      }
    }
  } catch (error) {
    console.warn("[integrity] scan failed:", error);
  }
}

