import { Collection } from "./collection";
import {
  DocumentData,
  LioranCollectionListResponse,
  LioranCollectionMutationResponse,
  LioranCompactCollectionResponse,
  LioranCompactDatabaseResponse,
  LioranCreateIndexResponse,
  LioranDropIndexResponse,
  LioranDatabaseConnectionStringResponse,
  LioranDatabaseCredentialsMutationResponse,
  LioranDatabaseCredentialsResponse,
  LioranDatabaseStats,
  LioranDeleteResponse,
  LioranExplainResponse,
  LioranFindOptions,
  LioranListIndexesResponse,
  LioranRebuildAllIndexesResponse,
  LioranCollectionOptionsResponse,
  LioranCollectionDateOption,
  LioranRenameResponse,
  LioranTransactionResponse,
  LioranApplyDbMigrationsResponse,
  LioranDbMigrationStep,
  LioranDbSchemaVersionResponse,
  LioranRotateEncryptionKeyResponse,
  Filter,
  LioranUpdateOneOptions,
  UpdateQuery,
} from "./types";
import { HttpClient } from "./http";
import { normalizeFindOptions } from "./utils/normalizeFindOptions";

export interface DatabaseCredentialsInput {
  username: string;
  password: string;
}

export type TransactionOpName =
  | "insertOne"
  | "insertMany"
  | "updateOne"
  | "updateMany"
  | "deleteOne"
  | "deleteMany";

export type TransactionOp = {
  col: string;
  op: TransactionOpName;
  args: any[];
};

export type TransactionCollection<T extends DocumentData = DocumentData> = {
  insertOne(doc: T): Promise<void>;
  insertMany(docs: T[]): Promise<void>;
  updateOne(filter: Filter, update: UpdateQuery, options?: LioranUpdateOneOptions): Promise<void>;
  updateMany(filter: Filter, update: UpdateQuery): Promise<void>;
  deleteOne(filter: Filter): Promise<void>;
  deleteMany(filter: Filter): Promise<void>;
};

export type TransactionContext = {
  collection<T extends DocumentData = DocumentData>(name: string): TransactionCollection<T>;
};

export class DB {
  private collectionCache = new Map<string, Collection<any>>();

  constructor(
    private name: string,
    private http: HttpClient
  ) {}

  collection<T extends DocumentData = DocumentData>(
    name: string,
    schema?: { parse: (value: unknown) => T },
    schemaVersion?: number
  ): Collection<T> {
    const existing = this.collectionCache.get(name);
    if (existing) {
      if (schema && typeof (existing as any).setSchema === "function") {
        (existing as any).setSchema(schema, schemaVersion ?? 1);
      }
      return existing as Collection<T>;
    }

    const created = new Collection<T>(this.name, name, this.http);
    if (schema && typeof created.setSchema === "function") {
      created.setSchema(schema as any, schemaVersion ?? 1);
    }
    this.collectionCache.set(name, created as any);
    return created;
  }

  async listCollections(): Promise<string[]> {
    const res = await this.http.get<LioranCollectionListResponse>(
      `/db/${encodeURIComponent(this.name)}/collections`
    );
    return res.collections;
  }

  async createCollection(name: string): Promise<LioranCollectionMutationResponse> {
    return this.http.post<LioranCollectionMutationResponse>(
      `/db/${encodeURIComponent(this.name)}/collections`,
      { name }
    );
  }

