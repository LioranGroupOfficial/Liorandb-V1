import v8 from "v8";

export type MemoryPressureOptions = {
  enabled?: boolean;
  pollMs?: number;
  mode?: "heap_ratio" | "rss_mb";
  highWaterMark?: number; // 0..1
  lowWaterMark?: number; // 0..1
  rssMaxMB?: number;
  rssResumeMB?: number;
  onPressureStart?: (info: MemoryPressureInfo) => void;
  onPressureEnd?: (info: MemoryPressureInfo) => void;
};

export type MemoryPressureInfo = {
  rss: number;
  rssMB: number;
  heapUsed: number;
  heapLimit: number;
  ratio: number;
};

function clamp01(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

export class MemoryPressureGate {
  private enabled: boolean;
  private pollMs: number;
  private mode: "heap_ratio" | "rss_mb";
  private high: number;
  private low: number;
  private rssMaxMB: number;
  private rssResumeMB: number;
  private timer: NodeJS.Timeout | null = null;
  private pressured = false;
  private waiters: Array<() => void> = [];
  private closed = false;

  private onPressureStart?: (info: MemoryPressureInfo) => void;
  private onPressureEnd?: (info: MemoryPressureInfo) => void;

  constructor(options: MemoryPressureOptions = {}) {
    this.enabled = options.enabled ?? true;
    const inferredMode =
      (typeof options.rssMaxMB === "number" && Number.isFinite(options.rssMaxMB)) ||
      (typeof options.rssResumeMB === "number" && Number.isFinite(options.rssResumeMB))
        ? "rss_mb"
        : "heap_ratio";
    this.mode = options.mode ?? inferredMode;

    const defaultPollMs = this.mode === "rss_mb" ? 2000 : 500;
    this.pollMs = Math.max(50, Math.trunc(options.pollMs ?? defaultPollMs));

    this.high = clamp01(options.highWaterMark ?? 0.7);
    this.low = clamp01(options.lowWaterMark ?? 0.6);
    this.rssMaxMB = Math.max(0, Number(options.rssMaxMB ?? 1024));
    this.rssResumeMB = Math.max(0, Number(options.rssResumeMB ?? 768));
    this.onPressureStart = options.onPressureStart;
    this.onPressureEnd = options.onPressureEnd;

    if (this.low > this.high) {
      const mid = (this.low + this.high) / 2;
      this.high = mid;
      this.low = mid;
    }

    if (this.rssResumeMB > this.rssMaxMB) {
      const mid = (this.rssResumeMB + this.rssMaxMB) / 2;
      this.rssMaxMB = mid;
      this.rssResumeMB = mid;
    }

    if (this.enabled) {
      this.timer = setInterval(() => this.poll(), this.pollMs);
      this.timer.unref?.();
    }
  }

  private info(): MemoryPressureInfo {
    const usage = process.memoryUsage();
    const rss = usage.rss;
    const rssMB = rss / 1024 / 1024;
    const heapUsed = usage.heapUsed;
    const heapLimit = v8.getHeapStatistics().heap_size_limit || 0;
    const ratio = heapLimit > 0 ? heapUsed / heapLimit : 0;
    return { rss, rssMB, heapUsed, heapLimit, ratio };
  }

  private poll() {
    if (this.closed || !this.enabled) return;

    const info = this.info();
    const nextPressured = this.mode === "rss_mb"
      ? (
          this.pressured
            ? info.rssMB >= this.rssResumeMB
            : info.rssMB >= this.rssMaxMB
        )
      : (
          this.pressured
            ? info.ratio >= this.low
            : info.ratio >= this.high
        );

    if (nextPressured === this.pressured) return;

    this.pressured = nextPressured;

    if (this.pressured) {
      this.onPressureStart?.(info);
      return;
    }

    this.onPressureEnd?.(info);
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  isPressured() {
    return this.pressured;
  }

  async waitUntilOk(timeoutMs?: number): Promise<void> {
    if (!this.enabled || this.closed) return;
    if (!this.pressured) return;

    await new Promise<void>((resolve, reject) => {
      let timeout: NodeJS.Timeout | null = null;
      let done = false;

      const finish = (fn: () => void) => {
        if (done) return;
        done = true;
        if (timeout) clearTimeout(timeout);
        fn();
      };

      const waiter = () => finish(resolve);
      this.waiters.push(waiter);

      if (timeoutMs !== undefined) {
        const ms = Math.max(0, Math.trunc(timeoutMs));
        timeout = setTimeout(() => {
          finish(() => {
            this.waiters = this.waiters.filter(w => w !== waiter);
            reject(new Error("Memory pressure backpressure timeout"));
          });
        }, ms);
        timeout.unref?.();
      }
    });
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }
}
