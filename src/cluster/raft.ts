import net from "net";
import { EventEmitter } from "events";
import { LiorandbError, asLiorandbError } from "../utils/errors.js";

export type RaftRole = "leader" | "follower" | "candidate";

export type RaftPeer = {
  id: string;
  host: string;
  port: number;
};

type RpcRequest =
  | { id: string; type: "requestVote"; term: number; candidateId: string }
  | { id: string; type: "appendEntries"; term: number; leaderId: string };

type RpcResponse =
  | { id: string; ok: true; result: any }
  | { id: string; ok: false; error: any };

type RequestVoteReply = { term: number; voteGranted: boolean };
type AppendEntriesReply = { term: number; success: boolean };

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function randBetween(min: number, max: number) {
  return Math.floor(min + Math.random() * Math.max(1, max - min + 1));
}

function uuidLike() {
  // Avoid importing crypto in browser-like builds; this is sufficient for message correlation.
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

async function rpcCall<T>(
  peer: RaftPeer,
  msg:
    | { type: "requestVote"; term: number; candidateId: string }
    | { type: "appendEntries"; term: number; leaderId: string },
  timeoutMs: number
): Promise<T> {
  const id = uuidLike();
  const socket = net.createConnection(peer.port, peer.host);
  socket.setNoDelay(true);
  socket.setEncoding("utf8");

  let buf = "";

  const done = new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try { socket.destroy(); } catch {}
      reject(new LiorandbError("IO_ERROR", "Raft RPC timeout", { details: { peer, type: (msg as any).type } }));
    }, Math.max(1, timeoutMs));

    socket.on("data", (chunk: string) => {
      buf += chunk;
      while (true) {
        const idx = buf.indexOf("\n");
        if (idx < 0) break;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as RpcResponse;
          if (!parsed || parsed.id !== id) continue;
          clearTimeout(timer);
          try { socket.end(); } catch {}
          if (!parsed.ok) {
            reject(new LiorandbError("IO_ERROR", "Raft RPC failed", { details: parsed.error }));
            return;
          }
          resolve(parsed.result as T);
          return;
        } catch {
          // ignore unrelated garbage
        }
      }
    });

    socket.once("error", err => {
      clearTimeout(timer);
      reject(err);
    });
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("error", reject);
  });

  socket.write(JSON.stringify({ id, ...msg }) + "\n");
  return done;
}

export type RaftNodeOptions = {
  id: string;
  host: string;
  port: number;
  peers: RaftPeer[];
  heartbeatMs?: number;
  electionTimeoutMs?: { min: number; max: number };
  rpcTimeoutMs?: number;
};

export class RaftNode {
  private events = new EventEmitter();
  private server: net.Server | null = null;
  private closed = false;

  private role: RaftRole = "follower";
  private leaderId: string | null = null;

  private currentTerm = 0;
  private votedFor: string | null = null;

  private lastHeartbeatAt = 0;
  private electionDeadline = 0;

  private heartbeatTimer: NodeJS.Timeout | null = null;
  private electionTimer: NodeJS.Timeout | null = null;

  constructor(private opts: RaftNodeOptions) {
    if (!opts.id) throw new LiorandbError("VALIDATION_FAILED", "Raft node id is required");
    if (!opts.host) throw new LiorandbError("VALIDATION_FAILED", "Raft host is required");
    if (!Number.isFinite(opts.port)) throw new LiorandbError("VALIDATION_FAILED", "Raft port is required");
  }

  onRole(listener: (info: { role: RaftRole; term: number; leaderId: string | null }) => void): () => void {
    this.events.on("role", listener);
    return () => this.events.off("role", listener);
  }

  getRole() {
    return this.role;
  }

  getLeaderId() {
    return this.leaderId;
  }

