import net from "net";
import fs from "fs";
import { LioranManager } from "../LioranManager.js";
import { getIPCSocketPath } from "./socketPath.js";

export class IPCServer {
  private server!: net.Server;
  private manager: LioranManager;
  private socketPath: string;

  constructor(manager: LioranManager, rootPath: string) {
    this.manager = manager;
    this.socketPath = getIPCSocketPath(rootPath);
  }

  start() {
    if (!this.socketPath.startsWith("\\\\.\\")) {
      if (fs.existsSync(this.socketPath)) fs.unlinkSync(this.socketPath);
    }

    this.server = net.createServer(socket => {
      let buffer = "";

      socket.on("data", async data => {
        buffer += data.toString();

        while (buffer.includes("\n")) {
          const idx = buffer.indexOf("\n");
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);

          try {
            const msg = JSON.parse(raw);
            await this.handleMessage(socket, msg);
          } catch (err) {
            socket.write(JSON.stringify({
              id: null,
              ok: false,
              error: "Invalid JSON"
            }) + "\n");
          }
        }
      });
    });

    this.server.listen(this.socketPath, () => {
      console.log("[IPC] Server listening:", this.socketPath);
    });
  }

  private async handleMessage(socket: net.Socket, msg: any) {
    const { id, action, args } = msg;

    try {
      let result: any;

      switch (action) {
        /* ---------------- DB ---------------- */

        case "db": {
          await this.manager.db(args.db);
          result = true;
          break;
        }

        /* ---------------- OPS ---------------- */

        case "op": {
          const { db, col, method, params } = args;
          const collection = (await this.manager.db(db)).collection(col);
          result = await (collection as any)[method](...params);
          break;
        }

        /* ---------------- COMPACTION ---------------- */

        case "compact:collection": {
          const { db, col } = args;
          const collection = (await this.manager.db(db)).collection(col);
          await (collection as any).compact();
          result = true;
          break;
        }

        case "compact:db": {
          const { db } = args;
          const database = await this.manager.db(db);
          await (database as any).compact();
          result = true;
          break;
        }

        case "compact:all": {
          await (this.manager as any).compactAll();
          result = true;
          break;
        }

        /* ---------------- CONTROL ---------------- */

        case "shutdown": {
          await this.manager.closeAll();
          result = true;
          break;
        }

        default:
          throw new Error(`Unknown IPC action: ${action}`);
      }

      socket.write(JSON.stringify({ id, ok: true, result }) + "\n");

    } catch (err: any) {
      socket.write(JSON.stringify({
        id,
        ok: false,
        error: err?.message || "IPC error"
      }) + "\n");
    }
  }

  async close() {
    if (this.server) this.server.close();

    if (!this.socketPath.startsWith("\\\\.\\")) {
      try { fs.unlinkSync(this.socketPath); } catch {}
    }
  }
}