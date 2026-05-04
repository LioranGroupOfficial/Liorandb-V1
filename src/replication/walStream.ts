import net from "net";
import { EventEmitter } from "events";
import type { LioranManager } from "../LioranManager.js";
import type { LioranDB } from "../core/database.js";
import type { WALRecord } from "../core/wal.js";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

type SubscribeMsg = { type: "subscribe"; db: string; fromLSN: number };
type AckMsg = { type: "ack"; db: string; lsn: number };

type ServerMsg = { type: "records"; db: string; records: WALRecord[] };
type ServerHello = { type: "hello"; node?: string };

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function safeJsonLine(obj: any) {
  return JSON.stringify(obj) + "\n";
}

export type WALStreamServerOptions = {
  host: string;
  port: number;
  nodeId?: string;
  /**
   * Micro-batching to keep replication near-real-time while reducing syscalls.
   */
  flushDelayMs?: number;
};

type SubState = {
  socket: net.Socket;
  db: string;
  lastAckLSN: number;
  unsub?: () => void;
  pending: WALRecord[];
  flushTimer: NodeJS.Timeout | null;
};

export class WALStreamServer {
  private server: net.Server | null = null;
  private subsByDb = new Map<string, Set<SubState>>();
  private events = new EventEmitter();
  private boundPort: number | null = null;

  constructor(
    private manager: LioranManager,
    private opts: WALStreamServerOptions
  ) {}

