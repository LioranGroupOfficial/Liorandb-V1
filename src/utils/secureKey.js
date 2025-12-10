import crypto from "crypto";
import os from "os";

const VAR_NAME = "LIORANDB_MASTER_KEY";

export function getMasterKey() {
  let key = process.env[VAR_NAME];

  if (!key) {
    console.error("\n❌ ERROR: Master encryption key not found in system environment variables.");
    console.error(`🔑 Variable required: ${VAR_NAME}\n`);

    const generatedKey = crypto.randomBytes(32).toString("hex");
    console.error("🔧 Auto-generated a secure 256-bit key for you:");
    console.error(generatedKey, "\n");

    console.error("👉 Copy and paste the correct command below to set it permanently:");

    printSetupCommand(generatedKey);

    console.error("\n❗ After setting the variable, restart your terminal.");
    process.exit(1);
  }

  key = key.trim();

  if (key.length !== 64) {
    console.error("\n❌ ERROR: Invalid master key length.");
    console.error("Required: 64 hex characters (256-bit)\n");
    process.exit(1);
  }

  return key;
}

function printSetupCommand(key) {
  const platform = os.platform();

  console.error("========================================");

  if (platform === "win32") {
    console.error("📌 Windows (System Environment Variable):");
    console.error(
      `setx ${VAR_NAME} "${key}" /M`
    );
  } else if (platform === "linux") {
    console.error("📌 Linux (System-wide, requires sudo):");
    console.error(
      `echo "export ${VAR_NAME}=${key}" | sudo tee -a /etc/environment`
    );
  } else if (platform === "darwin") {
    console.error("📌 macOS (system/global, requires sudo):");
    console.error(
      `echo "export ${VAR_NAME}=${key}" | sudo tee -a /etc/zshenv`
    );
  } else {
    console.error(`⚠ Unsupported OS: ${platform}`);
  }

  console.error("========================================");
}
