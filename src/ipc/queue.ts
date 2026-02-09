import { fork, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveWorkerPath() {
  // dist/ipc/queue.js → dist/worker/dbWorker.js
  return path.resolve(__dirname, "../dist/worker/dbWorker.js");
}

export class DBQueue {
  private worker: ChildProcess;
  private seq = 0;
  private pending = new Map<number, (r: any) => void>();
  private isShutdown = false;

  constructor() {
    const workerPath = resolveWorkerPath();

    this.worker = fork(workerPath, [], {
      stdio: ["inherit", "inherit", "inherit", "ipc"],
    });

    this.worker.on("message", (msg: any) => {
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        cb(msg);
      }
    });

    this.worker.on("exit", () => {
      this.isShutdown = true;
    });

    // Auto cleanup
    process.on("exit", () => this.shutdown());
    process.on("SIGINT", () => this.shutdown());
    process.on("SIGTERM", () => this.shutdown());
  }

  exec(action: string, args: any) {
    if (this.isShutdown) {
      return Promise.reject(new Error("DBQueue is shutdown"));
    }

    return new Promise((resolve, reject) => {
      const id = ++this.seq;

      this.pending.set(id, (msg) => {
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error));
      });

      this.worker.send({ id, action, args });
    });
  }

  async shutdown() {
    if (this.isShutdown) return;

    this.isShutdown = true;

    try {
      this.worker.send({ action: "shutdown" });
    } catch {}

    setTimeout(() => {
      try {
        this.worker.kill("SIGTERM");
      } catch {}
    }, 200);
  }
}

export const dbQueue = new DBQueue();
