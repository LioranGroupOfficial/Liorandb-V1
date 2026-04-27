import fs from "fs";
import path from "path";

export interface CLIOptions {
  rootPath?: string;
  encryptionKey?: string;
  ipc?: "primary" | "client" | "readonly";
  writeQueue?: {
    maxSize?: number;
    mode?: "wait" | "reject";
    timeoutMs?: number;
  };
  batch?: {
    chunkSize?: number;
  };
}

function readEnvInt(name: string) {
  const raw = process.env[name];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

export function parseCLIArgs(): CLIOptions {
  const args = process.argv.slice(2);

  let rootPath: string | undefined;
  let encryptionKey: string | undefined;
  let ipc: CLIOptions["ipc"] | undefined =
    (process.env.LIORANDB_IPC_MODE as any) || undefined;

  const writeQueue: NonNullable<CLIOptions["writeQueue"]> = {};
  const batch: NonNullable<CLIOptions["batch"]> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === "--root") {
      rootPath = args[++i];
      continue;
    }

    if (arg === "--ipc") {
      const mode = args[++i] as CLIOptions["ipc"];
      if (mode !== "primary" && mode !== "client" && mode !== "readonly") {
        console.error(`Invalid --ipc mode: ${mode}`);
        process.exit(1);
      }
      ipc = mode;
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
        console.error(`Encryption key file not found: ${fullPath}`);
        process.exit(1);
      }

      encryptionKey = fs.readFileSync(fullPath, "utf8").trim();
      continue;
    }

    if (arg === "--write-queue-max") {
      writeQueue.maxSize = Number(args[++i]);
      continue;
    }

    if (arg === "--write-queue-mode") {
      const mode = args[++i] as "wait" | "reject";
      if (mode !== "wait" && mode !== "reject") {
        console.error(`Invalid --write-queue-mode: ${mode}`);
        process.exit(1);
      }
      writeQueue.mode = mode;
      continue;
    }

    if (arg === "--write-queue-timeout-ms") {
      writeQueue.timeoutMs = Number(args[++i]);
      continue;
    }

    if (arg === "--batch-chunk-size") {
      batch.chunkSize = Number(args[++i]);
      continue;
    }
  }

  const envMax = readEnvInt("LIORANDB_WRITE_QUEUE_MAX");
  if (writeQueue.maxSize === undefined && envMax !== undefined) {
    writeQueue.maxSize = envMax;
  }

  const envMode = process.env.LIORANDB_WRITE_QUEUE_MODE as any;
  if (
    writeQueue.mode === undefined &&
    (envMode === "wait" || envMode === "reject")
  ) {
    writeQueue.mode = envMode;
  }

  const envTimeout = readEnvInt("LIORANDB_WRITE_QUEUE_TIMEOUT_MS");
  if (writeQueue.timeoutMs === undefined && envTimeout !== undefined) {
    writeQueue.timeoutMs = envTimeout;
  }

  const envChunk = readEnvInt("LIORANDB_BATCH_CHUNK_SIZE");
  if (batch.chunkSize === undefined && envChunk !== undefined) {
    batch.chunkSize = envChunk;
  }

  return {
    rootPath,
    encryptionKey,
    ipc,
    writeQueue: Object.keys(writeQueue).length ? writeQueue : undefined,
    batch: Object.keys(batch).length ? batch : undefined,
  };
}
