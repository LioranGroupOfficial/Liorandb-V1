#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const target = process.cwd();
const templateDir = new URL("../template", import.meta.url).pathname;

console.log("🚀 Creating LioranDB Studio...\n");

fs.cpSync(templateDir, target, { recursive: true });

console.log("📦 Installing dependencies...\n");

execSync("npm install", { stdio: "inherit" });

console.log("\n🔥 Starting dev server...\n");

execSync("npm run dev", { stdio: "inherit" });
