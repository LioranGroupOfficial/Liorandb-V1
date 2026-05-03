import { dbQueue } from "./queue.js";

/* -------------------------------- COLLECTION PROXY -------------------------------- */

class CollectionProxy {
  constructor(
    private dbName: string,
    private collectionName: string
  ) {}

  /* ------------------------------ INTERNAL CALLERS ------------------------------ */

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

  /* ------------------------------ CRUD ------------------------------ */

  insertOne = (doc: any) =>
    this.call("insertOne", [doc]);

  insertMany = (docs: any[]) =>
    this.call("insertMany", [docs]);

  find = (query?: any, options?: any) =>
    this.call("find", [query, options]);

  findOne = (query?: any, options?: any) =>
    this.call("findOne", [query, options]);

  aggregate = (pipeline: any[]) =>
    this.call("aggregate", [pipeline]);

  explain = (query?: any, options?: any) =>
    this.call("explain", [query, options]);

  updateOne = (filter: any, update: any, options?: any) =>
    this.call("updateOne", [filter, update, options]);

  updateMany = (filter: any, update: any) =>
    this.call("updateMany", [filter, update]);

  deleteOne = (filter: any) =>
    this.call("deleteOne", [filter]);

  deleteMany = (filter: any) =>
    this.call("deleteMany", [filter]);

  countDocuments = (filter?: any) =>
    this.call("countDocuments", [filter]);

  count = () =>
    this.call("count", []);

  /* ------------------------------ INDEX ----------------------------- */

  createIndex = (def: any) =>
    this.callIndex("createIndex", [def]);

  dropIndex = (field: string) =>
    this.callIndex("dropIndex", [field]);

  listIndexes = () =>
    this.callIndex("listIndexes", []);

  rebuildIndexes = () =>
    this.callIndex("rebuildIndexes", []);

  /* --------------------------- COMPACTION --------------------------- */

  compact = () =>
    dbQueue.exec("compact:collection", {
      db: this.dbName,
      col: this.collectionName
    });
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

  maintenance(options?: { aggressive?: boolean }) {
    return dbQueue.exec("db:meta", {
      db: this.dbName,
      method: "maintenance",
      params: [options ?? {}]
    });
  }

  explain(collection: string, query?: any, options?: any) {
    return dbQueue.exec("db:meta", {
      db: this.dbName,
      method: "explain",
      params: [collection, query, options]
    });
  }

  snapshot(path: string) {
    return dbQueue.exec("snapshot", { path });
  }

  restore(path: string) {
    return dbQueue.exec("restore", { path });
  }

  rotateEncryptionKey(newKey: string) {
    return dbQueue.exec("db:meta", {
      db: this.dbName,
      method: "rotateEncryptionKey",
      params: [newKey]
    });
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

  snapshot(path: string) {
    return dbQueue.exec("snapshot", { path });
  }

  restore(path: string) {
    return dbQueue.exec("restore", { path });
  }

  shutdown() {
    return dbQueue.exec("shutdown", {});
  }
}

/* -------------------------------- EXPORTS -------------------------------- */

export const manager = new LioranManagerIPC();
export type { CollectionProxy, DBProxy };
