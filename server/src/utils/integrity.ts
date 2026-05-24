import fs from "fs";
import path from "path";
import { manager } from "../config/database.js";

const DB_META = "__db_meta.json";

function toBool(raw: unknown, defaultValue = false) {
  if (raw === undefined || raw === null) return defaultValue;
  const v = String(raw).trim().toLowerCase();
  if (v === "") return defaultValue;
  if (v === "1" || v === "true" || v === "yes" || v === "y" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "n" || v === "off") return false;
  return defaultValue;
}

function shouldSkipDb(name: string) {
  if (name.startsWith(".")) return true;
  if (!toBool(process.env.LIORANDB_SINGLE_NODE, false)) return false;
  return name === "__cluster_nodes";
}

export async function logDiskIntegrityWarnings() {
  try {
    const root = manager.rootPath;
    if (!fs.existsSync(root)) return;

    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const name = entry.name;
      if (shouldSkipDb(name)) continue;

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


