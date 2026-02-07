#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templateDir = path.resolve(__dirname, "../template");

const arg = process.argv[2];

let targetDir;

// If "." → current folder
if (arg === ".") {
  targetDir = process.cwd();
}
// If folder name provided → ./<name>
else if (arg) {
  targetDir = path.resolve(process.cwd(), arg);
}
// Default → ./liorandb-studio
else {
  targetDir = path.resolve(process.cwd(), "liorandb-studio");
}

console.log("🚀 Creating LioranDB Studio...\n");
console.log("📁 Target:", targetDir, "\n");

if (!fs.existsSync(templateDir)) {
  console.error("❌ Template directory not found:", templateDir);
  process.exit(1);
}

// Prevent overwriting existing directory unless "."
if (arg !== "." && fs.existsSync(targetDir)) {
  console.error("❌ Directory already exists:", targetDir);
  process.exit(1);
}

// Create directory if not "."
if (arg !== ".") {
  fs.mkdirSync(targetDir, { recursive: true });
}

fs.cpSync(templateDir, targetDir, { recursive: true });

console.log("📦 Installing dependencies...\n");
execSync("npm install", { stdio: "inherit", cwd: targetDir });

console.log("\n⚙️  Building project...\n");
execSync("npm run build", { stdio: "inherit", cwd: targetDir });

console.log("\n🔥 Starting the server...\n");
execSync("npm run start", { stdio: "inherit", cwd: targetDir });
