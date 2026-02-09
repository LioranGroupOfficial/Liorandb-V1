import { fork, ChildProcess } from "child_process";
import path from "path";

export class DBQueue {
  private worker: ChildProcess;
  private seq = 0;
  private pending = new Map<number, (r: any) => void>();

  constructor() {
    this.worker = fork(path.resolve("dist/worker/dbWorker.js"));

    this.worker.on("message", (msg: any) => {
      const cb = this.pending.get(msg.id);
      if (cb) {
        this.pending.delete(msg.id);
        cb(msg);
      }
    });
  }

  exec(action: string, args: any) {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;

      this.pending.set(id, (msg) => {
        if (msg.ok) resolve(msg.result);
        else reject(new Error(msg.error));
      });

      this.worker.send({ id, action, args });
    });
  }
}

export const dbQueue = new DBQueue();
