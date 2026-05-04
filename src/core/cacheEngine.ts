import { LCRCache } from "./lcrCache.js";

export type GlobalCacheConfig = {
  enabled: boolean;
  maxRAMMB: number;
  decay: {
    intervalMs: number;
    multiplier: number;
  };
  partitions: {
    query: number;
    docs: number;
    index: number;
  };
};

const DEFAULT_CONFIG: GlobalCacheConfig = {
  enabled: true,
  maxRAMMB: 512,
  decay: {
    intervalMs: 30_000,
    multiplier: 0.9
  },
  partitions: {
    query: 0.7,
    docs: 0.2,
    index: 0.1
  }
};

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

export class GlobalCacheEngine {
  readonly query: LCRCache<any[]>;
  readonly docs: LCRCache<any>;
  readonly index: LCRCache<any>;

  private decayTimer?: NodeJS.Timeout;
  private enabled: boolean;

  constructor(config?: Partial<GlobalCacheConfig>) {
    const merged: GlobalCacheConfig = {
      ...DEFAULT_CONFIG,
      ...config,
      decay: { ...DEFAULT_CONFIG.decay, ...(config?.decay ?? {}) },
      partitions: { ...DEFAULT_CONFIG.partitions, ...(config?.partitions ?? {}) }
    };

    this.enabled = !!merged.enabled;

    const maxBytes = Math.max(1, Math.trunc((merged.maxRAMMB || 512) * 1024 * 1024));
    const qPart = clamp01(merged.partitions.query);
    const dPart = clamp01(merged.partitions.docs);
    const iPart = clamp01(merged.partitions.index);
    const sum = qPart + dPart + iPart || 1;

    const qBytes = Math.max(1, Math.trunc((qPart / sum) * maxBytes));
    const dBytes = Math.max(1, Math.trunc((dPart / sum) * maxBytes));
    const iBytes = Math.max(1, Math.trunc((iPart / sum) * maxBytes));

    // Weighting: prefer keeping doc cache entries a bit more than query results,
    // and prefer index cache the least by default.
    this.query = new LCRCache<any[]>({ maxBytes: qBytes, weight: 1.0 });
    this.docs = new LCRCache<any>({ maxBytes: dBytes, weight: 1.25 });
    this.index = new LCRCache<any>({ maxBytes: iBytes, weight: 0.75 });

    if (this.enabled) {
      const intervalMs = Math.max(1000, Math.trunc(merged.decay.intervalMs));
      const multiplier = Math.max(0, Math.min(1, Number(merged.decay.multiplier) || 1));
      this.decayTimer = setInterval(() => {
        this.query.decay(multiplier);
        this.docs.decay(multiplier);
        this.index.decay(multiplier);
      }, intervalMs);
      // don't keep the process alive just for decay
      this.decayTimer.unref?.();
    }
  }

  isEnabled() {
    return this.enabled;
  }

  close() {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = undefined;
    }
  }

  clearAll() {
    this.query.clear();
    this.docs.clear();
    this.index.clear();
  }
}

