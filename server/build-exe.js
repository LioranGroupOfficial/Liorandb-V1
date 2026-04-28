const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();

const DIST = path.join(ROOT, "dist");
const PUBLIC = path.join(ROOT, "public");
const NODE_MODULES = path.join(ROOT, "node_modules");

const PKG = require(path.join(ROOT, "package.json"));

const VERSION = PKG.version;

const PLATFORM_MAP = {
  win32: "windows",
  darwin: "mac",
  linux: "linux",
};

const PLATFORM =
  PLATFORM_MAP[process.platform] ||
  process.platform;

const BUILD = path.join(
  ROOT,
  "build",
  VERSION,
  PLATFORM,
  "release"
);

const BOOTSTRAP = path.join(
  ROOT,
  "sea-bootstrap.js"
);

fs.mkdirSync(BUILD, {
  recursive: true,
});

/**
 * Recursively collect files
 */
function getFiles(
  dir,
  base = dir,
  shouldInclude = null,
  prefix = ""
) {
  let files = {};

  if (!fs.existsSync(dir)) return files;

  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);

    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      Object.assign(
        files,
        getFiles(
          full,
          base,
          shouldInclude,
          prefix
        )
      );
    } else {
      let rel = path
        .relative(base, full)
        .replace(/\\/g, "/");

      if (typeof shouldInclude === "function") {
        if (!shouldInclude(rel, full))
          continue;
      }

      if (prefix) {
        rel = prefix + rel;
      }

      files[rel] = full;
    }
  }

  return files;
}

console.log("Collecting assets...");

function shouldIncludeNodeModulesAsset(
  rel
) {
  if (rel.startsWith("@types/"))
    return false;

  if (rel.endsWith(".d.ts"))
    return false;

  if (rel.endsWith(".map"))
    return false;

  if (rel.includes("/test/"))
    return false;

  if (rel.includes("/tests/"))
    return false;

  if (rel.includes("/__tests__/"))
    return false;

  return true;
}

const baseAssets = {
  ...getFiles(
    DIST,
    DIST,
    null,
    "dist/"
  ),

  ...getFiles(
    NODE_MODULES,
    NODE_MODULES,
    shouldIncludeNodeModulesAsset,
    "node_modules/"
  ),
  
  ...getFiles(
    PUBLIC,
    PUBLIC,
    null,
    "public/"
  ),
};

console.log(
  "Total assets:",
  Object.keys(baseAssets).length
);

const targets = [
  {
    name: "ldb-serve",
    entry: "dist/server.js",
  },
  {
    name: "ldb-cli",
    entry: "dist/cli/index.js",
  },
  {
    name: "ldb-users",
    entry: "dist/cli/users.js",
  },
];

for (const t of targets) {
  console.log("\nBuilding", t.name);

  const configPath =
    path.join(
      BUILD,
      `${t.name}.json`
    );

  const entryFile =
    path.join(
      BUILD,
      `${t.name}-entry.txt`
    );

  fs.writeFileSync(
    entryFile,
    t.entry
  );

  const assets = {
    ...baseAssets,
    "entry.txt": entryFile,
    "package.json": path.join(ROOT, "package.json"),
  };

  const outputFile =
    process.platform === "win32"
      ? `${t.name}.exe`
      : t.name;

  const outputPath =
    path.join(
      BUILD,
      outputFile
    );

  const config = {
    main: BOOTSTRAP,
    mainFormat: "commonjs",

    output: outputPath,

    disableExperimentalSEAWarning: true,

    useSnapshot: false,
    useCodeCache: true,

    assets,
  };

  fs.writeFileSync(
    configPath,
    JSON.stringify(config, null, 2)
  );

  try {
    execSync(
      `node --build-sea "${configPath}"`,
      {
        stdio: "inherit",
      }
    );

    if (
      process.platform !== "win32"
    ) {
      fs.chmodSync(
        outputPath,
        0o755
      );
    }

    console.log(
      "✔ Built",
      t.name
    );
  } catch (err) {
    console.error(
      "✖ Failed",
      t.name
    );
  }

  fs.unlinkSync(configPath);
  fs.unlinkSync(entryFile);
}

console.log(
  "\nBuild complete 🚀"
);

console.log(
  "Output directory:"
);

console.log(BUILD);