declare module "@liorandb/core" {

  export interface LioranManagerOptions {
    rootPath?: string;
    encryptionKey?: string | Buffer;
  }

  export class LioranManager {
    rootPath: string;

    constructor(options?: LioranManagerOptions);

    db(name: string): Promise<any>;

    createDatabase(name: string): Promise<any>;
    openDatabase(name: string): Promise<any>;
    closeDatabase(name: string): Promise<void>;

    renameDatabase(oldName: string, newName: string): Promise<boolean>;

    deleteDatabase(name: string): Promise<boolean>;
    dropDatabase(name: string): Promise<boolean>;

    listDatabases(): Promise<string[]>;
  }
}
