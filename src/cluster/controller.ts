import type { LioranManager } from "../LioranManager.js";
import { RaftNode, type RaftPeer } from "./raft.js";
import { WALStreamServer } from "../replication/walStream.js";
import { ReplicationCoordinator } from "../replication/coordinator.js";

export type ClusterNodeConfig = {
  enabled: boolean;
  nodeId: string;
  host: string;
  raftPort: number;
  walStreamPort: number;
  peers: Array<{ id: string; host: string; raftPort: number; walStreamPort: number }>;
  heartbeatMs?: number;
  electionTimeoutMs?: { min: number; max: number };
  waitForMajority?: boolean;
  waitTimeoutMs?: number;
};

export class ClusterController {
  private raft: RaftNode;
  private walServer: WALStreamServer;
  private coordinator: ReplicationCoordinator;
  private closed = false;

  private currentLeader: { id: string; host: string; walStreamPort: number } | null = null;

  constructor(
    private manager: LioranManager,
    private cfg: ClusterNodeConfig
  ) {
    const peers: RaftPeer[] = cfg.peers.map(p => ({ id: p.id, host: p.host, port: p.raftPort }));
    this.raft = new RaftNode({
      id: cfg.nodeId,
      host: cfg.host,
      port: cfg.raftPort,
      peers: [{ id: cfg.nodeId, host: cfg.host, port: cfg.raftPort }, ...peers],
      heartbeatMs: cfg.heartbeatMs,
      electionTimeoutMs: cfg.electionTimeoutMs
    });

    this.walServer = new WALStreamServer(manager, {
      host: cfg.host,
      port: cfg.walStreamPort,
      nodeId: cfg.nodeId
    });

    this.coordinator = new ReplicationCoordinator({
      groupSize: cfg.peers.length + 1,
      waitForMajority: !!cfg.waitForMajority,
      waitTimeoutMs: Math.max(50, Math.trunc(cfg.waitTimeoutMs ?? 1500))
    });
  }

  async start(): Promise<void> {
    await this.walServer.start();
    this.walServer.onAck(({ db, socket, lsn }) => {
      this.coordinator.recordAck(db, socket, lsn);
    });

    (this.manager as any)._setReplicationCoordinator?.(this.coordinator);

    await this.raft.start();
    this.raft.onRole(info => {
      void this.onRole(info.role, info.leaderId);
    });
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.raft.close();
    await this.walServer.close();
  }

  private resolveLeader(leaderId: string | null): { id: string; host: string; walStreamPort: number } | null {
    if (!leaderId) return null;
    if (leaderId === this.cfg.nodeId) {
      return { id: this.cfg.nodeId, host: this.cfg.host, walStreamPort: this.cfg.walStreamPort };
    }
    const p = this.cfg.peers.find(x => x.id === leaderId);
    if (!p) return null;
    return { id: p.id, host: p.host, walStreamPort: p.walStreamPort };
  }

  private async onRole(role: "leader" | "follower" | "candidate", leaderId: string | null) {
    if (this.closed) return;

    const leader = this.resolveLeader(role === "leader" ? this.cfg.nodeId : leaderId);
    const leaderKey = leader ? `${leader.id}@${leader.host}:${leader.walStreamPort}` : "none";
    const prevKey = this.currentLeader ? `${this.currentLeader.id}@${this.currentLeader.host}:${this.currentLeader.walStreamPort}` : "none";

    if (leaderKey !== prevKey) {
      this.currentLeader = leader;
      (this.manager as any)._setClusterLeader?.(leader ? { id: leader.id, host: leader.host, walStreamPort: leader.walStreamPort } : null);
    }

    if (role === "leader") {
      await (this.manager as any)._becomeClusterLeader?.();
      return;
    }

    if (role === "follower" && leader) {
      await (this.manager as any)._becomeClusterFollower?.(leader.host, leader.walStreamPort);
      return;
    }
  }
}

