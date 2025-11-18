#!/usr/bin/env node

import inquirer from "inquirer";
import crypto from "crypto";
import { LioranManager } from "./src/index.js";

/* ============================================================
   HELPER FUNCTIONS
============================================================ */
function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function randomKey() {
  return [...Array(32)].map(() => Math.floor(Math.random() * 16).toString(16)).join("");
}

function formatDate(d) {
  return new Date(d).toISOString().split("T")[0];
}

function displayUser(user) {
  console.log(`\n🧑 User Details:
Username   : ${user.username}
API Key    : ${user.apiKey}
Permissions: ${user.permissions.join(", ")}
Expiry     : ${formatDate(user.expires)}
`);
}

/* ============================================================
   MAIN ASYNC FUNCTION
============================================================ */
(async () => {
  console.clear();
  console.log("🔐 Opening manage flow...\n");

  // Initialize database
  const manager = new LioranManager();
  await manager.createDatabase("admin").catch(() => {});
  const adminDB = await manager.openDatabase("admin");

  const usersColl = adminDB.collection("users");
  const corsColl = adminDB.collection("cors");

  console.log("🔐 Manage flow initialized.\n");

  /* ============================================================
     MAIN MENU
  ============================================================ */
  async function mainMenu() {
    const ans = await inquirer.prompt([
      { type: "list", name: "menu", message: "Select an option:", choices: ["Users", "CORS", "Exit"] },
    ]);

    if (ans.menu === "Users") return usersMenu();
    if (ans.menu === "CORS") return corsMenu();
    process.exit(0);
  }

  /* ============================================================
     USERS MENU
  ============================================================ */
  async function usersMenu() {
    console.clear();
    const users = await usersColl.find({});
    const choices = users.map(u => ({ name: u.username, value: u._id }));
    choices.push(new inquirer.Separator(), "➕ Create User", "⬅ Back");

    const ans = await inquirer.prompt([{ type: "list", name: "userChoice", message: "Users:", choices }]);

    if (ans.userChoice === "⬅ Back") return mainMenu();
    if (ans.userChoice === "➕ Create User") return createUser();

    const user = users.find(u => u._id === ans.userChoice);
    return userActions(user);
  }

  /* ============================================================
     USER ACTIONS MENU
  ============================================================ */
  async function userActions(user) {
    console.clear();
    displayUser(user);

    const ans = await inquirer.prompt([
      { type: "list", name: "action", message: "Action:", choices: ["Edit", "Delete", "Back"] },
    ]);

    if (ans.action === "Back") return usersMenu();
    if (ans.action === "Delete") {
      await usersColl.deleteOne({ _id: user._id });
      console.log("🗑 User deleted.");
      return usersMenu();
    }
    if (ans.action === "Edit") return chooseFieldToEdit(user);
  }

  /* ============================================================
     CHOOSE FIELD TO EDIT
  ============================================================ */
  async function chooseFieldToEdit(user) {
  console.clear();
  displayUser(user);

  // Step 1: choose fields or go back
  const ans = await inquirer.prompt([
    {
      type: "checkbox",
      name: "fields",
      message: "Select fields to edit (or press Backspace to go back):",
      choices: ["Username", "Password", "Permissions", "Expiry", new inquirer.Separator(), "⬅ Back"],
    },
  ]);

  if (ans.fields.includes("⬅ Back") || !ans.fields.length) return userActions(user);

  let updates = {};

  // Username
  if (ans.fields.includes("Username")) {
    const res = await inquirer.prompt([
      {
        type: "input",
        name: "username",
        message: "New Username (or type 'back' to cancel):",
        default: user.username,
      },
    ]);
    if (res.username.toLowerCase() === "back") return chooseFieldToEdit(user);
    updates.username = res.username;
  }

  // Password
  if (ans.fields.includes("Password")) {
    const res = await inquirer.prompt([
      {
        type: "password",
        name: "password",
        message: "New Password (leave empty = no change, type 'back' to cancel):",
      },
    ]);
    if (res.password.toLowerCase() === "back") return chooseFieldToEdit(user);
    if (res.password.trim() !== "") updates.password = hashPassword(res.password);
  }

  // Permissions
  if (ans.fields.includes("Permissions")) {
    const res = await inquirer.prompt([
      {
        type: "checkbox",
        name: "permissions",
        message: "Select Permissions (or Backspace to cancel):",
        choices: ["createDB", "readDB", "writeDB", "deleteDB"],
        default: user.permissions,
      },
    ]);
    if (res.permissions.includes("back")) return chooseFieldToEdit(user);
    updates.permissions = res.permissions;
  }

  // Expiry
  if (ans.fields.includes("Expiry")) {
    const res = await inquirer.prompt([
      {
        type: "input",
        name: "expires",
        message: "New Expiry Date (YYYY-MM-DD, or type 'back' to cancel):",
        default: formatDate(user.expires),
      },
    ]);
    if (res.expires.toLowerCase() === "back") return chooseFieldToEdit(user);
    updates.expires = new Date(res.expires);
  }

  await usersColl.updateOne({ _id: user._id }, { $set: updates });
  console.log("✏️ User updated!");
  return usersMenu();
}


  /* ============================================================
     CREATE NEW USER
  ============================================================ */
  async function createUser() {
    console.clear();
    const ans = await inquirer.prompt([
      { type: "input", name: "username", message: "Username:" },
      { type: "password", name: "password", message: "Password:" },
      { type: "checkbox", name: "permissions", message: "Select permissions:", choices: ["createDB", "readDB", "writeDB", "deleteDB"] },
      { type: "input", name: "expires", message: "Expiry Date (YYYY-MM-DD, leave empty for 30 days):" },
    ]);

    const expiry = ans.expires ? new Date(ans.expires) : new Date(Date.now() + 1000*60*60*24*30);

    await usersColl.insertOne({
      username: ans.username,
      password: hashPassword(ans.password),
      permissions: ans.permissions.length ? ans.permissions : ["createDB","readDB","writeDB","deleteDB"],
      apiKey: randomKey(),
      expires: expiry,
    });

    console.log("✅ User created!");
    return usersMenu();
  }

  /* ============================================================
     CORS MENU
  ============================================================ */
  async function corsMenu() {
    console.clear();
    const corsList = await corsColl.find({});
    const choices = corsList.map(c => ({ name: c.url, value: c._id }));
    choices.push(new inquirer.Separator(), "➕ Add CORS URL", "⬅ Back");

    const ans = await inquirer.prompt([{ type: "list", name: "corsChoice", message: "CORS URLs:", choices }]);

    if (ans.corsChoice === "⬅ Back") return mainMenu();
    if (ans.corsChoice === "➕ Add CORS URL") return addCors();

    return corsActions(ans.corsChoice);
  }

  async function corsActions(id) {
    const ans = await inquirer.prompt([{ type: "list", name: "action", message: "CORS Action:", choices: ["Delete", "Back"] }]);
    if (ans.action === "Back") return corsMenu();

    await corsColl.deleteOne({ _id: id });
    console.log("🗑 CORS removed!");
    return corsMenu();
  }

  async function addCors() {
    console.clear();
    const ans = await inquirer.prompt([{ type: "input", name: "url", message: "Enter CORS URL:" }]);
    if (!ans.url.trim()) return corsMenu();

    await corsColl.insertOne({ url: ans.url.trim() });
    console.log("🌐 CORS added!");
    return corsMenu();
  }

  /* ============================================================
     START
  ============================================================ */
  await mainMenu();
})();
