// ================================================
// @liorandb/core - Type Definitions
// ================================================

declare module "@liorandb/core" {
  // --------------------------
  // Generic Query Operators
  // --------------------------

  export interface QueryOperators<T> {
    $gt?: T;
    $gte?: T;
    $lt?: T;
    $lte?: T;
    $ne?: T;
    $in?: T[];
  }

  export type FilterQuery<T> = {
    [K in keyof T]?: T[K] | QueryOperators<T[K]>;
  };

  // --------------------------
  // Update Operators
  // --------------------------

  export interface UpdateSet<T> {
    $set?: Partial<T>;
  }

  export interface UpdateInc<T> {
    $inc?: {
      [K in keyof T]?: number;
    };
  }

  export type UpdateQuery<T> = Partial<T> | (UpdateSet<T> & UpdateInc<T>);

  // --------------------------
  // Collection Class
  // --------------------------

  export class Collection<T extends { _id?: string }> {
    constructor(dir: string);

    close(): Promise<void>;

    insertOne(doc: T): Promise<T>;
    insertMany(docs: T[]): Promise<T[]>;

    find(query?: FilterQuery<T>): Promise<T[]>;
    findOne(query?: FilterQuery<T>): Promise<T | null>;

    updateOne(
      filter: FilterQuery<T>,
      update: UpdateQuery<T>,
      options?: { upsert?: boolean }
    ): Promise<T | null>;

    updateMany(
      filter: FilterQuery<T>,
      update: UpdateQuery<T>
    ): Promise<T[]>;

    deleteOne(filter: FilterQuery<T>): Promise<boolean>;
    deleteMany(filter: FilterQuery<T>): Promise<number>;

    countDocuments(filter?: FilterQuery<T>): Promise<number>;
  }

  // --------------------------
  // LioranDB: Database Instance
  // --------------------------

  export class LioranDB {
    basePath: string;
    dbName: string;

    constructor(basePath: string, dbName: string, manager: LioranManager);

    collection<T extends { _id?: string }>(name: string): Collection<T>;

    createCollection(name: string): Promise<boolean>;
    deleteCollection(name: string): Promise<boolean>;
    dropCollection(name: string): Promise<boolean>;
    renameCollection(oldName: string, newName: string): Promise<boolean>;

    listCollections(): Promise<string[]>;
  }

  // --------------------------
  // LioranManager
  // --------------------------

  export class LioranManager {
    rootPath: string;

    constructor();

    // MongoDB-style
    db(name: string): Promise<LioranDB>;

    createDatabase(name: string): Promise<LioranDB>;
    openDatabase(name: string): Promise<LioranDB>;
    closeDatabase(name: string): Promise<void>;

    renameDatabase(oldName: string, newName: string): Promise<boolean>;

    deleteDatabase(name: string): Promise<boolean>;
    dropDatabase(name: string): Promise<boolean>;

    listDatabases(): Promise<string[]>;
  }

  // --------------------------
  // Utils
  // --------------------------

  export function getBaseDBFolder(): string;

  // Package exports
  export { LioranManager, LioranDB, getBaseDBFolder };
}
