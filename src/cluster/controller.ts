import type { LioranManager } from "../LioranManager.js";
import { RaftNode, type RaftPeer } from "./raft.js";
import { WALStreamServer } from "../replication/walStream.js";
import { ReplicationCoordinator } from "../replication/coordinator.js";
import { ClusterRPCServer } from "./clientRpc.js";

export type ClusterNodeConfig = {
  enabled: boolean;
  nodeId: string;
  host: string;
  raftPort: number;
  walStreamPort: number;
  clientPort?: number;
  client?: {
    port?: number;
    maxMessageBytes?: number;
    auth?: { token?: string; required?: boolean };
    tls?: {
      keyPath: string;
      certPath: string;
      caPath?: string;
      requestCert?: boolean;
    };
  };
  peers: Array<{ id: string; host: string; raftPort: number; walStreamPort: number; clientPort?: number }>;
  heartbeatMs?: number;
  electionTimeoutMs?: { min: number; max: number };
  waitForMajority?: boolean;
  waitTimeoutMs?: number;
};

export class ClusterController {
  private raft: RaftNode;
  private walServer: WALStreamServer;
  private clientServer: ClusterRPCServer;
  private coordinator: ReplicationCoordinator;
  private closed = false;
  private clientPort: number;

  private currentLeader: { id: string; host: string; walStreamPort: number; clientPort: number } | null = null;

  constructor(
    private manager: LioranManager,
    private cfg: ClusterNodeConfig
  ) {
    const clientPort = Math.max(1, Math.trunc(cfg.client?.port ?? cfg.clientPort ?? (cfg.walStreamPort + 1)));
    this.clientPort = clientPort;

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

    this.clientServer = new ClusterRPCServer(manager, {
      host: cfg.host,
      port: clientPort,
      maxMessageBytes: cfg.client?.maxMessageBytes,
      auth: cfg.client?.auth,
      tls: cfg.client?.tls as any
    });

    this.coordinator = new ReplicationCoordinator({
      groupSize: cfg.peers.length + 1,
      waitForMajority: !!cfg.waitForMajority,
      waitTimeoutMs: Math.max(50, Math.trunc(cfg.waitTimeoutMs ?? 1500))
    });
  }

  async start(): Promise<void> {
    await this.walServer.start();
    await this.clientServer.start();
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
    await this.clientServer.close();
  }

  private resolveLeader(leaderId: string | null): { id: string; host: string; walStreamPort: number; clientPort: number } | null {
    if (!leaderId) return null;
    if (leaderId === this.cfg.nodeId) {
      return { id: this.cfg.nodeId, host: this.cfg.host, walStreamPort: this.cfg.walStreamPort, clientPort: this.clientPort };
    }
    const p = this.cfg.peers.find(x => x.id === leaderId);
    if (!p) return null;
    const port = Math.max(1, Math.trunc(p.clientPort ?? (p.walStreamPort + 1)));
    return { id: p.id, host: p.host, walStreamPort: p.walStreamPort, clientPort: port };
  }

  private async onRole(role: "leader" | "follower" | "candidate", leaderId: string | null) {
    if (this.closed) return;

    const leader = this.resolveLeader(role === "leader" ? this.cfg.nodeId : leaderId);
    const leaderKey = leader ? `${leader.id}@${leader.host}:${leader.walStreamPort}` : "none";
    const prevKey = this.currentLeader ? `${this.currentLeader.id}@${this.currentLeader.host}:${this.currentLeader.walStreamPort}` : "none";

    if (leaderKey !== prevKey) {
      this.currentLeader = leader;
      (this.manager as any)._setClusterLeader?.(leader ? { id: leader.id, host: leader.host, walStreamPort: leader.walStreamPort, clientPort: leader.clientPort } : null);
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
