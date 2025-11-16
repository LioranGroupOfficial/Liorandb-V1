import os from "os";
import path from "path";
import fs from "fs";

export function getBaseDBFolder() {
  let dbPath = process.env.LIORANDB_PATH;

  // If LIORANDB_PATH is NOT set system-wide
  if (!dbPath) {
    const homeDir = os.homedir();
    dbPath = path.join(homeDir, "LioranDB");

    // Ensure directory exists
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true });
    }

    // Set env var for current process
    process.env.LIORANDB_PATH = dbPath;

    // Create OS-specific installer scripts
    createSystemEnvInstaller(dbPath);
  }

  return dbPath;
}

function createSystemEnvInstaller(dbPath) {
  const platform = os.platform();
  const scriptsDir = path.join(os.tmpdir(), "lioran_env_setup");

  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }

  if (platform === "win32") {
    const winScript = path.join(scriptsDir, "set-lioran-env.ps1");
    fs.writeFileSync(
      winScript,
      `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
[System.Environment]::SetEnvironmentVariable("LIORANDB_PATH", "${dbPath}", "Machine")
Write-Host "LIORANDB_PATH set system-wide to: ${dbPath}"`,
      "utf8"
    );

    console.log(`
⚠️ LIORANDB_PATH is not set system-wide.
Run this PowerShell script as ADMIN:

  ${winScript}
`);
  }

  if (platform === "linux" || platform === "darwin") {
    const bashScript = path.join(scriptsDir, "set-lioran-env.sh");
    fs.writeFileSync(
      bashScript,
      `#!/bin/bash
echo 'export LIORANDB_PATH="${dbPath}"' >> ~/.bashrc
echo 'export LIORANDB_PATH="${dbPath}"' >> ~/.zshrc
echo "LIORANDB_PATH set system-wide to: ${dbPath}"
source ~/.bashrc 2>/dev/null
source ~/.zshrc 2>/dev/null
`,
      "utf8"
    );

    fs.chmodSync(bashScript, 0o755);

    console.log(`
⚠️ LIORANDB_PATH is not set system-wide.
Run this script:

  bash ${bashScript}
`);
  }
}
