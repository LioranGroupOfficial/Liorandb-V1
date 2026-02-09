import { dbQueue } from "./queue.js";

type AnyFn = (...args: any[]) => Promise<any>;

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

/* -------------------------------- DATABASE PROXY -------------------------------- */

class DBProxy {
  constructor(private dbName: string) {}

  collection(name: string) {
    return new CollectionProxy(this.dbName, name);
  }
}

/* -------------------------------- MANAGER PROXY -------------------------------- */

class LioranManagerIPC {
  async db(name: string) {
    await dbQueue.exec("db", { db: name });
    return new DBProxy(name);
  }
}

export const manager = new LioranManagerIPC();
export type { CollectionProxy, DBProxy };
