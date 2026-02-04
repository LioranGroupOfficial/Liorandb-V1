import os from "os";
import path from "path";
import fs from "fs";

export function getDefaultRootPath(): string {
  let dbPath = process.env.LIORANDB_PATH;

  if (!dbPath) {
    const homeDir = os.homedir();
    dbPath = path.join(homeDir, "LioranDB", "db");

    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(dbPath, { recursive: true });
    }

    process.env.LIORANDB_PATH = dbPath;
  }

  return dbPath;
}

export function getBaseDBFolder(): string {
  return getDefaultRootPath();
}

export function installSystemEnv(dbPath = getDefaultRootPath()) {
  const platform = os.platform();
  const scriptsDir = path.join(os.tmpdir(), "lioran_env_setup");

  if (!fs.existsSync(scriptsDir)) {
    fs.mkdirSync(scriptsDir, { recursive: true });
  }

  if (platform === "win32") {
    const script = path.join(scriptsDir, "set-lioran-env.ps1");
    fs.writeFileSync(
      script,
      `[System.Environment]::SetEnvironmentVariable("LIORANDB_PATH","${dbPath}","Machine")`
    );
    return { platform: "windows", script };
  }

  if (platform === "linux" || platform === "darwin") {
    const script = path.join(scriptsDir, "set-lioran-env.sh");
    fs.writeFileSync(
      script,
      `export LIORANDB_PATH="${dbPath}"`
    );
    fs.chmodSync(script, 0o755);
    return { platform, script };
  }

  return null;
}
