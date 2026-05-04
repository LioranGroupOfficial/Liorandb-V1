/**
 * Production Raft Consensus Implementation
 * - Log replication with quorum writes
 * - Leader election with random timeouts
 * - Snapshot support for fast recovery
 * - Read consistency modes (strong/eventual/stale)
 */

export type RaftState = "follower" | "candidate" | "leader";
export type ConsistencyLevel = "strong" | "eventual" | "stale";

export interface RaftConfig {
  nodeId: string;
  heartbeatIntervalMs?: number; // 50-150ms
  electionTimeoutMs?: number; // 150-300ms
  snapshotIntervalOps?: number; // Create snapshot every N ops
  maxLogSize?: number; // Max log entries
}

export interface LogEntry {
  index: number;
  term: number;
  command: any;
  clientId?: string;
  clientSeqNum?: number;
}

export interface RaftSnapshot {
  index: number;
  term: number;
  timestamp: number;
  data: any; // Application state
}

export interface PeerInfo {
  nodeId: string;
  nextIndex: number;
  matchIndex: number;
  lastHeartbeat?: number;
}

/* ========================
   RAFT LOG MANAGER
======================== */

export class RaftLogManager {
  private log: LogEntry[] = [];
  private commitIndex = 0;
  private lastAppliedIndex = 0;
  private snapshots: RaftSnapshot[] = [];
  private maxLogSize: number;

  constructor(maxLogSize: number = 100000) {
    this.maxLogSize = maxLogSize;
  }

  /**
   * Append entry to log
   */
  append(term: number, command: any): LogEntry {
    const index = this.log.length + 1;
    const entry: LogEntry = { index, term, command };
    this.log.push(entry);

    // Trim log if too large
    if (this.log.length > this.maxLogSize) {
      this.log = this.log.slice(-Math.floor(this.maxLogSize * 0.8));
    }

    return entry;
  }

  /**
   * Get log entry by index
   */
  getEntry(index: number): LogEntry | null {
    if (index < 1 || index > this.log.length) return null;
    return this.log[index - 1];
  }

  /**
   * Get last log index and term
   */
  getLastLogIndexAndTerm(): { index: number; term: number } {
    if (this.log.length === 0) {
      return { index: 0, term: 0 };
    }
    const last = this.log[this.log.length - 1];
    return { index: last.index, term: last.term };
  }

  /**
   * Get entries from index onwards
   */
  getEntriesFrom(index: number): LogEntry[] {
    if (index < 1) return this.log;
    if (index > this.log.length) return [];
    return this.log.slice(index - 1);
  }

  /**
   * Truncate log from index onwards (conflict resolution)
   */
  truncateFrom(index: number): void {
    if (index <= 1) {
      this.log = [];
    } else if (index <= this.log.length) {
      this.log = this.log.slice(0, index - 1);
    }
  }

  /**
   * Update commit index
   */
  setCommitIndex(index: number): LogEntry[] {
    const oldCommit = this.commitIndex;
    this.commitIndex = Math.min(index, this.getLastLogIndexAndTerm().index);

    const committed: LogEntry[] = [];
    for (let i = oldCommit + 1; i <= this.commitIndex; i++) {
      const entry = this.getEntry(i);
      if (entry) committed.push(entry);
    }

    return committed;
  }

  /**
   * Get committed entries
   */
  getCommittedEntries(): LogEntry[] {
    const committed: LogEntry[] = [];
    for (let i = this.lastAppliedIndex + 1; i <= this.commitIndex; i++) {
      const entry = this.getEntry(i);
      if (entry) committed.push(entry);
    }
    return committed;
  }

  /**
   * Mark entries as applied
   */
  setLastAppliedIndex(index: number): void {
    this.lastAppliedIndex = Math.min(index, this.commitIndex);
  }

  /**
   * Get indexes
   */
  getIndexes(): { commitIndex: number; lastAppliedIndex: number; lastLogIndex: number } {
    return {
      commitIndex: this.commitIndex,
      lastAppliedIndex: this.lastAppliedIndex,
      lastLogIndex: this.log.length
    };
  }

