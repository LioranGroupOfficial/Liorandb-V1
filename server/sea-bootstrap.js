const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createRequire } =
  require("node:module");
const sea = require("node:sea");

if (!sea.isSea()) {
  console.error(
    "Not running inside SEA"
  );
  process.exit(1);
}

// const PKG = require("./package.json");

const APP_NAME = "ldb-runtime";

const APP_VERSION =
  "1.1.6";
  // PKG.version;

/**
 * Shared runtime directory
 *
 * Windows:
 * C:\Users\<user>\ldb-runtime\<version>
 *
 * Mac:
 * ~/ldb-runtime/<version>
 *
 * Linux:
 * ~/ldb-runtime/<version>
 */

const runtimeDir =
  path.join(
    os.homedir(),
    APP_NAME,
    APP_VERSION
  );

const marker =
  path.join(
    runtimeDir,
    ".extracted"
  );

if (!fs.existsSync(marker)) {
  fs.mkdirSync(
    runtimeDir,
    {
      recursive: true,
    }
  );

  console.log(
    "Extracting runtime files..."
  );

  for (const key of sea.getAssetKeys()) {
    if (key === "entry.txt")
      continue;

    const filePath =
      path.join(
        runtimeDir,
        key
      );

    fs.mkdirSync(
      path.dirname(filePath),
      {
        recursive: true,
      }
    );

    const data =
      sea.getRawAsset(key);

    fs.writeFileSync(
      filePath,
      new Uint8Array(data)
    );

    if (
      process.platform !==
      "win32"
    ) {
      fs.chmodSync(
        filePath,
        0o755
      );
    }
  }

  fs.writeFileSync(
    marker,
    "ok"
  );
}

const entry =
  sea
    .getAsset(
      "entry.txt",
      "utf8"
    )
    .trim();

const entryPath =
  path.join(
    runtimeDir,
    entry
  );

if (!fs.existsSync(entryPath)) {
  console.error(
    "Entry not found:",
    entry
  );
  process.exit(1);
}

process.chdir(runtimeDir);

const requireFromTmp =
  createRequire(entryPath);

requireFromTmp(entryPath);