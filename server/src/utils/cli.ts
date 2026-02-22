import fs from "fs";
import path from "path";

interface CLIOptions {
  rootPath?: string;
  encryptionKey?: string;
}

export function parseCLIArgs(): CLIOptions {
  const args = process.argv.slice(2);

  let rootPath: string | undefined;
  let encryptionKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--root") {
      rootPath = args[++i];
      continue;
    }

    if (arg === "-ed") {
      encryptionKey = args[++i];
      continue;
    }

    if (arg === "-ef") {
      const file = args[++i];
      const fullPath = path.resolve(file);

      if (!fs.existsSync(fullPath)) {
        console.error(`❌ Encryption key file not found: ${fullPath}`);
        process.exit(1);
      }

      encryptionKey = fs.readFileSync(fullPath, "utf8").trim();
      continue;
    }
  }

  return { rootPath, encryptionKey };
}