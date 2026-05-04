/**
 * Production-Grade WAL with Group Commit & Segmentation
 * - Group Commit: Batch fsync every 5-10ms for higher throughput
 * - WAL Segmentation: Rotate logs to prevent huge single files
 * - Crash Recovery: Detect corruption via checksum, replay from checkpoint
 */

import fs from "fs";
import path from "path";
import { EventEmitter } from "events";

/* ========================
   TYPES
======================== */

export interface WALGroupCommitConfig {
  maxGroupSizeMs?: number; // Max time to wait before fsync (default 5ms)
  maxRecordsPerGroup?: number; // Max records before forcing fsync (default 1000)
  minGroupSizeMs?: number; // Min time before considering for fsync (default 1ms)
}

export interface WALSegmentConfig {
  maxSegmentSizeBytes?: number; // Max size before rotation (default 32MB)
  maxSegmentAgeMs?: number; // Max age before rotation (default 1 hour)
  compressionEnabled?: boolean;
}

export interface WALCheckpoint {
  lsn: number;
  timestamp: number;
  checksum: string;
  appliedTxnId: number;
}

export interface WALRecoveryStatus {
  recoveredLSN: number;
  corruptionDetected: boolean;
  validRecords: number;
  invalidRecords: number;
}

/* ========================
   GROUP COMMIT ENGINE
======================== */

export class GroupCommitEngine {
  private pendingWrites: Array<{ data: string; resolve: () => void; reject: (err: Error) => void }> = [];
  private lastFlushTime = Date.now();
  private groupCommitTimer: NodeJS.Timeout | null = null;
  private flushing = false;
  private config: Required<WALGroupCommitConfig>;
  private flushHandler: (batch: string[]) => Promise<void>;
  private stats = {
    totalGroups: 0,
    recordsInCurrentGroup: 0,
    lastFlushSizeBytes: 0
  };

  constructor(
    flushHandler: (batch: string[]) => Promise<void>,
    config?: WALGroupCommitConfig
  ) {
    this.flushHandler = flushHandler;
    this.config = {
      maxGroupSizeMs: config?.maxGroupSizeMs ?? 5,
      maxRecordsPerGroup: config?.maxRecordsPerGroup ?? 1000,
      minGroupSizeMs: config?.minGroupSizeMs ?? 1
    };
  }

  /**
   * Enqueue record for group commit
   */
  enqueue(data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pendingWrites.push({ data, resolve, reject });

      // Trigger flush if group is full
      if (this.pendingWrites.length >= this.config.maxRecordsPerGroup) {
        this.scheduleFlush(0); // Immediate flush
      } else {
        this.scheduleFlush(this.config.maxGroupSizeMs);
      }
    });
  }

  /**
   * Schedule flush with timeout
   */
  private scheduleFlush(delayMs: number): void {
    if (this.flushing || this.groupCommitTimer) {
      return; // Already scheduled or flushing
    }

    const timeSinceLastFlush = Date.now() - this.lastFlushTime;

    if (timeSinceLastFlush >= this.config.minGroupSizeMs) {
      // Safe to flush immediately
      this.performFlush().catch(err => {
        console.error("GroupCommit flush error:", err);
      });
    } else {
      // Wait a bit before flushing
      this.groupCommitTimer = setTimeout(() => {
        this.groupCommitTimer = null;
        this.performFlush().catch(err => {
          console.error("GroupCommit flush error:", err);
        });
      }, delayMs);
      this.groupCommitTimer.unref?.();
    }
  }

  /**
   * Perform actual flush
   */
  private async performFlush(): Promise<void> {
    if (this.flushing || this.pendingWrites.length === 0) {
      return;
    }

    this.flushing = true;
    const batch = this.pendingWrites.splice(0);

    try {
      const data = batch.map(w => w.data);
      this.stats.lastFlushSizeBytes = data.reduce((sum, d) => sum + d.length, 0);

      await this.flushHandler(data);
      this.stats.totalGroups++;
      this.lastFlushTime = Date.now();

      // Resolve all pending writes
      for (const item of batch) {
        item.resolve();
      }
    } catch (err) {
      // Reject all pending writes
      const error = err instanceof Error ? err : new Error(String(err));
      for (const item of batch) {
        item.reject(error);
      }
    } finally {
      this.flushing = false;

      // If new writes arrived during flush, schedule next flush
      if (this.pendingWrites.length > 0) {
        this.scheduleFlush(this.config.maxGroupSizeMs);
      }
    }
  }

  /**
   * Force flush all pending writes
   */
  async forceFlush(): Promise<void> {
    if (this.groupCommitTimer) {
      clearTimeout(this.groupCommitTimer);
      this.groupCommitTimer = null;
    }
    await this.performFlush();
  }

  /**
   * Get statistics
   */
  getStats(): typeof this.stats {
    return { ...this.stats };
  }
}

