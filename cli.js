#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const command = args[0];
const flags = args.slice(1);

// ---------- COLORS ----------
const C = {
    green: s => `\x1b[32m${s}\x1b[0m`,
    cyan: s => `\x1b[36m${s}\x1b[0m`,
    yellow: s => `\x1b[33m${s}\x1b[0m`,
    red: s => `\x1b[31m${s}\x1b[0m`,
    bold: s => `\x1b[1m${s}\x1b[0m`,
};

// ---------- HELP SYSTEM ----------
const helpInfo = {
    serve: {
        name: "serve",
        description: "Starts the LioranDB server. Default = local mode.",
        usage: "liorandb serve [--local] [--global]",
        args: [
            ["--local", "Runs DB at http://localhost:2008 only (default)"],
            ["--global", "Starts P2P mode → make device accessible globally via access-key"],
        ],
    },

    login: {
        name: "login",
        description: "Log into your LioranDB account.",
        usage: "liorandb login",
        args: [["(no args)", "Opens login flow"]],
    },

    logout: {
        name: "logout",
        description: "Logs out and clears all credentials.",
        usage: "liorandb logout",
        args: [["(no args)", "Clears stored API key"]],
    },

    manage: {
        name: "manage",
        description: "Open the management CLI to manage users and CORS.",
        usage: "liorandb manage",
        args: [
            ["(no args)", "Opens interactive manage flow"],
        ],
        details: [
            "Users: view, edit, delete, and create new users",
            "  - Edit includes username, password, permissions, expiry",
            "CORS: view, add, and delete allowed URLs"
        ]
    }
};

// ---------- HELP FUNCTIONS ----------
function printGlobalHelp() {
    console.log(C.bold("\nLioranDB CLI - Commands\n"));
    console.log(`${C.cyan("Usage:")}   liorandb <command> [options]\n`);
    console.log(C.bold("Commands:"));

    for (const cmd of Object.values(helpInfo)) {
        console.log(`  ${C.green(cmd.name.padEnd(10))} ${cmd.description}`);
    }

    console.log(`\nRun ${C.yellow("liorandb <command> --help")} for details.\n`);
}

function printCommandHelp(cmd) {
    const info = helpInfo[cmd];
    if (!info) return console.log(C.red(`No help found for command: ${cmd}`));

    console.log(C.bold(`\nCommand: ${info.name}`));
    console.log(C.cyan(info.description));
    console.log(`\n${C.bold("Usage:")} ${info.usage}`);

    if (info.args.length) {
        console.log(`\n${C.bold("Arguments:")}`);
        for (const [arg, desc] of info.args) {
            console.log(`  ${C.green(arg.padEnd(12))} ${desc}`);
        }
    }

    if (info.details) {
        console.log(`\n${C.bold("Details:")}`);
        info.details.forEach(line => console.log(`  - ${line}`));
    }

    console.log("");
}

// ---------- RUNNER ----------
function run(file) {
    const child = spawn("node", [path.join(__dirname, file), ...flags], {
        stdio: "inherit"
    });
    child.on("exit", process.exit);
}

// ---------- DISPATCH ----------
if (!command || command === "-h" || command === "--help" || command === "help") {
    printGlobalHelp();
    process.exit(0);
}

if (flags.includes("-h") || flags.includes("--help")) {
    printCommandHelp(command);
    process.exit(0);
}

// ---------- COMMAND ROUTING ----------
switch (command) {
    case "serve":
        console.log(
            C.yellow(flags.includes("--global")
                ? "\n🔗 Starting LioranDB in GLOBAL P2P mode..."
                : "\n📦 Starting LioranDB locally at http://localhost:2008 ..."
            )
        );
        run("./server.js");
        break;

    case "login":
        console.log(C.green("\n🔐 Opening login flow...\n"));
        run("./login.js");
        break;

    case "manage":
        console.log(C.green("\n🔐 Opening manage flow...\n"));
        run("./manage.js");
        break;

    case "logout":
        console.log(C.red("\n🔒 Logging out...\n"));
        run("./logout.js");
        break;

    default:
        console.log(C.red(`Unknown command: ${command}\n`));
        printGlobalHelp();
        process.exit(1);
}
