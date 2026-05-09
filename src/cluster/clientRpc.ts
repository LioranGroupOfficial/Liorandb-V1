import * as net from "net";
import * as tls from "tls";
import fs from "fs";
import { EventEmitter } from "events";
import { LiorandbError, asLiorandbError, isLiorandbError } from "../utils/errors.js";
import type { LioranManager } from "../LioranManager.js";

type Req = { id: string; action: string; args: any; token?: string };
type Res = { id: string; ok: boolean; result?: any; error?: any };

function jsonLine(obj: any) {
  return JSON.stringify(obj) + "\n";
}

export type ClusterRPCServerOptions = {
  host: string;
  port: number;
  maxMessageBytes?: number;
  auth?: { token?: string; required?: boolean };
  tls?: {
    keyPath: string;
    certPath: string;
    caPath?: string;
    requestCert?: boolean;
  };
};

export class ClusterRPCServer {
  private server: net.Server | null = null;
  private maxMessageBytes: number;
  private authToken: string | null;
  private authRequired: boolean;

  constructor(
    private manager: LioranManager,
    private opts: ClusterRPCServerOptions
  ) {
    this.maxMessageBytes = Math.max(1024, Math.trunc(opts.maxMessageBytes ?? 1024 * 1024));
    this.authToken = opts.auth?.token ? String(opts.auth.token) : null;
    this.authRequired = opts.auth?.required ?? false;
  }

  async start(): Promise<void> {
    if (this.server) return;
    if (this.opts.tls) {
      const key = fs.readFileSync(this.opts.tls.keyPath);
      const cert = fs.readFileSync(this.opts.tls.certPath);
      const ca = this.opts.tls.caPath ? fs.readFileSync(this.opts.tls.caPath) : undefined;
      const srv = tls.createServer(
        {
          key,
          cert,
          ca: ca ? [ca] : undefined,
          requestCert: !!this.opts.tls.requestCert,
          rejectUnauthorized: false
        },
        socket => this.handleSocket(socket)
      );
      this.server = srv as any;
    } else {
      this.server = net.createServer(socket => this.handleSocket(socket));
    }
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
    // Always handle socket errors so they don't become uncaught exceptions in the worker.
    socket.on("error", () => {});
    let buf = "";
    socket.on("data", (chunk: string) => {
      buf += chunk;
      if (buf.length > this.maxMessageBytes) {
        try { socket.destroy(); } catch {}
        return;
      }
      while (true) {
        const idx = buf.indexOf("\n");
        if (idx < 0) break;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        if (line.length > this.maxMessageBytes) {
          try { socket.destroy(); } catch {}
          return;
        }
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
      try {
        socket.write(jsonLine({ id: "?", ok: false, error: asLiorandbError(err, { code: "VALIDATION_FAILED", message: "RPC parse failed" }).toJSON() } satisfies Res));
      } catch {
        // Client may have disconnected mid-write; ignore.
      }
      return;
    }

    try {
      // Token auth (optional/required).
      if (this.authToken) {
        const got = typeof req.token === "string" ? req.token : "";
        if (got !== this.authToken) {
          throw new LiorandbError("VALIDATION_FAILED", "Unauthorized RPC request");
        }
      } else if (this.authRequired) {
        throw new LiorandbError("VALIDATION_FAILED", "RPC auth required");
      }

      // Writes go to leader; reads may be served by followers based on consistency policy.
      const primary = (this.manager as any).isPrimary?.() === true;
      if (!primary && this.requiresLeader(req.action, req.args)) {
        const leader = (this.manager as any).clusterLeader ?? null;
        throw new LiorandbError("NOT_LEADER", "Not leader", { details: { leader } });
      }

      const result = await this.execAction(req.action, req.args);
      try {
        socket.write(jsonLine({ id: req.id, ok: true, result } satisfies Res));
      } catch {
        // Ignore write errors to avoid crashing the worker on client disconnects.
      }
    } catch (err) {
      const e = asLiorandbError(err, { code: "INTERNAL", message: "RPC failed", details: { action: req.action } });
      try {
        socket.write(jsonLine({ id: req.id, ok: false, error: e.toJSON() } satisfies Res));
      } catch {
        // Client may have disconnected mid-write; ignore.
      }
    }
  }

  private requiresLeader(action: string, args: any): boolean {
    // Default to leader-required for safety.
    // `db` open is safe on followers (it does not write to leader state); writes still require leader via `op`.
    if (action === "db") return false;
    if (action === "db:meta") return true;

    if (action === "op") {
      const method = typeof args?.method === "string" ? args.method : "";
      // Explicit read methods we allow on followers; bounded-stale enforcement happens inside the manager.
      const readMethods = new Set([
        "find",
        "findOne",
        "aggregate",
        "explain",
        "count",
        "countDocuments"
      ]);
      return !readMethods.has(method);
    }

    return true;
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
  token?: string;
  maxMessageBytes?: number;
  tls?: {
    caPath?: string;
    servername?: string;
    rejectUnauthorized?: boolean;
  };
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

    if (this.opts.tls) {
      const ca = this.opts.tls.caPath ? fs.readFileSync(this.opts.tls.caPath) : undefined;
      this.socket = tls.connect({
        host,
        port,
        ca: ca ? [ca] : undefined,
        servername: this.opts.tls.servername ?? host,
        rejectUnauthorized: this.opts.tls.rejectUnauthorized ?? false
      }) as any;
    } else {
      this.socket = net.createConnection(port, host);
    }
    const sock = this.socket!;
    sock.setNoDelay(true);
    sock.setEncoding("utf8");
    sock.on("data", (chunk: string) => {
      this.buf += chunk;
      if (this.buf.length > (this.opts.maxMessageBytes ?? 1024 * 1024)) {
        try { this.socket?.destroy(); } catch {}
        return;
      }
      while (true) {
        const idx = this.buf.indexOf("\n");
        if (idx < 0) break;
        const line = this.buf.slice(0, idx);
        this.buf = this.buf.slice(idx + 1);
        if (!line.trim()) continue;
        if (line.length > (this.opts.maxMessageBytes ?? 1024 * 1024)) {
          try { this.socket?.destroy(); } catch {}
          return;
        }
        this.onLine(line);
      }
    });
    sock.on("close", () => {
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
      sock.once("connect", () => resolve());
      sock.once("error", reject);
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

    this.socket.write(jsonLine({ id, action, args, token: this.opts.token } satisfies Req));

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
