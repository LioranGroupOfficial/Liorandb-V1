/**
 * Storage Optimization
 * Bloom filters, compression tuning, and page cache awareness
 */

export type CompressionType = "none" | "snappy" | "zstd" | "deflate";

export interface BloomFilterConfig {
  bitsPerKey?: number; // 1-16, default 10
  hashFunctions?: number; // 1-8, default 5
}

export interface CompressionConfig {
  type: CompressionType;
  level?: number; // 0-11 for zstd, 1-9 for deflate
  sampleSize?: number; // Sample first N bytes to estimate benefit
}

export interface StorageOptimizationConfig {
  bloomFilter?: BloomFilterConfig;
  compression?: CompressionConfig;
  pageCacheEnabled?: boolean;
}

/* ========================
   BLOOM FILTER
======================== */

export class BloomFilter {
  private bits: Uint8Array;
  private hashCount: number;
  private size: number;

  constructor(elementCount: number, bitsPerElement: number = 10) {
    this.size = Math.ceil(elementCount * bitsPerElement / 8);
    this.bits = new Uint8Array(this.size);
    this.hashCount = Math.max(1, Math.ceil((this.size * 8 / elementCount) * Math.LN2));
  }

  /**
   * Add element to filter
   */
  add(element: string): void {
    const hashes = this.getHashes(element);
    for (const hash of hashes) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;
      this.bits[byteIndex] |= 1 << bitIndex;
    }
  }

  /**
   * Test if element might be in set
   */
  mightContain(element: string): boolean {
    const hashes = this.getHashes(element);
    for (const hash of hashes) {
      const byteIndex = Math.floor(hash / 8);
      const bitIndex = hash % 8;
      if (!(this.bits[byteIndex] & (1 << bitIndex))) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get hash values
   */
  private getHashes(element: string): number[] {
    const hashes: number[] = [];
    let hash = this.hash(element);

    for (let i = 0; i < this.hashCount; i++) {
      hashes.push(hash % (this.size * 8));
      hash = this.hash(hash.toString());
    }

    return hashes;
  }

  /**
   * Simple hash function
   */
  private hash(input: string): number {
    let h = 5381;
    for (let i = 0; i < input.length; i++) {
      h = ((h << 5) + h) ^ input.charCodeAt(i);
    }
    return Math.abs(h);
  }

  /**
   * Get size in bytes
   */
  getSize(): number {
    return this.size;
  }

  /**
   * Get serialized form
   */
  serialize(): Buffer {
    return Buffer.from(this.bits);
  }

  /**
   * Deserialize from buffer
   */
  static deserialize(buffer: Buffer, hashCount: number): BloomFilter {
    const filter = Object.create(BloomFilter.prototype);
    filter.bits = new Uint8Array(buffer);
    filter.size = buffer.length;
    filter.hashCount = hashCount;
    return filter;
  }
}

/* ========================
   COMPRESSION ESTIMATOR
======================== */

export class CompressionEstimator {
  /**
   * Estimate compression ratio
   */
  static estimateCompressionRatio(data: Buffer, type: CompressionType): number {
    // Sample first 1KB to estimate
    const sampleSize = Math.min(1024, data.length);
    const sample = data.subarray(0, sampleSize);

    switch (type) {
      case "snappy":
        return this.estimateSnappy(sample);
      case "zstd":
        return this.estimateZstd(sample);
      case "deflate":
        return this.estimateDeflate(sample);
      case "none":
        return 1.0;
      default:
        return 1.0;
    }
  }

  /**
   * Check if compression is beneficial
   */
  static shouldCompress(data: Buffer, type: CompressionType, minRatio: number = 0.8): boolean {
    const ratio = this.estimateCompressionRatio(data, type);
    return ratio < minRatio;
  }

  /**
   * Estimate snappy compression
   */
  private static estimateSnappy(sample: Buffer): number {
    // Snappy is typically 20-40% compression for text
    // Less for binary data
    const isText = this.detectText(sample);
    return isText ? 0.7 : 0.9;
  }

  /**
   * Estimate zstd compression
   */
  private static estimateZstd(sample: Buffer): number {
    // Zstd is better than snappy, typically 10-30% for text
    const isText = this.detectText(sample);
    return isText ? 0.5 : 0.75;
  }

  /**
   * Estimate deflate compression
   */
  private static estimateDeflate(sample: Buffer): number {
    // Deflate similar to zstd, 10-30% for text
    const isText = this.detectText(sample);
    return isText ? 0.55 : 0.8;
  }

  /**
   * Detect if buffer contains mostly text
   */
  private static detectText(buffer: Buffer): boolean {
    let textBytes = 0;
    const sample = Math.min(buffer.length, 512);

    for (let i = 0; i < sample; i++) {
      const byte = buffer[i];
      // Printable ASCII or common UTF-8 bytes
      if ((byte >= 32 && byte <= 126) || byte >= 128) {
        textBytes++;
      }
    }

    return textBytes / sample > 0.8;
  }
}

/* ========================
   PAGE CACHE OPTIMIZER
======================== */

export class PageCacheOptimizer {
  private pageSize = 4096; // Common page size
  private accessLog = new Map<number, number>(); // page -> access count
  private hotPages = new Set<number>();
  private coldPages = new Set<number>();
  private readaheadPattern = new Map<number, number[]>(); // page -> next pages

  /**
   * Record page access
   */
  recordAccess(offset: number): void {
    const pageNum = Math.floor(offset / this.pageSize);

    const count = (this.accessLog.get(pageNum) ?? 0) + 1;
    this.accessLog.set(pageNum, count);

    // Classify pages by access pattern
    if (count > 10) {
      this.hotPages.add(pageNum);
      this.coldPages.delete(pageNum);
    } else if (count < 2) {
      this.coldPages.add(pageNum);
      this.hotPages.delete(pageNum);
    }
  }

  /**
   * Detect sequential access pattern
   */
  detectSequentialAccess(offsets: number[]): boolean {
    if (offsets.length < 3) return false;

    for (let i = 1; i < offsets.length; i++) {
      const prev = Math.floor(offsets[i - 1] / this.pageSize);
      const curr = Math.floor(offsets[i] / this.pageSize);

      if (curr - prev !== 1) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get readahead suggestion
   */
  getReadaheadSuggestion(currentPage: number): number[] {
    if (this.readaheadPattern.has(currentPage)) {
      return this.readaheadPattern.get(currentPage)!;
    }

    // Suggest readahead if hot page
    if (this.hotPages.has(currentPage)) {
      const readahead = [];
      for (let i = 1; i <= 4; i++) {
        readahead.push((currentPage + i) * this.pageSize);
      }
      return readahead;
    }

    return [];
  }

  /**
   * Get cache statistics
   */
  getStats(): {
    hotPageCount: number;
    coldPageCount: number;
    totalPages: number;
    avgAccessCount: number;
  } {
    const pages = Array.from(this.accessLog.values());
    const avg = pages.length > 0 ? pages.reduce((a, b) => a + b, 0) / pages.length : 0;

    return {
      hotPageCount: this.hotPages.size,
      coldPageCount: this.coldPages.size,
      totalPages: this.accessLog.size,
      avgAccessCount: avg
    };
  }

  /**
   * Clear statistics
   */
  clear(): void {
    this.accessLog.clear();
    this.hotPages.clear();
    this.coldPages.clear();
    this.readaheadPattern.clear();
  }
}

/* ========================
   STORAGE TUNER
======================== */

export class StorageTuner {
  private bloomFilterConfig: BloomFilterConfig;
  private compressionConfig: CompressionConfig;
  private pageCacheOptimizer: PageCacheOptimizer;

  constructor(config: StorageOptimizationConfig = {}) {
    this.bloomFilterConfig = config.bloomFilter ?? { bitsPerKey: 10 };
    this.compressionConfig = config.compression ?? { type: "snappy", level: 3 };
    this.pageCacheOptimizer = new PageCacheOptimizer();
  }

  /**
   * Get optimal compression settings
   */
  getOptimalCompression(sampleData: Buffer): CompressionConfig {
    const type = this.compressionConfig.type;
    const ratio = CompressionEstimator.estimateCompressionRatio(sampleData, type);

    // Adjust compression level based on ratio
    let level = this.compressionConfig.level ?? 3;

    if (ratio > 0.9) {
      level = Math.max(1, level - 1); // Less compression if poor ratio
    } else if (ratio < 0.5) {
      level = Math.min(11, level + 1); // More compression if good ratio
    }

    return {
      ...this.compressionConfig,
      level
    };
  }

  /**
   * Get optimal bloom filter settings
   */
  getOptimalBloomFilter(elementCount: number, maxFalsePositiveRate: number = 0.01): BloomFilterConfig {
    // Optimal bits per key ≈ -log2(p) * log(2)^2 where p = false positive rate
    const bitsPerKey = Math.ceil(-Math.log(maxFalsePositiveRate) / Math.LN2 * Math.LN2);

    return {
      bitsPerKey: Math.min(16, Math.max(1, bitsPerKey)),
      hashFunctions: Math.ceil(bitsPerKey * Math.LN2)
    };
  }

  /**
   * Record data access for analysis
   */
  recordAccess(offset: number): void {
    this.pageCacheOptimizer.recordAccess(offset);
  }

  /**
   * Get tuning recommendations
   */
  getRecommendations(): string[] {
    const recommendations: string[] = [];
    const stats = this.pageCacheOptimizer.getStats();

    if (stats.hotPageCount > stats.coldPageCount * 3) {
      recommendations.push("Consider using readahead for hot pages");
    }

    if (stats.avgAccessCount < 2) {
      recommendations.push("Many single-access pages; consider higher bloom filter bits per key");
    }

    if (this.compressionConfig.type === "none") {
      recommendations.push("Consider enabling compression (snappy or zstd)");
    }

    return recommendations;
  }

  /**
   * Get all tuning stats
   */
  getStats(): object {
    return {
      bloomFilter: this.bloomFilterConfig,
      compression: this.compressionConfig,
      pageCache: this.pageCacheOptimizer.getStats()
    };
  }
}