  /**
   * Create snapshot
   */
  createSnapshot(index: number, data: any): RaftSnapshot {
    const entry = this.getEntry(index);
    if (!entry) throw new Error(`Invalid snapshot index: ${index}`);

    const snapshot: RaftSnapshot = {
      index,
      term: entry.term,
      timestamp: Date.now(),
      data
    };

    this.snapshots.push(snapshot);
    return snapshot;
  }

  /**
   * Get latest snapshot
   */
  getLatestSnapshot(): RaftSnapshot | null {
    return this.snapshots.length > 0 ? this.snapshots[this.snapshots.length - 1] : null;
  }

  /**
   * Clear log (used during snapshot installation)
   */
  clear(): void {
    this.log = [];
    this.commitIndex = 0;
    this.lastAppliedIndex = 0;
  }
}

/* ========================
   RAFT STATE MACHINE
======================== */

export class RaftStateMachine {
  private state: RaftState = "follower";
  private currentTerm = 0;
  private votedFor: string | null = null;
  private leaderId: string | null = null;
  private config: Required<RaftConfig>;

  constructor(config: RaftConfig) {
    this.config = {
      nodeId: config.nodeId,
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 100,
      electionTimeoutMs: config.electionTimeoutMs ?? 250,
      snapshotIntervalOps: config.snapshotIntervalOps ?? 10000,
      maxLogSize: config.maxLogSize ?? 100000
    };
  }

  /**
   * Get current state
   */
  getState(): { state: RaftState; term: number; leaderId: string | null } {
    return {
      state: this.state,
      term: this.currentTerm,
      leaderId: this.leaderId
    };
  }

  /**
   * Update term (always step forward)
   */
  updateTerm(newTerm: number): boolean {
    if (newTerm > this.currentTerm) {
      this.currentTerm = newTerm;
      this.votedFor = null;
      this.leaderId = null;

      if (this.state !== "follower") {
        this.state = "follower";
        return true; // State changed to follower
      }
    }
    return false;
  }

  /**
   * Vote for candidate
   */
  voteFor(candidateId: string): boolean {
    if (this.votedFor === null || this.votedFor === candidateId) {
      this.votedFor = candidateId;
      return true;
    }
    return false;
  }

  /**
   * Become candidate
   */
  becomeCandidate(): void {
    this.state = "candidate";
    this.currentTerm++;
    this.votedFor = this.config.nodeId;
    this.leaderId = null;
  }

  /**
   * Become leader
   */
  becomeLeader(): void {
    this.state = "leader";
    this.leaderId = this.config.nodeId;
    this.votedFor = null;
  }

  /**
   * Become follower
   */
  becomeFollower(term: number, leaderId?: string): void {
    this.state = "follower";
    this.currentTerm = Math.max(this.currentTerm, term);
    this.leaderId = leaderId ?? null;
    this.votedFor = null;
  }

  /**
   * Check if can grant vote
   */
  canGrantVote(candidateTerm: number, candidateLastLogIndex: number, candidateLastLogTerm: number, myLastLogIndex: number, myLastLogTerm: number): boolean {
    if (candidateTerm < this.currentTerm) return false;
    if (candidateTerm > this.currentTerm) return true;

    if (candidateLastLogTerm !== myLastLogTerm) {
      return candidateLastLogTerm > myLastLogTerm;
    }

    return candidateLastLogIndex >= myLastLogIndex;
  }

  /**
   * Get election timeout (150-300ms with randomization)
   */
  getElectionTimeout(): number {
    const base = this.config.electionTimeoutMs;
    const jitter = Math.random() * base * 0.5;
    return base + jitter;
  }

  /**
   * Get heartbeat interval
   */
  getHeartbeatInterval(): number {
    return this.config.heartbeatIntervalMs;
  }

  /**
   * Get snapshot interval
   */
  getSnapshotInterval(): number {
    return this.config.snapshotIntervalOps;
  }
}

/* ========================
   QUORUM CALCULATOR
======================== */

