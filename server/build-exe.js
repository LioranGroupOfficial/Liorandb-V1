const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = process.cwd();

const DIST = path.join(ROOT, "dist");
const NODE_MODULES = path.join(ROOT, "node_modules");

const BUILD = path.join(ROOT, "build");
const BOOTSTRAP = path.join(ROOT, "sea-bootstrap.js");

fs.mkdirSync(BUILD, { recursive: true });

/**
 * Recursively collect files
 */
function getFiles(dir, base = dir) {
  let files = {};

  if (!fs.existsSync(dir)) return files;

  for (const f of fs.readdirSync(dir)) {
    const full = path.join(dir, f);

    const stat = fs.statSync(full);

    if (stat.isDirectory()) {
      Object.assign(
        files,
        getFiles(full, base)
      );
    } else {
      const rel = path
        .relative(base, full)
        .replace(/\\/g, "/");

      files[rel] = full;
    }
  }

  return files;
}

console.log("Collecting assets...");

/**
 * Include BOTH dist and node_modules
 */
const baseAssets = {
  ...getFiles(DIST),
  ...getFiles(NODE_MODULES),
};

console.log(
  "Total assets:",
  Object.keys(baseAssets).length
);

const targets = [
  {
    name: "ldb-cli",
    entry: "cli/index.js",
  },
  {
    name: "ldb-users",
    entry: "cli/users.js",
  },
  {
    name: "ldb-serve",
    entry: "server.js",
  },
];

for (const t of targets) {
  console.log("\nBuilding", t.name);

  const configPath =
    path.join(BUILD, `${t.name}.json`);

  const entryFile =
    path.join(BUILD, `${t.name}-entry.txt`);

  fs.writeFileSync(
    entryFile,
    t.entry
  );

  const assets = {
    ...baseAssets,
    "entry.txt": entryFile,
  };

  const outputExe = path.join(
    BUILD,
    `${t.name}.exe`
  );

  const config = {
    main: BOOTSTRAP,
    mainFormat: "commonjs",

    output: outputExe,

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
      { stdio: "inherit" }
    );

    console.log("✔ Built", t.name);
  } catch (err) {
    console.error(
      "✖ Failed",
      t.name
    );
  }

  fs.unlinkSync(configPath);
  fs.unlinkSync(entryFile);
}

console.log("\nAll executables generated in ./build 🚀");