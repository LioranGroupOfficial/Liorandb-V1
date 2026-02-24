import net from "net";
import { getIPCSocketPath } from "./socketPath.js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function connectWithRetry(path: string): Promise<net.Socket> {
  let attempt = 0;

  while (true) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.connect(path, () => resolve(socket));
        socket.once("error", reject);
      });
    } catch (err: any) {
      if (err.code === "ENOENT" || err.code === "ECONNREFUSED") {
        if (attempt++ > 80) {
          throw new Error("IPC server not reachable");
        }
        await delay(50);
        continue;
      }
      throw err;
    }
  }
}

export class IPCClient {
  private socket!: net.Socket;
  private buffer = "";
  private seq = 0;
  private pending = new Map<number, (v: any) => void>();
  private ready: Promise<void>;

  constructor(rootPath: string) {
    const socketPath = getIPCSocketPath(rootPath);
    this.ready = this.init(socketPath);
  }

  private async init(socketPath: string) {
    this.socket = await connectWithRetry(socketPath);

    this.socket.on("data", data => {
      this.buffer += data.toString();

      while (this.buffer.includes("\n")) {
        const idx = this.buffer.indexOf("\n");
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);

        const msg = JSON.parse(raw);
        const cb = this.pending.get(msg.id);

        if (cb) {
          this.pending.delete(msg.id);
          cb(msg);
        }
      }
    });

    this.socket.on("error", err => {
      console.error("IPC socket error:", err);
    });
  }

  async exec(action: string, args: any) {
    await this.ready;   // 🔥 HARD BARRIER — guarantees socket exists

    return new Promise((resolve, reject) => {
      const id = ++this.seq;

      this.pending.set(id, msg => {
        msg.ok ? resolve(msg.result) : reject(new Error(msg.error));
      });

      this.socket.write(JSON.stringify({ id, action, args }) + "\n");
    });
  }

  close() {
    try { this.socket.end(); } catch {}
  }
}