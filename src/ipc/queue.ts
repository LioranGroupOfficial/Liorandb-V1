import { fork, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWorkerPath() {
  return path.resolve(__dirname, "../dist/worker/dbWorker.js");
}

export class DBQueue {
  private worker!: ChildProcess;
  private seq = 0;
  private pending = new Map<number, (r: any) => void>();
  private isShutdown = false;
  private restarting = false;
  private workerAlive = false;

  constructor() {
    this.spawnWorker();

    process.once("exit", () => this.shutdown());
    process.once("SIGINT", () => this.shutdown());
    process.once("SIGTERM", () => this.shutdown());
  }

  /* ---------------- Worker Control ---------------- */

  private spawnWorker() {
    const workerPath = resolveWorkerPath();

    this.worker = fork(workerPath, [], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    this.workerAlive = true;

    this.worker.on("message", (msg: any) => {
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        cb(msg);
      }
    });

    this.worker.once("exit", (code, signal) => {
      this.workerAlive = false;

      if (this.isShutdown) return;

      console.error("DB Worker crashed, restarting...", { code, signal });

      this.restartWorker();
    });
  }

  private restartWorker() {
    if (this.restarting || this.isShutdown) return;

    this.restarting = true;

    setTimeout(() => {
      if (this.isShutdown) return;

      for (const [, cb] of this.pending) {
        cb({ ok: false, error: "IPC worker crashed" });
      }
      this.pending.clear();
      this.seq = 0;

      this.spawnWorker();
      this.restarting = false;
    }, 500);
  }

  /* ---------------- IPC Exec ---------------- */

  exec(action: string, args: any, timeout = 15000) {
    if (this.isShutdown) {
      return Promise.reject(new Error("DBQueue is shutdown"));
    }

    if (!this.workerAlive) {
      return Promise.reject(new Error("IPC worker not running"));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.seq;

      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC timeout: ${action}`));
      }, timeout);

      this.pending.set(id, (msg) => {
        clearTimeout(timer);
        this.pending.delete(id);
        msg.ok ? resolve(msg.result) : reject(new Error(msg.error));
      });

      try {
        this.worker.send({ id, action, args });
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /* ---------------- Clean Shutdown ---------------- */

  async shutdown() {
    if (this.isShutdown) return;
    this.isShutdown = true;

    if (this.workerAlive) {
      try {
        this.worker.send({ action: "shutdown" });
      } catch {}
    }

    await new Promise(resolve => {
      if (!this.workerAlive) return resolve(null);
      this.worker.once("exit", resolve);
      setTimeout(resolve, 250);
    });

    for (const [, cb] of this.pending) {
      cb({ ok: false, error: "IPC shutdown" });
    }

    this.pending.clear();
  }
}

export const dbQueue = new DBQueue();