const { execSync } = require("child_process");
const path = require("path");

const bins = [
  { input: "dist/cli/index.js", output: "ldb-cli.exe" },
  { input: "dist/cli/users.js", output: "ldb-users.exe" },
  { input: "dist/server.js", output: "ldb-serve.exe" }
];

for (const bin of bins) {
  console.log(`Building ${bin.output}...`);

  const cmd = [
    "nexe",
    bin.input,
    "--target windows-x64-20.0.0",
    "--build",
    "--loglevel info",
    '--resource "./dist/**/*.{js,json}"',
    `--output ${path.join("build", bin.output)}`
  ].join(" ");

  execSync(cmd, { stdio: "inherit" });
}

console.log("All executables built.");