  async dropCollection(name: string): Promise<LioranDeleteResponse> {
    return this.http.delete<LioranDeleteResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(name)}`
    );
  }

  async renameCollection(
    oldName: string,
    newName: string
  ): Promise<LioranRenameResponse> {
    return this.http.patch<LioranRenameResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        oldName
      )}/rename`,
      { newName }
    );
  }

  async stats(): Promise<LioranDatabaseStats> {
    return this.http.get<LioranDatabaseStats>(
      `/databases/${encodeURIComponent(this.name)}/stats`
    );
  }

  async compactAll(): Promise<LioranCompactDatabaseResponse> {
    return this.http.post<LioranCompactDatabaseResponse>(
      `/databases/${encodeURIComponent(this.name)}/compact`
    );
  }

  async getSchemaVersion(): Promise<string | null> {
    const res = await this.http.get<LioranDbSchemaVersionResponse>(
      `/databases/${encodeURIComponent(this.name)}/schemaVersion`
    );
    return res.schemaVersion;
  }

  async setSchemaVersion(schemaVersion: string): Promise<string | null> {
    const res = await this.http.put<LioranDbSchemaVersionResponse>(
      `/databases/${encodeURIComponent(this.name)}/schemaVersion`,
      { schemaVersion }
    );
    return res.schemaVersion;
  }

  migrate(): never {
    throw new Error(
      "Remote driver does not support function-based db.migrate(). Use db.applyMigrations(targetVersion, migrations) instead."
    );
  }

  async applyMigrations(
    targetVersion: string,
    migrations: LioranDbMigrationStep[]
  ): Promise<LioranApplyDbMigrationsResponse> {
    return this.http.post<LioranApplyDbMigrationsResponse>(
      `/databases/${encodeURIComponent(this.name)}/migrations/apply`,
      { targetVersion, migrations }
    );
  }

  async rotateEncryptionKey(newKey: string): Promise<LioranRotateEncryptionKeyResponse> {
    return this.http.post<LioranRotateEncryptionKeyResponse>(
      `/databases/${encodeURIComponent(this.name)}/encryption/rotate`,
      { newKey }
    );
  }

  async compactCollection(collection: string): Promise<LioranCompactCollectionResponse> {
    return this.http.post<LioranCompactCollectionResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/compact`
    );
  }

  async createIndex(
    collection: string,
    field: string,
    options?: { unique?: boolean }
  ): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes`,
      { field, unique: !!options?.unique }
    );
  }

  async createTextIndex(
    collection: string,
    field: string,
    options?: Record<string, any>
  ): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes/text`,
      { field, options: options ?? {} }
    );
  }

  async listIndexes(collection: string): Promise<LioranListIndexesResponse["indexes"]> {
    return (await this.http.get<LioranListIndexesResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes`
    )).indexes;
  }

  async dropIndex(collection: string, field: string): Promise<LioranDropIndexResponse> {
    return this.http.delete<LioranDropIndexResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes/${encodeURIComponent(field)}`
    );
  }

  async dropTextIndex(collection: string, field: string): Promise<LioranDropIndexResponse> {
    return this.http.delete<LioranDropIndexResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes/text/${encodeURIComponent(field)}`
    );
  }

  async rebuildIndex(collection: string, field: string): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes/${encodeURIComponent(field)}/rebuild`
    );
  }

  async rebuildTextIndex(collection: string, field: string): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes/text/${encodeURIComponent(field)}/rebuild`
    );
  }

  async rebuildIndexes(collection: string): Promise<LioranRebuildAllIndexesResponse> {
    return this.http.post<LioranRebuildAllIndexesResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/indexes/rebuild`
    );
  }

  async getCollectionOptions(collection: string): Promise<LioranCollectionOptionsResponse["options"]> {
    return (await this.http.get<LioranCollectionOptionsResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/options`
    )).options;
  }

  async setCollectionDateOption(
    collection: string,
    date: LioranCollectionDateOption
  ): Promise<LioranCollectionOptionsResponse["options"]> {
    return (await this.http.patch<LioranCollectionOptionsResponse>(
      `/db/${encodeURIComponent(this.name)}/collections/${encodeURIComponent(
        collection
      )}/options`,
      { date }
    )).options;
  }

  async explain(
    collection: string,
    query: Filter = {},
    options?: LioranFindOptions
  ): Promise<LioranExplainResponse["explain"]> {
    return (await this.http.post<LioranExplainResponse>(
      `/databases/${encodeURIComponent(this.name)}/explain`,
      { collection, query, options: normalizeFindOptions(options) }
    )).explain;
  }

  async transaction<R = any>(ops: TransactionOp[]): Promise<R>;
  async transaction<R = any>(fn: (tx: TransactionContext) => Promise<void> | void): Promise<R>;
  async transaction<R = any>(
    opsOrFn: TransactionOp[] | ((tx: TransactionContext) => Promise<void> | void)
  ): Promise<R> {
    const ops: TransactionOp[] = Array.isArray(opsOrFn) ? opsOrFn : [];

    if (typeof opsOrFn === "function") {
      const tx: TransactionContext = {
        collection: (colName: string) => ({
          insertOne: async (doc: any) => {
            ops.push({ col: colName, op: "insertOne", args: [doc] });
          },
          insertMany: async (docs: any[]) => {
            ops.push({ col: colName, op: "insertMany", args: [docs] });
          },
          updateOne: async (filter: Filter, update: UpdateQuery, options?: LioranUpdateOneOptions) => {
            ops.push({ col: colName, op: "updateOne", args: [filter, update, options ?? {}] });
          },
          updateMany: async (filter: Filter, update: UpdateQuery) => {
            ops.push({ col: colName, op: "updateMany", args: [filter, update] });
          },
          deleteOne: async (filter: Filter) => {
            ops.push({ col: colName, op: "deleteOne", args: [filter] });
          },
          deleteMany: async (filter: Filter) => {
            ops.push({ col: colName, op: "deleteMany", args: [filter] });
          },
        }),
      };

      await opsOrFn(tx);
    }

    const res = await this.http.post<LioranTransactionResponse<R>>(
      `/databases/${encodeURIComponent(this.name)}/transaction`,
      { ops }
    );

    return res.result;
  }

  async getCredentials(): Promise<LioranDatabaseCredentialsResponse> {
    return this.http.get<LioranDatabaseCredentialsResponse>(
      `/databases/${encodeURIComponent(this.name)}/credentials`
    );
  }

  async setCredentials(
    input: DatabaseCredentialsInput
  ): Promise<LioranDatabaseCredentialsMutationResponse> {
    return this.http.put<LioranDatabaseCredentialsMutationResponse>(
      `/databases/${encodeURIComponent(this.name)}/credentials`,
      input
    );
  }

  async getConnectionString(): Promise<LioranDatabaseConnectionStringResponse> {
    return this.http.get<LioranDatabaseConnectionStringResponse>(
      `/databases/${encodeURIComponent(this.name)}/connection-string`
    );
  }
}
