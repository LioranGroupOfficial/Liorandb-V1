import * as net from "net";
import { EventEmitter } from "events";
import { LiorandbError, asLiorandbError, isLiorandbError } from "../utils/errors.js";
import type { LioranManager } from "../LioranManager.js";

type Req = { id: string; action: string; args: any };
type Res = { id: string; ok: boolean; result?: any; error?: any };

function jsonLine(obj: any) {
  return JSON.stringify(obj) + "\n";
}

export type ClusterRPCServerOptions = {
  host: string;
  port: number;
};

export class ClusterRPCServer {
  private server: net.Server | null = null;

  constructor(
    private manager: LioranManager,
    private opts: ClusterRPCServerOptions
  ) {}

  async start(): Promise<void> {
    if (this.server) return;
    this.server = net.createServer(socket => this.handleSocket(socket));
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.opts.port, this.opts.host, () => resolve());
    });
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const s = this.server;
    this.server = null;
    await new Promise<void>(resolve => s.close(() => resolve()));
  }

  private handleSocket(socket: net.Socket) {
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
        void this.onLine(socket, line);
      }
    });
  }

  private async onLine(socket: net.Socket, line: string) {
    let req: Req;
    try {
      req = JSON.parse(line);
      if (!req || typeof req.id !== "string" || typeof req.action !== "string") {
        throw new LiorandbError("VALIDATION_FAILED", "Invalid RPC request");
      }
    } catch (err) {
      socket.write(jsonLine({ id: "?", ok: false, error: asLiorandbError(err, { code: "VALIDATION_FAILED", message: "RPC parse failed" }).toJSON() } satisfies Res));
      return;
    }

    try {
      // If not leader, return redirect info.
      if ((this.manager as any).isPrimary?.() !== true) {
        const leader = (this.manager as any).clusterLeader ?? null;
        throw new LiorandbError("NOT_LEADER", "Not leader", { details: { leader } });
      }

      const result = await this.execAction(req.action, req.args);
      socket.write(jsonLine({ id: req.id, ok: true, result } satisfies Res));
    } catch (err) {
      const e = asLiorandbError(err, { code: "INTERNAL", message: "RPC failed", details: { action: req.action } });
      socket.write(jsonLine({ id: req.id, ok: false, error: e.toJSON() } satisfies Res));
    }
  }

  private async execAction(action: string, args: any) {
    // Keep this intentionally small: only what app clients need.
    if (action === "db") {
      await (this.manager as any).db(args.db);
      return true;
    }

    if (action === "db:meta") {
      const { db, method, params } = args;
      const database = await (this.manager as any).db(db);
      return await (database as any)[method](...(params ?? []));
    }

    if (action === "op") {
      const { db, col, method, params } = args;
      const collection = (await (this.manager as any).db(db)).collection(col);
      return await (collection as any)[method](...(params ?? []));
    }

    if (action === "index") {
      const { db, col, method, params } = args;
      const collection = (await (this.manager as any).db(db)).collection(col);
      return await (collection as any)[method](...(params ?? []));
    }

    throw new LiorandbError("UNKNOWN_ACTION", `Unknown RPC action: ${action}`, { details: { action } });
  }
}

export type ClusterRPCClientOptions = {
  host: string;
  port: number;
  timeoutMs?: number;
};

export class ClusterRPCClient {
  private socket: net.Socket | null = null;
  private buf = "";
  private inflight = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void; timer?: NodeJS.Timeout }>();
  private connectedHost: string | null = null;
  private connectedPort: number | null = null;

  constructor(private opts: ClusterRPCClientOptions) {}

  private async connect(host: string, port: number) {
    if (this.socket && this.connectedHost === host && this.connectedPort === port) return;
    await this.close();

    this.connectedHost = host;
    this.connectedPort = port;

    this.socket = net.createConnection(port, host);
    this.socket.setNoDelay(true);
    this.socket.setEncoding("utf8");
    this.socket.on("data", (chunk: string) => {
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
    this.socket.on("close", () => {
      for (const [id, p] of this.inflight) {
        try { p.reject(new LiorandbError("IO_ERROR", "RPC socket closed", { details: { id } })); } catch {}
        if (p.timer) clearTimeout(p.timer);
      }
      this.inflight.clear();
      this.socket = null;
      this.connectedHost = null;
      this.connectedPort = null;
    });

    await new Promise<void>((resolve, reject) => {
      this.socket!.once("connect", () => resolve());
      this.socket!.once("error", reject);
    });
  }

  async close(): Promise<void> {
    if (!this.socket) return;
    const s = this.socket;
    this.socket = null;
    await new Promise<void>(resolve => {
      try { s.end(() => resolve()); } catch { resolve(); }
    });
  }

  private onLine(line: string) {
    let msg: Res;
    try { msg = JSON.parse(line); } catch { return; }
    if (!msg || typeof msg.id !== "string") return;
    const p = this.inflight.get(msg.id);
    if (!p) return;
    this.inflight.delete(msg.id);
    if (p.timer) clearTimeout(p.timer);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(msg.error);
  }

  async exec<T>(action: string, args: any, redirect?: { host: string; port: number } | null): Promise<T> {
    const host = redirect?.host ?? this.opts.host;
    const port = redirect?.port ?? this.opts.port;
    await this.connect(host, port);
    if (!this.socket) throw new LiorandbError("IO_ERROR", "RPC not connected");

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const timeoutMs = Math.max(1, Math.trunc(this.opts.timeoutMs ?? 2000));

    const p = new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflight.delete(id);
        reject(new LiorandbError("IO_ERROR", "RPC timeout", { details: { action, timeoutMs } }));
      }, timeoutMs);
      timer.unref?.();
      this.inflight.set(id, { resolve, reject, timer });
    });

    this.socket.write(jsonLine({ id, action, args } satisfies Req));

    try {
      return await p;
    } catch (err: any) {
      // Handle redirect
      const parsed = err && typeof err === "object" ? err : null;
      const code = parsed?.code;
      if (code === "NOT_LEADER" && parsed?.details?.leader && !redirect) {
        const leader = parsed.details.leader;
        if (leader?.host && leader?.clientPort) {
          return await this.exec<T>(action, args, { host: leader.host, port: leader.clientPort });
        }
      }
      if (isLiorandbError(err)) throw err;
      // Server may have sent error JSON; try to rehydrate minimally.
      if (parsed?.code && parsed?.message) {
        throw new LiorandbError(parsed.code, parsed.message, { details: parsed.details });
      }
      throw asLiorandbError(err, { code: "IO_ERROR", message: "RPC exec failed", details: { action } });
    }
  }
}