  async start(): Promise<void> {
    if (this.server) return;

    this.server = net.createServer(socket => {
      socket.setNoDelay(true);
      socket.setEncoding("utf8");

      let buf = "";
      socket.on("data", (chunk: string) => {
        buf += chunk;
        while (true) {
          const idx = buf.indexOf("\n");
          if (idx < 0) break;
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;
          void this.handleLine(line, socket);
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(this.opts.port, this.opts.host, () => resolve());
    });

    this.resetElectionDeadline();
    this.armTimers();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    if (this.heartbeatTimer) {
      try { clearInterval(this.heartbeatTimer); } catch {}
      this.heartbeatTimer = null;
    }
    if (this.electionTimer) {
      try { clearInterval(this.electionTimer); } catch {}
      this.electionTimer = null;
    }

    if (this.server) {
      const srv = this.server;
      this.server = null;
      await new Promise<void>(resolve => srv.close(() => resolve()));
    }
  }

  private armTimers() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.electionTimer) clearInterval(this.electionTimer);

    const heartbeatMs = Math.max(50, Math.trunc(this.opts.heartbeatMs ?? 75));

    this.heartbeatTimer = setInterval(() => {
      if (this.closed) return;
      if (this.role !== "leader") return;
      void this.sendHeartbeats();
    }, heartbeatMs);

    this.electionTimer = setInterval(() => {
      if (this.closed) return;
      void this.tickElection();
    }, 25);
  }

  private resetElectionDeadline() {
    const range = this.opts.electionTimeoutMs ?? { min: 250, max: 500 };
    const ms = randBetween(Math.max(150, range.min), Math.max(range.min + 1, range.max));
    this.electionDeadline = Date.now() + ms;
  }

  private setRole(next: RaftRole, leaderId: string | null) {
    if (this.role === next && this.leaderId === leaderId) return;
    this.role = next;
    this.leaderId = leaderId;
    this.events.emit("role", { role: this.role, term: this.currentTerm, leaderId: this.leaderId });
  }

  private async tickElection() {
    if (this.role === "leader") return;
    const now = Date.now();

    // If we have a leader heartbeat, follow.
    if (this.lastHeartbeatAt && now - this.lastHeartbeatAt < 2_000) {
      // keep waiting for election timeout
    }

    if (now < this.electionDeadline) return;
    await this.startElection();
  }

  private async startElection() {
    this.currentTerm++;
    this.votedFor = this.opts.id;
    this.setRole("candidate", null);
    this.resetElectionDeadline();

    const peers = this.opts.peers.filter(p => p.id !== this.opts.id);
    const majority = Math.floor((peers.length + 1) / 2) + 1;
    let votes = 1;

    const rpcTimeoutMs = Math.max(50, Math.trunc(this.opts.rpcTimeoutMs ?? 150));

    await Promise.allSettled(
      peers.map(async peer => {
        try {
          const reply = await rpcCall<RequestVoteReply>(
            peer,
            { type: "requestVote", term: this.currentTerm, candidateId: this.opts.id },
            rpcTimeoutMs
          );
          if (reply.term > this.currentTerm) {
            this.currentTerm = reply.term;
            this.votedFor = null;
            this.setRole("follower", null);
            this.resetElectionDeadline();
            return;
          }
          if (this.role !== "candidate") return;
          if (reply.voteGranted) votes++;
        } catch {
          // ignore peer failures
        }
      })
    );

    if (this.role !== "candidate") return;

    if (votes >= majority) {
      this.setRole("leader", this.opts.id);
      void this.sendHeartbeats();
      return;
    }

    // Failed election; back to follower and retry later.
    this.setRole("follower", null);
    this.resetElectionDeadline();
  }

  private async sendHeartbeats() {
    const peers = this.opts.peers.filter(p => p.id !== this.opts.id);
    const rpcTimeoutMs = Math.max(50, Math.trunc(this.opts.rpcTimeoutMs ?? 150));

    await Promise.allSettled(
      peers.map(async peer => {
        try {
          const reply = await rpcCall<AppendEntriesReply>(
            peer,
            { type: "appendEntries", term: this.currentTerm, leaderId: this.opts.id },
            rpcTimeoutMs
          );
          if (reply.term > this.currentTerm) {
            this.currentTerm = reply.term;
            this.votedFor = null;
            this.setRole("follower", reply.term ? null : null);
            this.resetElectionDeadline();
          }
        } catch {
          // ignore
        }
      })
    );
  }

  private async handleLine(line: string, socket: net.Socket) {
    let msg: RpcRequest;
    try {
      msg = JSON.parse(line);
      if (!msg?.id || !msg?.type) {
        throw new LiorandbError("VALIDATION_FAILED", "Invalid Raft RPC");
      }
    } catch (err) {
      const res: RpcResponse = { id: "?", ok: false, error: asLiorandbError(err, { code: "INTERNAL", message: "Raft parse failed" }).toJSON() };
      socket.write(JSON.stringify(res) + "\n");
      return;
    }

    try {
      if (msg.type === "requestVote") {
        const result = this.onRequestVote(msg.term, msg.candidateId);
        const res: RpcResponse = { id: msg.id, ok: true, result };
        socket.write(JSON.stringify(res) + "\n");
        return;
      }

      if (msg.type === "appendEntries") {
        const result = this.onAppendEntries(msg.term, msg.leaderId);
        const res: RpcResponse = { id: msg.id, ok: true, result };
        socket.write(JSON.stringify(res) + "\n");
        return;
      }

      throw new LiorandbError("UNKNOWN_ACTION", `Unknown Raft RPC: ${(msg as any).type}`);
    } catch (err) {
      const res: RpcResponse = { id: msg.id, ok: false, error: asLiorandbError(err, { code: "INTERNAL", message: "Raft exec failed" }).toJSON() };
      socket.write(JSON.stringify(res) + "\n");
    }
  }

  private onRequestVote(term: number, candidateId: string): RequestVoteReply {
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = null;
      this.setRole("follower", null);
    }

    if (term < this.currentTerm) {
      return { term: this.currentTerm, voteGranted: false };
    }

    if (!this.votedFor || this.votedFor === candidateId) {
      this.votedFor = candidateId;
      this.resetElectionDeadline();
      return { term: this.currentTerm, voteGranted: true };
    }

    return { term: this.currentTerm, voteGranted: false };
  }

  private onAppendEntries(term: number, leaderId: string): AppendEntriesReply {
    if (term > this.currentTerm) {
      this.currentTerm = term;
      this.votedFor = null;
    }

    if (term < this.currentTerm) {
      return { term: this.currentTerm, success: false };
    }

    this.lastHeartbeatAt = Date.now();
    this.resetElectionDeadline();
    this.setRole("follower", leaderId);
    return { term: this.currentTerm, success: true };
  }
}
