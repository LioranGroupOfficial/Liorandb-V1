import { IPCServer } from "./server.js";
import { LioranManager } from "../LioranManager.js";

/**
 * Worker Process Entry
 * Each worker:
 *  - Owns its own LioranManager instance
 *  - Listens on its own IPC socket
 *  - Handles requests independently
 */

const rootPath = process.env.LIORAN_ROOT as string;
const workerIdRaw = process.env.LIORAN_WORKER_ID;

if (!rootPath) {
  console.error("[IPC Worker] Missing LIORAN_ROOT");
  process.exit(1);
}

if (workerIdRaw === undefined) {
  console.error("[IPC Worker] Missing LIORAN_WORKER_ID");
  process.exit(1);
}

const workerId = Number(workerIdRaw);

if (isNaN(workerId)) {
  console.error("[IPC Worker] Invalid worker id");
  process.exit(1);
}

async function bootstrap() {
  try {
    const manager = new LioranManager({ rootPath });

    const server = new IPCServer(manager, rootPath, workerId);

    server.start();

    console.log(`[IPC Worker ${workerId}] Started`);

    /* ---------------- Graceful Shutdown ---------------- */

    const shutdown = async () => {
      console.log(`[IPC Worker ${workerId}] Shutting down...`);

      try {
        await server.close();
      } catch (err) {
        console.error(`[IPC Worker ${workerId}] Close error:`, err);
      }

      process.exit(0);
    };

    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);

    process.on("uncaughtException", err => {
      console.error(`[IPC Worker ${workerId}] Uncaught Exception:`, err);
      process.exit(1);
    });

    process.on("unhandledRejection", err => {
      console.error(`[IPC Worker ${workerId}] Unhandled Rejection:`, err);
      process.exit(1);
    });

  } catch (err) {
    console.error(`[IPC Worker ${workerId}] Boot failed:`, err);
    process.exit(1);
  }
}

bootstrap();