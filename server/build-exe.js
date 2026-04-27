const { execSync } = require("child_process");
const path = require("path");

const bins = [
  { input: "dist/cli/index.js", output: "ldb-cli.exe" },
  { input: "dist/cli/users.js", output: "ldb-users.exe" },
  { input: "dist/server.js", output: "ldb-serve.exe" }
];

for (const bin of bins) {
  const cmd = [
    "nexe",
    bin.input,
    "--target windows-x64-18.0.0",
    "--build",
    "--loglevel verbose",
    "--resource ./dist/**/*",
    `--output ${path.join("build", bin.output)}`
  ].join(" ");

  console.log(`Building ${bin.output}...`);
  execSync(cmd, { stdio: "inherit" });
}

console.log("All executables built successfully.");