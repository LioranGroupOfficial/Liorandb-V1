#!/usr/bin/env node

import express from "express";
import fetch from "node-fetch";
import open from "open";
import fs from "fs";
import path from "path";
import { getBaseDBFolder } from "./src/index.js";

const PORT = 2007;
const app = express();
app.use(express.json());

/* ------------------ SAVE / LOAD USER DATA ------------------ */
function saveUserData(data) {
    const baseFolder = getBaseDBFolder();
    const filePath = path.join(baseFolder, "user.json");
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadUserData() {
    const baseFolder = getBaseDBFolder();
    const filePath = path.join(baseFolder, "user.json");

    if (!fs.existsSync(filePath)) return null;

    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/* ------------------ GOOGLE LOGIN CALLBACK ------------------ */
app.get("/callback", async (req, res) => {
    const token = req.query.token;

    if (!token) {
        res.send("No token received");
        process.exit(1);
        return;
    }

    try {
        const response = await fetch("https://liorandb-server.onrender.com/user/getUser", {
            method: "GET",
            headers: {
                "Authorization": `Bearer ${token}`,
                "Content-Type": "application/json"
            }
        });

        const result = await response.json();

        if (!result.userId || !result.accessKey) {
            res.send("Failed to get user details from auth server.");
            process.exit(1);
            return;
        }

        saveUserData({
            userId: result.userId,
            accessKey: result.accessKey
        });

        res.send("Login successful! User data stored locally.");

        // Exit after success
        setTimeout(() => process.exit(0), 500);

    } catch (err) {
        console.error("Error fetching user details:", err);
        res.send("Error fetching user details.");
        process.exit(1);
    }
});

/* ------------------ MAIN STARTUP LOGIC ------------------ */
app.listen(PORT, async () => {
    const userData = loadUserData();

    // CASE 1 → user.json NOT FOUND → Open login → Exit
    if (!userData) {
        console.log("No user.json found → Opening Google login...");
        await open("https://liorandb-server.onrender.com/auth/google");
        return;
    }

    // CASE 2 → user.json found → Verify key
    console.log("Found user.json → Verifying accessKey...");

    const verifyUrl = `https://liorandb-server.onrender.com/user/verifyKey/${userData.accessKey}`;

    try {
        const response = await fetch(verifyUrl);
        const result = await response.json();

        if (response.ok && result.valid === true) {
            console.log("✔ Access key valid → No need to login.");
            process.exit(0);
            return;
        }

        console.log("❌ Invalid access key → Opening login...");
        await open("https://liorandb-server.onrender.com/auth/google");

    } catch (err) {
        console.log("⚠ Error verifying key:", err);
        console.log("Opening Google login...");
        await open("https://liorandb-server.onrender.com/auth/google");
    }
});
