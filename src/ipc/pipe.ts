import net from "net";
import os from "os";
import fs from "fs";
import path from "path";
import type { IPCAction } from "./queue.js";
import type { LioranManager } from "../LioranManager.js";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

type IPCRequest = { id: string; action: IPCAction; args: any };
type IPCResponse = { id: string; ok: true; result: any } | { id: string; ok: false; error: any };

function crc32(input: string): number {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    crc = table[(crc ^ input.charCodeAt(i)) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function getIpcEndpoint(rootPath: string): { kind: "pipe" | "tcp"; address: string } {
  // Endpoint is discovered via a file under rootPath (allows ephemeral ports + avoids collisions).
  const endpointFile = getIpcEndpointFile(rootPath);
  if (!fs.existsSync(endpointFile)) {
    return { kind: "tcp", address: "127.0.0.1:0" };
  }

  try {
    const raw = fs.readFileSync(endpointFile, "utf8");
    const parsed = JSON.parse(raw) as { host: string; port: number };
    if (parsed?.host && typeof parsed.port === "number") {
      return { kind: "tcp", address: `${parsed.host}:${parsed.port}` };
    }
  } catch {}

  return { kind: "tcp", address: "127.0.0.1:0" };
}

export function getIpcEndpointFile(rootPath: string) {
  return path.join(rootPath, ".lioran.ipc.json");
}

export class IPCServer {
  private server: net.Server | null = null;

  constructor(private manager: LioranManager, private rootPath: string) {}

  async start(): Promise<void> {
    if (this.server) return;
    const endpointFile = getIpcEndpointFile(this.rootPath);

    this.server = net.createServer(socket => {
      socket.setNoDelay(true);
      socket.setEncoding("utf8");

      let buf = "";

      socket.on("data", (chunk: string) => {
        buf += chunk;
        while (true) {
          const idx = buf.indexOf("\n");
          if (idx < 0) break;
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          void this.handleLine(line, socket);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      // Always use ephemeral port; publish it for clients.
      this.server!.listen(0, "127.0.0.1", () => resolve());
    });

    const addr = this.server.address();
    if (!addr || typeof addr === "string") {
      throw new LiorandbError("IO_ERROR", "IPC server failed to bind");
    }

    fs.writeFileSync(endpointFile, JSON.stringify({ host: "127.0.0.1", port: addr.port, pid: process.pid, time: Date.now() }));
  }

  private async handleLine(line: string, socket: net.Socket) {
    let msg: IPCRequest;
    try {
      msg = JSON.parse(line);
      if (!msg?.id || !msg?.action) {
        throw new LiorandbError("VALIDATION_FAILED", "Invalid IPC request");
      }
    } catch (err) {
      const res: IPCResponse = { id: "?", ok: false, error: asLiorandbError(err, { code: "INTERNAL", message: "IPC parse failed" }).toJSON() };
      socket.write(JSON.stringify(res) + "\n");
      return;
    }

    try {
      const result = await this.exec(msg.action, msg.args);
      const res: IPCResponse = { id: msg.id, ok: true, result };
      socket.write(JSON.stringify(res) + "\n");
    } catch (err) {
      const res: IPCResponse = {
        id: msg.id,
        ok: false,
        error: asLiorandbError(err, { code: "INTERNAL", message: "IPC exec failed" }).toJSON()
      };
      socket.write(JSON.stringify(res) + "\n");
    }
  }

  private async exec(action: IPCAction, args: any) {
    switch (action) {
    case "db":
      await this.manager.db(args.db);
      return true;
    case "db:meta": {
      const { db, method, params } = args;
      const database = await this.manager.db(db);
      return await (database as any)[method](...params);
    }
    case "op": {
      const { db, col, method, params } = args;
      const collection = (await this.manager.db(db)).collection(col);
      return await (collection as any)[method](...params);
    }
    case "index": {
      const { db, col, method, params } = args;
      const collection = (await this.manager.db(db)).collection(col);
      return await (collection as any)[method](...params);
    }
    case "wal:fetch": {
      const { db, fromLSN, limit } = args;
      const database = await this.manager.db(db);
      return await (database as any).exportWAL(fromLSN ?? 0, limit ?? 10_000);
    }
    case "compact:collection": {
      const { db, col } = args;
      const collection = (await this.manager.db(db)).collection(col);
      await collection.compact();
      return true;
    }
    case "compact:db": {
      const { db } = args;
      const database = await this.manager.db(db);
      await database.compactAll();
      return true;
    }
    case "compact:all": {
      for (const db of this.manager.openDBs.values()) {
        await db.compactAll();
      }
      return true;
    }
    case "snapshot":
      await this.manager.snapshot(args.path);
      return true;
    case "restore":
      await this.manager.restore(args.path);
      return true;
    case "backup:incremental":
      return await (this.manager as any).incrementalBackup(args.path, args.options);
    case "backup:apply":
      return await (this.manager as any).applyIncrementalBackup(args.path, args.options);
    case "shutdown":
      // Respond first, then shutdown in next tick to avoid cutting off the response socket.
      setTimeout(() => void this.manager.closeAll(), 0);
      return true;
    default:
      throw new LiorandbError("UNKNOWN_ACTION", `Unknown action: ${action}`, {
        details: { action }
      });
    }
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    try {
      fs.unlinkSync(getIpcEndpointFile(this.rootPath));
    } catch {}
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }
}

export class IPCClient {
  private socket: net.Socket | null = null;
  private pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private buf = "";

  constructor(private rootPath: string) {}

  private async connect(): Promise<void> {
    if (this.socket && !this.socket.destroyed) return;
    const endpoint = getIpcEndpoint(this.rootPath);
    if (endpoint.address.endsWith(":0")) {
      throw new LiorandbError("IO_ERROR", "IPC primary endpoint not found", {
        details: { rootPath: this.rootPath }
      });
    }

    const socket = new net.Socket();
    socket.setNoDelay(true);
    socket.setEncoding("utf8");

    socket.on("data", (chunk: string) => {
      this.buf += chunk;
      while (true) {
        const idx = this.buf.indexOf("\n");
        if (idx < 0) break;
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (!line.trim()) continue;
        this.onLine(line);
      }
    });

    socket.on("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new LiorandbError("IO_ERROR", "IPC connection closed"));
      }
      this.pending.clear();
    });

    await new Promise<void>((resolve, reject) => {
      socket.once("error", reject);
      const [host, portStr] = endpoint.address.split(":");
      socket.connect(Number(portStr), host, () => resolve());
    }).catch(err => {
      throw asLiorandbError(err, { code: "IO_ERROR", message: "Failed to connect to IPC primary", details: { endpoint } });
    });

    this.socket = socket;
  }

  private onLine(line: string) {
    try {
      const msg = JSON.parse(line) as IPCResponse;
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (msg.ok) entry.resolve(msg.result);
      else entry.reject(msg.error);
    } catch {
      // ignore
    }
  }

  async exec(action: IPCAction, args: any): Promise<any> {
    await this.connect();
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const req: IPCRequest = { id, action, args };

    const p = new Promise<any>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });

    this.socket!.write(JSON.stringify(req) + "\n");
    return p;
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    const sock = this.socket;
    this.socket = null;
    try {
      sock.end();
    } catch {}
    try {
      sock.destroy();
    } catch {}
  }
}
