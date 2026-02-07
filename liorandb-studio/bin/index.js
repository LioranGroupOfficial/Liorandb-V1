#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templateDir = path.resolve(__dirname, "../template");
const targetDir = process.argv[2]
  ? path.resolve(process.argv[2])
  : process.cwd();

console.log("🚀 Creating LioranDB Studio...\n");

if (!fs.existsSync(templateDir)) {
  console.error("❌ Template directory not found:", templateDir);
  process.exit(1);
}

fs.cpSync(templateDir, targetDir, { recursive: true });

console.log("📦 Installing dependencies...\n");

execSync("npm install", { stdio: "inherit", cwd: targetDir });

// Build the project to ensure everything is set up correctly
execSync("npm run build", { stdio: "inherit", cwd: targetDir });

console.log("\n🔥 Starting the server...\n");

execSync("npm run start", { stdio: "inherit", cwd: targetDir });
