const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createRequire } = require("node:module");
const sea = require("node:sea");

if (!sea.isSea()) {
  console.error("Not running inside SEA");
  process.exit(1);
}

const APP_NAME = "ldb-runtime";
const APP_VERSION = "1.0.0";

/**
 * Use versioned temp dir so updates refresh automatically
 */
const tmpDir = path.join(
  os.tmpdir(),
  APP_NAME,
  APP_VERSION
);

/**
 * Marker file to prevent re-extraction every run
 */
const marker = path.join(tmpDir, ".extracted");

if (!fs.existsSync(marker)) {
  fs.mkdirSync(tmpDir, { recursive: true });

  console.log("Extracting runtime files...");

  for (const key of sea.getAssetKeys()) {
    if (key === "entry.txt") continue;

    const filePath = path.join(tmpDir, key);

    fs.mkdirSync(
      path.dirname(filePath),
      { recursive: true }
    );

    const data = sea.getRawAsset(key);

    fs.writeFileSync(
      filePath,
      new Uint8Array(data)
    );
  }

  fs.writeFileSync(marker, "ok");
}

/**
 * Read entry file
 */
const entry = sea
  .getAsset("entry.txt", "utf8")
  .trim();

const entryPath = path.join(tmpDir, entry);

if (!fs.existsSync(entryPath)) {
  console.error("Entry not found:", entry);
  process.exit(1);
}

/**
 * CRITICAL for node_modules resolution
 */
process.chdir(tmpDir);

/**
 * Make require resolve from extracted runtime
 */
const requireFromTmp =
  createRequire(entryPath);

requireFromTmp(entryPath);