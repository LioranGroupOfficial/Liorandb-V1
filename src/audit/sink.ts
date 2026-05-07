import fs from "fs";
import path from "path";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

export type AuditEvent =
  | {
      t: number;
      kind: "wal";
      db: string;
      lsn: number;
      tx: number;
      type: string;
      time?: number;
      payload?: unknown;
    }
  | {
      t: number;
      kind: "security";
      action: string;
      db?: string;
      collection?: string;
      principalId?: string;
      ok: boolean;
      reason?: string;
    };

export type AuditSinkOptions = {
  dir: string;
  fileName?: string;
  flushDelayMs?: number;
  maxBufferEvents?: number;
  redact?: (e: AuditEvent) => AuditEvent;
};

export class AuditSink {
  private filePath: string;
  private flushDelayMs: number;
  private maxBufferEvents: number;
  private redact: (e: AuditEvent) => AuditEvent;

  private buf: AuditEvent[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(opts: AuditSinkOptions) {
    if (!opts?.dir) throw new LiorandbError("VALIDATION_FAILED", "Audit sink dir is required");
    fs.mkdirSync(opts.dir, { recursive: true });
    this.filePath = path.join(opts.dir, opts.fileName ?? "audit.jsonl");
    this.flushDelayMs = Math.max(0, Math.trunc(opts.flushDelayMs ?? 10));
    this.maxBufferEvents = Math.max(1, Math.trunc(opts.maxBufferEvents ?? 10_000));
    this.redact = opts.redact ?? (e => e);
  }

  append(e: AuditEvent) {
    if (this.closed) return;
    if (this.buf.length >= this.maxBufferEvents) {
      // Drop rather than blocking writes. This is an audit best-effort sink.
      this.buf.shift();
    }
    this.buf.push(this.redact(e));
    this.scheduleFlush();
  }

  private scheduleFlush() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush().catch(() => {});
    }, this.flushDelayMs);
    this.timer.unref?.();
  }

  async flush(): Promise<void> {
    if (this.closed) return;
    if (this.buf.length === 0) return;
    const batch = this.buf.splice(0, this.buf.length);
    const lines = batch.map(ev => JSON.stringify(ev)).join("\n") + "\n";
    this.flushing = this.flushing.then(async () => {
      try {
        await fs.promises.appendFile(this.filePath, lines, "utf8");
      } catch (err) {
        throw asLiorandbError(err, {
          code: "IO_ERROR",
          message: "Audit write failed",
          details: { filePath: this.filePath }
        });
      }
    });
    await this.flushing;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.timer) {
      try { clearTimeout(this.timer); } catch {}
      this.timer = null;
    }
    try { await this.flush(); } catch {}
  }
}

