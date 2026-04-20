import { MemoryPressureGate, type MemoryPressureOptions } from "../utils/memoryPressure.js";

export type BackpressureMode = "wait" | "reject";

export type WriterQueueOptions = {
  maxSize?: number;
  mode?: BackpressureMode;
  timeoutMs?: number;
  memoryPressure?: MemoryPressureOptions;
  onBackpressure?: (info: { pending: number; maxSize: number }) => void;
};

type ReleaseFn = () => void;

class AsyncSemaphore {
  private permits: number;
  private waiters: Array<(release: ReleaseFn) => void> = [];

  constructor(permits: number) {
    this.permits = Math.max(0, Math.trunc(permits));
  }

  get available() {
    return this.permits;
  }

  get waiting() {
    return this.waiters.length;
  }

  tryAcquire(): ReleaseFn | null {
    if (this.permits <= 0) return null;
    this.permits--;
    return () => this.release();
  }

  async acquire(timeoutMs?: number): Promise<ReleaseFn> {
    const immediate = this.tryAcquire();
    if (immediate) return immediate;

    let timeout: NodeJS.Timeout | null = null;
    let done = false;

    const p = new Promise<ReleaseFn>((resolve, reject) => {
      const waiter = (release: ReleaseFn) => {
        if (done) return;
        done = true;
        if (timeout) clearTimeout(timeout);
        resolve(release);
      };

      this.waiters.push(waiter);

      if (timeoutMs !== undefined) {
        const ms = Math.max(0, Math.trunc(timeoutMs));
        timeout = setTimeout(() => {
          if (done) return;
          done = true;
          this.waiters = this.waiters.filter(w => w !== waiter);
          reject(new Error("Write queue backpressure timeout"));
        }, ms);
        timeout.unref?.();
      }
    });

    return p;
  }

  private release() {
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter(() => this.release());
      return;
    }
    this.permits++;
  }
}

export class DedicatedWriter {
  private readonly maxSize: number;
  private readonly mode: BackpressureMode;
  private readonly timeoutMs?: number;
  private readonly semaphore: AsyncSemaphore;
  private readonly memoryGate: MemoryPressureGate;
  private onBackpressure?: (info: { pending: number; maxSize: number }) => void;

  private tail: Promise<void> = Promise.resolve();
  private closed = false;
  private pending = 0;
  private warnedBackpressure = false;

  constructor(options: WriterQueueOptions = {}) {
    this.maxSize = Math.max(1, Math.trunc(options.maxSize ?? 10_000));
    this.mode = options.mode ?? "wait";
    this.timeoutMs = options.timeoutMs;
    this.onBackpressure = options.onBackpressure;

    this.semaphore = new AsyncSemaphore(this.maxSize);
    this.memoryGate = new MemoryPressureGate({
      ...(options.memoryPressure ?? {}),
    });
  }

  getPendingCount() {
    return this.pending;
  }

  async run<R>(task: () => Promise<R>): Promise<R> {
    if (this.closed) {
      throw new Error("Writer is closed");
    }

    await this.memoryGate.waitUntilOk(this.timeoutMs);

    let release: ReleaseFn | null = null;

    if (this.mode === "reject") {
      release = this.semaphore.tryAcquire();
      if (!release) {
        this.onBackpressure?.({ pending: this.pending, maxSize: this.maxSize });
        throw new Error("Write queue is full");
      }
    } else {
      if (this.semaphore.available <= 0 && !this.warnedBackpressure) {
        this.warnedBackpressure = true;
        this.onBackpressure?.({ pending: this.pending, maxSize: this.maxSize });
      }
      release = await this.semaphore.acquire(this.timeoutMs);
      this.warnedBackpressure = false;
    }

    this.pending++;

    const runOne = async () => {
      try {
        return await task();
      } finally {
        this.pending--;
        release?.();
      }
    };

    const resultPromise = this.tail.then(runOne, runOne);
    this.tail = resultPromise.then(
      () => undefined,
      () => undefined
    );

    return resultPromise;
  }

  async drain(): Promise<void> {
    await this.tail;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.memoryGate.close();
    await this.drain();
  }
}