  onAck(listener: (info: { db: string; socket: net.Socket; lsn: number }) => void): () => void {
    this.events.on("ack", listener);
    return () => this.events.off("ack", listener);
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = net.createServer(socket => {
      socket.setNoDelay(true);
      socket.setEncoding("utf8");
      socket.write(safeJsonLine({ type: "hello", node: this.opts.nodeId } satisfies ServerHello));

      let buf = "";
      socket.on("data", (chunk: string) => {
        buf += chunk;
        while (true) {
          const idx = buf.indexOf("\n");
          if (idx < 0) break;
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          void this.handleClientLine(socket, line);
        }
      });

      socket.on("close", () => {
        for (const set of this.subsByDb.values()) {
          for (const sub of set) {
            if (sub.socket !== socket) continue;
            this.dropSub(sub);
          }
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.opts.port, this.opts.host, () => resolve());
    });

    const addr = this.server.address();
    if (addr && typeof addr !== "string") {
      this.boundPort = addr.port;
    }
  }

  getPort(): number {
    return this.boundPort ?? this.opts.port;
  }

  async close(): Promise<void> {
    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    for (const set of this.subsByDb.values()) {
      for (const sub of set) this.dropSub(sub);
    }
    this.subsByDb.clear();
    await new Promise<void>(resolve => srv.close(() => resolve()));
  }

  private dropSub(sub: SubState) {
    try { sub.unsub?.(); } catch {}
    sub.unsub = undefined;
    if (sub.flushTimer) {
      try { clearTimeout(sub.flushTimer); } catch {}
      sub.flushTimer = null;
    }
    sub.pending.length = 0;

    const set = this.subsByDb.get(sub.db);
    if (set) {
      set.delete(sub);
      if (set.size === 0) this.subsByDb.delete(sub.db);
    }
  }

  private async handleClientLine(socket: net.Socket, line: string) {
    let msg: SubscribeMsg | AckMsg;
    try {
      msg = JSON.parse(line);
      if (!msg || typeof (msg as any).type !== "string") {
        throw new LiorandbError("VALIDATION_FAILED", "Invalid WAL stream message");
      }
    } catch (err) {
      socket.write(safeJsonLine({ type: "error", error: asLiorandbError(err, { code: "VALIDATION_FAILED", message: "WAL stream parse failed" }).toJSON() }));
      return;
    }

    if (msg.type === "ack") {
      const { db, lsn } = msg;
      for (const sub of this.subsByDb.get(db) ?? []) {
        if (sub.socket !== socket) continue;
        sub.lastAckLSN = Math.max(sub.lastAckLSN, lsn);
        this.events.emit("ack", { db, socket, lsn: sub.lastAckLSN });
      }
      return;
    }

    if (msg.type === "subscribe") {
      const dbName = msg.db;
      const fromLSN = Math.max(0, Math.trunc(msg.fromLSN ?? 0));

      // Catch up with a bounded batch before switching to streaming.
      const db = await this.manager.db(dbName);
      const { records } = await (db as any).exportWAL(fromLSN, 10_000);
      if (Array.isArray(records) && records.length > 0) {
        socket.write(safeJsonLine({ type: "records", db: dbName, records } satisfies ServerMsg));
      }

      const sub: SubState = {
        socket,
        db: dbName,
        lastAckLSN: fromLSN,
        pending: [],
        flushTimer: null
      };

      const set = this.subsByDb.get(dbName) ?? new Set<SubState>();
      set.add(sub);
      this.subsByDb.set(dbName, set);

      const wal = (db as any).wal as { onAppend?: (fn: (r: WALRecord) => void) => () => void };
      sub.unsub = wal?.onAppend?.((r: WALRecord) => {
        // Buffer and flush in small batches (target < 10ms).
        sub.pending.push(r);
        this.scheduleFlush(sub);
      });

      return;
    }
  }

  private scheduleFlush(sub: SubState) {
    if (sub.flushTimer) return;
    const delay = Math.max(0, Math.trunc(this.opts.flushDelayMs ?? 5));
    sub.flushTimer = setTimeout(() => {
      sub.flushTimer = null;
      if (sub.pending.length === 0) return;
      const batch = sub.pending.splice(0, sub.pending.length);
      try {
        sub.socket.write(safeJsonLine({ type: "records", db: sub.db, records: batch } satisfies ServerMsg));
      } catch {
        this.dropSub(sub);
      }
    }, delay);
  }
}

export type WALStreamClientOptions = {
  host: string;
  port: number;
  /**
   * Optional soft limit to avoid building very large apply batches.
   */
  maxApplyBatch?: number;
};

export class WALStreamClient {
  private socket: net.Socket | null = null;
  private stopped = false;
  private buf = "";
  private pendingByDb = new Map<string, WALRecord[]>();
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(private opts: WALStreamClientOptions) {}

  async start(): Promise<void> {
    if (this.socket) return;
    this.socket = net.createConnection(this.opts.port, this.opts.host);
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

    await new Promise<void>((resolve, reject) => {
      this.socket!.once("connect", () => resolve());
      this.socket!.once("error", reject);
    });
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.flushTimer) {
      try { clearTimeout(this.flushTimer); } catch {}
      this.flushTimer = null;
    }
    if (this.socket) {
      const s = this.socket;
      this.socket = null;
      await new Promise<void>(resolve => {
        try {
          s.end(() => resolve());
        } catch {
          resolve();
        }
      });
    }
  }

  subscribe(dbName: string, fromLSN: number) {
    if (!this.socket) throw new LiorandbError("INTERNAL", "WALStreamClient not started");
    this.socket.write(safeJsonLine({ type: "subscribe", db: dbName, fromLSN: Math.max(0, Math.trunc(fromLSN)) } satisfies SubscribeMsg));
  }

  /**
   * Connects this client to a local replica DB instance.
   * The provided `getDb` callback should return a DB in replica mode.
   */
  bindReplica(getDb: (name: string) => Promise<LioranDB>) {
    const maxBatch = Math.max(1, Math.trunc(this.opts.maxApplyBatch ?? 5_000));

    const flush = async () => {
      this.flushTimer = null;
      for (const [dbName, records] of this.pendingByDb.entries()) {
        if (records.length === 0) continue;
        const batch = records.splice(0, records.length);
        try {
          const db = await getDb(dbName);
          const last = await (db as any).applyReplicatedWAL(batch);
          this.socket?.write(safeJsonLine({ type: "ack", db: dbName, lsn: last } satisfies AckMsg));
        } catch {
          // On local apply failure, just stop acking (leader will retry via stream).
        }
      }
    };

    const schedule = () => {
      if (this.flushTimer) return;
      this.flushTimer = setTimeout(() => void flush(), 0);
    };

    this.eventsOnRecords = (dbName: string, records: WALRecord[]) => {
      if (this.stopped) return;
      const arr = this.pendingByDb.get(dbName) ?? [];
      arr.push(...records);
      // Bound memory: if a leader bursts, apply in multiple batches quickly.
      if (arr.length > maxBatch) {
        // split and keep tail
        const keep = arr.splice(arr.length - maxBatch, maxBatch);
        arr.length = 0;
        arr.push(...keep);
      }
      this.pendingByDb.set(dbName, arr);
      schedule();
    };
  }

  private eventsOnRecords: ((db: string, records: WALRecord[]) => void) | null = null;

  private onLine(line: string) {
    let msg: any;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }

    if (msg?.type === "records" && typeof msg.db === "string" && Array.isArray(msg.records)) {
      this.eventsOnRecords?.(msg.db, msg.records as WALRecord[]);
    }
  }
}
