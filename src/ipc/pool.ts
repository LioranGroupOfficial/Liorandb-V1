import { Worker } from "worker_threads";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

/**
 * Worker Thread Pool
 *
 * - Spawns multiple worker threads (based on CPU cores)
 * - Auto-restarts crashed workers
 * - Supports graceful shutdown
 * - Round-robin task scheduling
 */

export class IPCWorkerPool {
  private workers: Worker[] = [];
  private workerCount: number;
  private shuttingDown = false;
  private rrIndex = 0;

  constructor() {
    // Minimum 2 workers, scale with CPU cores
    this.workerCount = Math.max(2, os.cpus().length);
  }

  /* -------------------------------------------------- */
  /* START POOL                                         */
  /* -------------------------------------------------- */

  start() {
    for (let i = 0; i < this.workerCount; i++) {
      this.spawnWorker();
    }

    console.log(
      `[WorkerPool] Started ${this.workerCount} worker threads`
    );
  }

  /* -------------------------------------------------- */
  /* SPAWN WORKER                                       */
  /* -------------------------------------------------- */

  private spawnWorker() {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    // Worker compiled output must exist in dist
    const workerFile = path.join(__dirname, "worker.js");

    const worker = new Worker(workerFile);

    worker.on("exit", code => {
      if (this.shuttingDown) return;

      console.error(
        `[WorkerPool] Worker exited (code=${code}). Restarting...`
      );

      // Remove dead worker
      this.workers = this.workers.filter(w => w !== worker);

      // Restart after short delay
      setTimeout(() => {
        this.spawnWorker();
      }, 500);
    });

    worker.on("error", err => {
      console.error("[WorkerPool] Worker error:", err);
    });

    this.workers.push(worker);
  }

  /* -------------------------------------------------- */
  /* EXECUTE TASK                                       */
  /* -------------------------------------------------- */

  exec(task: any): Promise<any> {
    if (this.workers.length === 0) {
      throw new LiorandbError("CLOSED", "No workers available");
    }

    const worker = this.workers[this.rrIndex];
    this.rrIndex = (this.rrIndex + 1) % this.workers.length;

    return new Promise((resolve, reject) => {
      const id = Date.now() + Math.random();

      const messageHandler = (msg: any) => {
        if (msg.id !== id) return;

        worker.off("message", messageHandler);

        if (msg.ok) resolve(msg.result);
        else reject(new LiorandbError("INTERNAL", msg.error || "Worker execution error"));
      };

      worker.on("message", messageHandler);

      worker.postMessage({
        id,
        task
      });
    }).catch(err => {
      throw asLiorandbError(err, {
        code: "INTERNAL",
        message: "Worker task failed"
      });
    });
  }

  /* -------------------------------------------------- */
  /* SHUTDOWN                                           */
  /* -------------------------------------------------- */

  async shutdown() {
    this.shuttingDown = true;

    console.log("[WorkerPool] Shutting down worker threads...");

    for (const worker of this.workers) {
      try {
        await worker.terminate();
      } catch (err) {
        console.error("[WorkerPool] Worker terminate error:", err);
      }
    }

    this.workers = [];
  }

  /* -------------------------------------------------- */
  /* INFO                                               */
  /* -------------------------------------------------- */

  get size(): number {
    return this.workerCount;
  }
}
