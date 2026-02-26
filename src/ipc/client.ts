import net from "net";
import { getIPCSocketPath } from "./socketPath.js";

/**
 * Small retry helper
 */
function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Connect with retry (worker might still be booting)
 */
async function connectWithRetry(path: string): Promise<net.Socket> {
  let attempt = 0;

  while (true) {
    try {
      return await new Promise((resolve, reject) => {
        const socket = net.connect(path, () => {
          socket.removeListener("error", reject);
          resolve(socket);
        });

        socket.once("error", reject);
      });
    } catch (err: any) {
      if (err?.code === "ENOENT" || err?.code === "ECONNREFUSED") {
        if (attempt++ > 120) {
          throw new Error(`IPC worker not reachable: ${path}`);
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
  private destroyed = false;

  constructor(rootPath: string, workerId: number) {
    const socketPath = getIPCSocketPath(rootPath, workerId);
    this.ready = this.init(socketPath);
  }

  /* -------------------------------------------------- */
  /* INITIALIZE CONNECTION                              */
  /* -------------------------------------------------- */

  private async init(socketPath: string) {
    this.socket = await connectWithRetry(socketPath);

    this.socket.on("data", data => {
      this.buffer += data.toString();

      while (this.buffer.includes("\n")) {
        const idx = this.buffer.indexOf("\n");
        const raw = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);

        if (!raw.trim()) continue;

        try {
          const msg = JSON.parse(raw);
          const cb = this.pending.get(msg.id);

          if (cb) {
            this.pending.delete(msg.id);
            cb(msg);
          }
        } catch (err) {
          console.error("[IPCClient] Invalid JSON:", err);
        }
      }
    });

    this.socket.on("error", err => {
      console.error("[IPCClient] Socket error:", err);
    });

    this.socket.on("close", () => {
      if (!this.destroyed) {
        console.error("[IPCClient] Socket closed unexpectedly");
      }
    });
  }

  /* -------------------------------------------------- */
  /* EXECUTE REQUEST                                    */
  /* -------------------------------------------------- */

  async exec(action: string, args: any) {
    if (this.destroyed) {
      throw new Error("IPC client already closed");
    }

    await this.ready; // ensure socket connected

    return new Promise((resolve, reject) => {
      const id = ++this.seq;

      this.pending.set(id, msg => {
        msg.ok ? resolve(msg.result) : reject(new Error(msg.error));
      });

      const payload = JSON.stringify({ id, action, args }) + "\n";

      try {
        this.socket.write(payload);
      } catch (err) {
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /* -------------------------------------------------- */
  /* CLOSE                                              */
  /* -------------------------------------------------- */

  close() {
    this.destroyed = true;

    try {
      this.socket.end();
      this.socket.destroy();
    } catch {
      // ignore
    }

    this.pending.clear();
  }
}