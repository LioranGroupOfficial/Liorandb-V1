import { dbQueue } from "./queue.js";

/* -------------------------------- COLLECTION PROXY -------------------------------- */

class CollectionProxy {
  constructor(
    private dbName: string,
    private collectionName: string
  ) {}

  private call(method: string, params: any[]): Promise<any> {
    return dbQueue.exec("op", {
      db: this.dbName,
      col: this.collectionName,
      method,
      params
    });
  }

  private callIndex(method: string, params: any[]): Promise<any> {
    return dbQueue.exec("index", {
      db: this.dbName,
      col: this.collectionName,
      method,
      params
    });
  }

  private callCompact(): Promise<any> {
    return dbQueue.exec("compact:collection", {
      db: this.dbName,
      col: this.collectionName
    });
  }

  /* ------------------------------ CRUD ------------------------------ */

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

  /* ------------------------------ INDEX ----------------------------- */

  createIndex = (def: any) => this.callIndex("createIndex", [def]);
  dropIndex = (field: string) => this.callIndex("dropIndex", [field]);
  listIndexes = () => this.callIndex("listIndexes", []);
  rebuildIndexes = () => this.callIndex("rebuildIndexes", []);

  /* --------------------------- COMPACTION --------------------------- */

  compact = () => this.callCompact();
}

/* -------------------------------- DATABASE PROXY -------------------------------- */

class DBProxy {
  constructor(private dbName: string) {}

  collection(name: string) {
    return new CollectionProxy(this.dbName, name);
  }

  compact() {
    return dbQueue.exec("compact:db", { db: this.dbName });
  }
}

/* -------------------------------- MANAGER PROXY -------------------------------- */

class LioranManagerIPC {
  async db(name: string) {
    await dbQueue.exec("db", { db: name });
    return new DBProxy(name);
  }

  compactAll() {
    return dbQueue.exec("compact:all", {});
  }
}

export const manager = new LioranManagerIPC();
export type { CollectionProxy, DBProxy };