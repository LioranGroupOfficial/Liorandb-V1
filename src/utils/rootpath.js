import os from "os";
import path from "path";
import fs from "fs";

/**
 * INTERNAL:
 * Used by LioranManager to resolve default DB root path
 * NO side effects. NO logs. NO installers.
 */
export function getDefaultRootPath() {
  let dbPath = process.env.LIORANDB_PATH;

  if (!dbPath) {
    const homeDir = os.homedir();
    dbPath = path.join(homeDir, "LioranDB", "db");

    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true });
    }

    // process-level only
    process.env.LIORANDB_PATH = dbPath;
  }

  return dbPath;
}

/**
 * PUBLIC:
 * Backward-compatible helper
 */
export function getBaseDBFolder() {
  return getDefaultRootPath();
}

/**
 * OPTIONAL:
 * Explicit installer for system-wide env setup
 * Must be called manually by user
 */
export function installSystemEnv(dbPath = getDefaultRootPath()) {
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

    return {
      platform: "windows",
      script: winScript
    };
  }

  if (platform === "linux" || platform === "darwin") {
    const bashScript = path.join(scriptsDir, "set-lioran-env.sh");

    fs.writeFileSync(
      bashScript,
      `#!/bin/bash
echo 'export LIORANDB_PATH="${dbPath}"' >> ~/.bashrc
echo 'export LIORANDB_PATH="${dbPath}"' >> ~/.zshrc
echo "LIORANDB_PATH set system-wide to: ${dbPath}"`,
      "utf8"
    );

    fs.chmodSync(bashScript, 0o755);

    return {
      platform: platform,
      script: bashScript
    };
  }

  return null;
}