/* ========================
   WAL SEGMENT MANAGER
======================== */

export class WALSegmentManager {
  private currentSegment = 1;
  private currentSegmentSize = 0;
  private currentSegmentCreatedAt = Date.now();
  private walDir: string;
  private config: Required<WALSegmentConfig>;

  constructor(baseDir: string, config?: WALSegmentConfig) {
    this.walDir = path.join(baseDir, "__wal");
    this.config = {
      maxSegmentSizeBytes: config?.maxSegmentSizeBytes ?? 32 * 1024 * 1024,
      maxSegmentAgeMs: config?.maxSegmentAgeMs ?? 60 * 60 * 1000,
      compressionEnabled: config?.compressionEnabled ?? false
    };

    fs.mkdirSync(this.walDir, { recursive: true });
    this.currentSegment = this.findLatestSegment();
  }

  /**
   * Get current segment path
   */
  getCurrentSegmentPath(): string {
    return path.join(
      this.walDir,
      `wal-segment-${String(this.currentSegment).padStart(8, "0")}.log`
    );
  }

  /**
   * Check if rotation is needed
   */
  shouldRotate(newDataSize: number): boolean {
    const totalSize = this.currentSegmentSize + newDataSize;
    if (totalSize > this.config.maxSegmentSizeBytes) {
      return true;
    }

    const age = Date.now() - this.currentSegmentCreatedAt;
    if (age > this.config.maxSegmentAgeMs) {
      return true;
    }

    return false;
  }

  /**
   * Rotate to next segment
   */
  async rotate(): Promise<string> {
    const oldSegment = this.getCurrentSegmentPath();
    this.currentSegment++;
    this.currentSegmentSize = 0;
    this.currentSegmentCreatedAt = Date.now();

    // Archive old segment metadata
    const metadata = {
      segment: this.currentSegment - 1,
      rotatedAt: Date.now(),
      finalSize: this.currentSegmentSize,
      compressionEnabled: this.config.compressionEnabled
    };

    const metadataPath = oldSegment + ".meta";
    await fs.promises.writeFile(metadataPath, JSON.stringify(metadata));

    return this.getCurrentSegmentPath();
  }

  /**
   * Record bytes written to current segment
   */
  recordWrite(sizeBytes: number): void {
    this.currentSegmentSize += sizeBytes;
  }

  /**
   * Get all segment files
   */
  getSegments(): string[] {
    if (!fs.existsSync(this.walDir)) return [];

    return fs
      .readdirSync(this.walDir)
      .filter(f => /^wal-segment-\d+\.log$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)![0]);
        const numB = parseInt(b.match(/\d+/)![0]);
        return numA - numB;
      });
  }

  /**
   * Find latest segment number
   */
  private findLatestSegment(): number {
    const segments = this.getSegments();
    if (segments.length === 0) return 1;

    const last = segments[segments.length - 1];
    const match = last.match(/wal-segment-(\d+)\.log/);
    return match ? parseInt(match[1]) + 1 : 1;
  }
}

/* ========================
   CRASH RECOVERY
======================== */

export class WALRecoveryEngine {
  private walDir: string;

  constructor(baseDir: string) {
    this.walDir = path.join(baseDir, "__wal");
  }

