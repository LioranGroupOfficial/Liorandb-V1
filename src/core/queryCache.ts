type CacheEntry<V> = {
  value: V;
  hits: number;
  lastAccessAt: number;
  sizeBytes: number;
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
      const keys = Object.keys(v).sort();
      for (const k of keys) out[k] = normalize(v[k]);
      return out;
    }
    return String(v);
  };

  return JSON.stringify(normalize(value));
}

export class QueryResultCache<V> {
  private map = new Map<string, CacheEntry<V>>();
  private bytes = 0;

  constructor(
    private readonly maxEntries = 250,
    private readonly maxBytes = 8 * 1024 * 1024
  ) {}

  makeKey(parts: any): string {
    return stableStringify(parts);
  }

  clear() {
    this.map.clear();
    this.bytes = 0;
  }

  get(key: string): V | null {
    const entry = this.map.get(key);
    if (!entry) return null;

    entry.hits++;
    entry.lastAccessAt = Date.now();
    // refresh recency in insertion order
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V) {
    const now = Date.now();
    const serialized = stableStringify(value);
    const sizeBytes = Buffer.byteLength(serialized, "utf8");

    const existing = this.map.get(key);
    if (existing) {
      this.bytes -= existing.sizeBytes;
      this.map.delete(key);
    }

    const entry: CacheEntry<V> = {
      value,
      hits: existing ? existing.hits + 1 : 1,
      lastAccessAt: now,
      sizeBytes
    };

    this.map.set(key, entry);
    this.bytes += sizeBytes;

    this.evictIfNeeded();
  }

  private score(entry: CacheEntry<V>, now: number) {
    // LCR: evict least "value" entries.
    // Higher hits, more recent, and larger results are treated as more valuable to keep.
    const ageMs = Math.max(0, now - entry.lastAccessAt);
    const recency = 1 / (ageMs + 1);
    return entry.hits * recency * Math.max(1, entry.sizeBytes);
  }

  private evictIfNeeded() {
    if (this.map.size <= this.maxEntries && this.bytes <= this.maxBytes) return;

    const now = Date.now();

    while (this.map.size > this.maxEntries || this.bytes > this.maxBytes) {
      let worstKey: string | null = null;
      let worstScore = Number.POSITIVE_INFINITY;

      for (const [k, entry] of this.map) {
        const s = this.score(entry, now);
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

