type CacheEntry<V> = {
  value: V;
  hits: number;
  sizeBytes: number;
  lastAccessAt: number;
};

function stableStringify(value: any): string {
  const seen = new WeakSet<object>();

  const normalize = (v: any): any => {
    if (v === null || v === undefined) return v;
    const t = typeof v;
    if (t === "number" || t === "string" || t === "boolean") return v;
    if (t === "bigint") return v.toString();
    if (t === "function") return "[Function]";
    if (v instanceof Date) return { $date: v.toISOString() };
    if (Array.isArray(v)) return v.map(normalize);
    if (t === "object") {
      if (seen.has(v)) return "[Circular]";
      seen.add(v);
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = normalize(v[k]);
      return out;
    }
    return String(v);
  };

  return JSON.stringify(normalize(value));
}

export type LCRCacheOptions = {
  maxBytes: number;
  maxEntries?: number;
  weight: number;
};

export class LCRCache<V> {
  private map = new Map<string, CacheEntry<V>>();
  private bytes = 0;
  private maxEntries: number;
  private weight: number;

  constructor(options: LCRCacheOptions) {
    this.maxEntries = Math.max(1, Math.trunc(options.maxEntries ?? 50_000));
    this.weight = Math.max(0.0001, Number(options.weight) || 1);
    this.maxBytes = Math.max(1, Math.trunc(options.maxBytes));
  }

  maxBytes: number;

  makeKey(parts: any) {
    return stableStringify(parts);
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }

  delete(key: string) {
    const existing = this.map.get(key);
    if (!existing) return;
    this.map.delete(key);
    this.bytes -= existing.sizeBytes;
  }

  get(key: string): V | null {
    const entry = this.map.get(key);
    if (!entry) return null;
    entry.hits++;
    entry.lastAccessAt = Date.now();
    // refresh insertion order for faster eviction approximation
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V) {
    const now = Date.now();
    const sizeBytes = Buffer.byteLength(stableStringify(value), "utf8");

    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.sizeBytes;
      this.map.delete(key);
    }

    this.map.set(key, {
      value,
      hits: existing ? existing.hits + 1 : 1,
      sizeBytes,
      lastAccessAt: now
    });
    this.bytes += sizeBytes;

    this.evictIfNeeded();
  }

  decay(multiplier: number) {
    const m = Math.min(1, Math.max(0, multiplier));
    if (m === 1) return;

    for (const entry of this.map.values()) {
      entry.hits = Math.max(1, Math.floor(entry.hits * m));
    }
  }

  private score(entry: CacheEntry<V>) {
    // Requested: score = (hits * weight) / size
    return (entry.hits * this.weight) / Math.max(1, entry.sizeBytes);
  }

  private evictIfNeeded() {
    if (this.map.size <= this.maxEntries && this.bytes <= this.maxBytes) return;

    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      let worstKey: string | null = null;
      let worstScore = Number.POSITIVE_INFINITY;

      for (const [k, entry] of this.map) {
        const s = this.score(entry);
        if (s < worstScore) {
          worstScore = s;
          worstKey = k;
        }
      }

      if (!worstKey) break;
      const victim = this.map.get(worstKey);
      this.map.delete(worstKey);
      if (victim) this.bytes -= victim.sizeBytes;
    }
  }
}