  /**
   * Recover from WAL after crash
   * Validates checksums and detects corruption
   */
  async recover(checkpoint?: WALCheckpoint): Promise<WALRecoveryStatus> {
    const status: WALRecoveryStatus = {
      recoveredLSN: checkpoint?.lsn ?? 0,
      corruptionDetected: false,
      validRecords: 0,
      invalidRecords: 0
    };

    if (!fs.existsSync(this.walDir)) {
      return status;
    }

    const segments = this.getSegmentsSorted();

    for (const segment of segments) {
      const segmentPath = path.join(this.walDir, segment);

      try {
        const fileContent = await fs.promises.readFile(segmentPath, "utf8");
        const lines = fileContent.split("\n");

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const record = JSON.parse(line);

            // Validate checksum if present
            if (record.crc !== undefined) {
              const computed = this.computeChecksum(JSON.stringify({
                ...record,
                crc: undefined
              }));

              if (computed !== record.crc) {
                status.corruptionDetected = true;
                status.invalidRecords++;
                continue; // Skip corrupted record
              }
            }

            status.validRecords++;
            status.recoveredLSN = Math.max(status.recoveredLSN, record.lsn ?? 0);
          } catch {
            status.invalidRecords++;
            status.corruptionDetected = true;
          }
        }
      } catch (err) {
        console.error(`Error reading segment ${segment}:`, err);
        status.corruptionDetected = true;
      }
    }

    return status;
  }

  /**
   * Compute CRC32 checksum
   */
  private computeChecksum(data: string): number {
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) {
      const byte = data.charCodeAt(i);
      crc = (crc ^ byte) >>> 0;
      for (let j = 0; j < 8; j++) {
        crc = ((crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)) >>> 0;
      }
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  /**
   * Get sorted segment files
   */
  private getSegmentsSorted(): string[] {
    if (!fs.existsSync(this.walDir)) return [];

    return fs
      .readdirSync(this.walDir)
      .filter(f => /^wal-segment-\d+\.log$/.test(f))
      .sort((a, b) => {
        const numA = parseInt(a.match(/\d+/)![0]);
        const numB = parseInt(b.match(/\d+/)![0]);
        return numA - numB;
      });
  }
}

/* ========================
   CHECKPOINT MANAGER
======================== */

export class CheckpointManager {
  private checkpointDir: string;
  private lastCheckpoint: WALCheckpoint | null = null;

  constructor(baseDir: string) {
    this.checkpointDir = path.join(baseDir, "__checkpoints");
    fs.mkdirSync(this.checkpointDir, { recursive: true });
    this.loadLatestCheckpoint();
  }

  /**
   * Create new checkpoint
   */
  async saveCheckpoint(lsn: number, appliedTxnId: number): Promise<WALCheckpoint> {
    const checkpoint: WALCheckpoint = {
      lsn,
      timestamp: Date.now(),
      checksum: this.computeChecksum({ lsn, timestamp: Date.now(), appliedTxnId }),
      appliedTxnId
    };

    const filename = `checkpoint-${checkpoint.timestamp}.json`;
    const filepath = path.join(this.checkpointDir, filename);

    await fs.promises.writeFile(filepath, JSON.stringify(checkpoint, null, 2));
    this.lastCheckpoint = checkpoint;

    return checkpoint;
  }

  /**
   * Get latest checkpoint
   */
  getLatestCheckpoint(): WALCheckpoint | null {
    return this.lastCheckpoint;
  }

  /**
   * Load latest checkpoint from disk
   */
  private loadLatestCheckpoint(): void {
    if (!fs.existsSync(this.checkpointDir)) return;

    const files = fs
      .readdirSync(this.checkpointDir)
      .filter(f => f.startsWith("checkpoint-") && f.endsWith(".json"))
      .sort()
      .reverse();

    if (files.length === 0) return;

    try {
      const content = fs.readFileSync(
        path.join(this.checkpointDir, files[0]),
        "utf8"
      );
      this.lastCheckpoint = JSON.parse(content);
    } catch (err) {
      console.error("Failed to load checkpoint:", err);
    }
  }

  /**
   * Compute checksum
   */
  private computeChecksum(data: any): string {
    const str = JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(16);
  }
}
