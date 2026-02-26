import { fork, ChildProcess } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

/**
 * IPC Worker Pool
 *
 * - Spawns multiple worker processes (based on CPU cores)
 * - Auto-restarts crashed workers
 * - Supports graceful shutdown
 * - Production-safe respawn protection
 */

export class IPCWorkerPool {
  private workers: Map<number, ChildProcess> = new Map();
  private workerCount: number;
  private shuttingDown = false;

  constructor(private rootPath: string) {
    // Minimum 2 workers, scale with CPU
    this.workerCount = Math.max(2, os.cpus().length);
  }

  /* -------------------------------------------------- */
  /* START POOL                                         */
  /* -------------------------------------------------- */

  start() {
    for (let i = 0; i < this.workerCount; i++) {
      this.spawnWorker(i);
    }

    console.log(`[IPC] Worker pool started with ${this.workerCount} workers`);
  }

  /* -------------------------------------------------- */
  /* SPAWN WORKER                                       */
  /* -------------------------------------------------- */

  private spawnWorker(id: number) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Worker compiled output must exist in dist
    const workerFile = path.join(__dirname, "worker.js");

    const worker = fork(workerFile, [], {
      env: {
        ...process.env,
        LIORAN_ROOT: this.rootPath,
        LIORAN_WORKER_ID: String(id)
      }
    });

    worker.on("exit", (code, signal) => {
      if (this.shuttingDown) return;

      console.error(
        `[IPC] Worker ${id} exited (code=${code}, signal=${signal}). Restarting...`
      );

      // Restart worker
      setTimeout(() => {
        this.spawnWorker(id);
      }, 500);
    });

    worker.on("error", err => {
      console.error(`[IPC] Worker ${id} error:`, err);
    });

    this.workers.set(id, worker);
  }

  /* -------------------------------------------------- */
  /* SHUTDOWN                                           */
  /* -------------------------------------------------- */

  async shutdown() {
    this.shuttingDown = true;

    console.log("[IPC] Shutting down worker pool...");

    for (const [, worker] of this.workers) {
      try {
        worker.kill("SIGTERM");
      } catch (err) {
        console.error("[IPC] Worker kill error:", err);
      }
    }

    this.workers.clear();
  }

  /* -------------------------------------------------- */
  /* INFO                                               */
  /* -------------------------------------------------- */

  get size(): number {
    return this.workerCount;
  }
}