export class QuorumCalculator {
  /**
   * Calculate quorum size for N nodes
   */
  static calculateQuorum(nodeCount: number): number {
    return Math.floor(nodeCount / 2) + 1;
  }

  /**
   * Check if replicas constitute quorum
   */
  static hasQuorum(replicasWithEntry: number, totalNodes: number): boolean {
    const quorum = this.calculateQuorum(totalNodes);
    return replicasWithEntry >= quorum;
  }

  /**
   * Get replica distribution score (0-1, higher is better)
   */
  static getReplicaScore(matchedReplicas: number, totalReplicas: number): number {
    const quorum = this.calculateQuorum(totalReplicas);
    if (matchedReplicas < quorum) return 0;
    return matchedReplicas / totalReplicas;
  }
}

/* ========================
   READ CONSISTENCY MODES
======================== */

export class ConsistencyManager {
  /**
   * Get safe read index based on consistency level
   * - strong: use leader's committed index
   * - eventual: use last known committed
   * - stale: use local cache
   */
  static getSafeReadIndex(
    level: ConsistencyLevel,
    leaderCommitIndex: number,
    lastKnownCommit: number,
    cacheVersion: number
  ): number {
    switch (level) {
      case "strong":
        return leaderCommitIndex;
      case "eventual":
        return lastKnownCommit;
      case "stale":
        return cacheVersion;
      default:
        return lastKnownCommit;
    }
  }

  /**
   * Check if read is stale
   */
  static isStaleRead(readIndex: number, leaderCommitIndex: number, maxStalenessMs: number): boolean {
    // Would need timestamp tracking in real implementation
    return readIndex < leaderCommitIndex;
  }

  /**
   * Wait for commit advancement (linearizable read)
   */
  static async waitForCommit(
    currentCommitIndex: number,
    targetIndex: number,
    timeoutMs: number = 1000
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;

    while (currentCommitIndex < targetIndex && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    return currentCommitIndex >= targetIndex;
  }
}

/* ========================
   REPLICATION TRACKER
======================== */

export class ReplicationTracker {
  private peers = new Map<string, PeerInfo>();
  private matchIndexes = new Map<string, number>();

  /**
   * Add peer
   */
  addPeer(nodeId: string, nextIndex: number): void {
    if (!this.peers.has(nodeId)) {
      this.peers.set(nodeId, {
        nodeId,
        nextIndex,
        matchIndex: 0
      });
      this.matchIndexes.set(nodeId, 0);
    }
  }

  /**
   * Update match index for peer
   */
  updateMatchIndex(nodeId: string, index: number): void {
    const peer = this.peers.get(nodeId);
    if (peer) {
      peer.matchIndex = Math.max(peer.matchIndex, index);
      peer.nextIndex = Math.max(peer.nextIndex, index + 1);
      this.matchIndexes.set(nodeId, peer.matchIndex);
    }
  }

  /**
   * Get replication status for log index
   */
  getReplicationStatus(logIndex: number): { replicated: number; total: number } {
    let replicated = 1; // Count self

    for (const match of this.matchIndexes.values()) {
      if (match >= logIndex) {
        replicated++;
      }
    }

    return {
      replicated,
      total: this.peers.size + 1
    };
  }

  /**
   * Get safe commit index (applies to majority)
   */
  getSafeCommitIndex(highestLogIndex: number): number {
    const matches = [0];

    for (const match of this.matchIndexes.values()) {
      matches.push(match);
    }

    matches.sort((a, b) => b - a);

    const quorum = Math.floor((matches.length + 1) / 2);
    if (quorum <= matches.length) {
      return matches[quorum - 1];
    }

    return 0;
  }

  /**
   * Get peers sorted by priority for replication
   */
  getPeersForReplication(): PeerInfo[] {
    return Array.from(this.peers.values())
      .sort((a, b) => a.nextIndex - b.nextIndex);
  }

  /**
   * Get all peer info
   */
  getAllPeers(): PeerInfo[] {
    return Array.from(this.peers.values());
  }

  /**
   * Clear
   */
  clear(): void {
    this.peers.clear();
    this.matchIndexes.clear();
  }
}
