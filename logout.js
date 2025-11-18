#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { getBaseDBFolder } from "./src/index.js";

function logout() {
    const baseFolder = getBaseDBFolder();
    const filePath = path.join(baseFolder, "user.json");

    if (!fs.existsSync(filePath)) {
        console.log("You are already logged out (user.json not found).");
        process.exit(0);
        return;
    }

    try {
        fs.unlinkSync(filePath);
        console.log("✔ Successfully logged out. user.json deleted.");
        process.exit(0);
    } catch (err) {
        console.error("❌ Failed to delete user.json:", err);
        process.exit(1);
    }
}

logout();
