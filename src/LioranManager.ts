import path from "path";
import fs from "fs";
import { LioranDB } from "./core/database.js";
import { setEncryptionKey } from "./utils/encryption.js";
import { getDefaultRootPath } from "./utils/rootpath.js";
import { dbQueue } from "./ipc/queue.js";

export interface LioranManagerOptions {
  rootPath?: string;
  encryptionKey?: string | Buffer;
  ipc?: boolean;
}

export class LioranManager {
  rootPath: string;
  openDBs: Map<string, LioranDB>;
  private closed = false;
  private ipc: boolean;

  constructor(options: LioranManagerOptions = {}) {
    const { rootPath, encryptionKey, ipc } = options;

    this.rootPath = rootPath || getDefaultRootPath();
    this.ipc = ipc ?? process.env.LIORANDB_IPC === "1";

    if (!fs.existsSync(this.rootPath)) {
      fs.mkdirSync(this.rootPath, { recursive: true });
    }

    if (encryptionKey) {
      setEncryptionKey(encryptionKey);
    }

    this.openDBs = new Map();

    if (!this.ipc) {
      this._registerShutdownHooks();
    }
  }

  /* -------------------------------- CORE -------------------------------- */

  async db(name: string): Promise<LioranDB> {
    if (this.ipc) {
      await dbQueue.exec("db", { db: name });
      return new IPCDatabase(name) as any;
    }

    return this.openDatabase(name);
  }

  async createDatabase(name: string): Promise<LioranDB> {
    this._assertOpen();

    const dbPath = path.join(this.rootPath, name);

    if (fs.existsSync(dbPath)) {
      throw new Error(`Database "${name}" already exists`);
    }

    await fs.promises.mkdir(dbPath, { recursive: true });

    return this.db(name);
  }

  async openDatabase(name: string): Promise<LioranDB> {
    this._assertOpen();

    if (this.openDBs.has(name)) {
      return this.openDBs.get(name)!;
    }

    const dbPath = path.join(this.rootPath, name);

    if (!fs.existsSync(dbPath)) {
      await fs.promises.mkdir(dbPath, { recursive: true });
    }

    const db = new LioranDB(dbPath, name, this);
    this.openDBs.set(name, db);
    return db;
  }

  /* -------------------------------- LIFECYCLE -------------------------------- */

  async closeDatabase(name: string): Promise<void> {
    if (this.ipc) return;

    if (!this.openDBs.has(name)) return;

    const db = this.openDBs.get(name)!;
    await db.close();
    this.openDBs.delete(name);
  }

  async closeAll(): Promise<void> {
    if (this.ipc || this.closed) return;

    this.closed = true;

    for (const db of this.openDBs.values()) {
      try {
        await db.close();
      } catch {}
    }

    this.openDBs.clear();
  }

  private _registerShutdownHooks() {
    const shutdown = async () => {
      await this.closeAll();
      process.exit(0);
    };

    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    process.on("exit", () => {
      this.closeAll().catch(() => {});
    });
  }

  private _assertOpen() {
    if (this.closed) {
      throw new Error("LioranManager is closed");
    }
  }

  /* -------------------------------- MANAGEMENT -------------------------------- */

  async renameDatabase(oldName: string, newName: string): Promise<boolean> {
    if (this.ipc) {
      return (await dbQueue.exec("renameDatabase", { oldName, newName })) as boolean;
    }

    const oldPath = path.join(this.rootPath, oldName);
    const newPath = path.join(this.rootPath, newName);

    if (!fs.existsSync(oldPath)) {
      throw new Error(`Database "${oldName}" not found`);
    }

    if (fs.existsSync(newPath)) {
      throw new Error(`Database "${newName}" already exists`);
    }

    await this.closeDatabase(oldName);
    await fs.promises.rename(oldPath, newPath);
    return true;
  }

  async deleteDatabase(name: string): Promise<boolean> {
    return this.dropDatabase(name);
  }

  async dropDatabase(name: string): Promise<boolean> {
    if (this.ipc) {
      return (await dbQueue.exec("dropDatabase", { name })) as boolean;
    }

    const dbPath = path.join(this.rootPath, name);

    if (!fs.existsSync(dbPath)) return false;

    await this.closeDatabase(name);
    await fs.promises.rm(dbPath, { recursive: true, force: true });
    return true;
  }

  async listDatabases(): Promise<string[]> {
    if (this.ipc) {
      return (await dbQueue.exec("listDatabases", {})) as string[];
    }

    const items = await fs.promises.readdir(this.rootPath, {
      withFileTypes: true
    });

    return items.filter(i => i.isDirectory()).map(i => i.name);
  }

  /* -------------------------------- DEBUG -------------------------------- */

  getStats() {
    return {
      rootPath: this.rootPath,
      openDatabases: this.ipc ? ["<ipc>"] : [...this.openDBs.keys()],
      ipc: this.ipc
    };
  }
}

/* -------------------------------- IPC PROXY DB -------------------------------- */

class IPCDatabase {
  constructor(private name: string) {}

  collection(name: string) {
    return new IPCCollection(this.name, name);
  }
}

class IPCCollection {
  constructor(
    private db: string,
    private col: string
  ) {}

  private call(method: string, params: any[]) {
    return dbQueue.exec("op", {
      db: this.db,
      col: this.col,
      method,
      params
    });
  }

  insertOne = (doc: any) => this.call("insertOne", [doc]);
  insertMany = (docs: any[]) => this.call("insertMany", [docs]);
  find = (query?: any) => this.call("find", [query]);
  findOne = (query?: any) => this.call("findOne", [query]);
  updateOne = (filter: any, update: any, options?: any) =>
    this.call("updateOne", [filter, update, options]);
  updateMany = (filter: any, update: any) =>
    this.call("updateMany", [filter, update]);
  deleteOne = (filter: any) => this.call("deleteOne", [filter]);
  deleteMany = (filter: any) => this.call("deleteMany", [filter]);
  countDocuments = (filter?: any) =>
    this.call("countDocuments", [filter]);
}
