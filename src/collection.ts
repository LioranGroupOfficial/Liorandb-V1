import {
  DocumentData,
  Filter,
  LioranAggregateResponse,
  LioranCompactCollectionResponse,
  LioranCollectionStats,
  LioranCountResponse,
  LioranCreateIndexResponse,
  LioranDeleteManyResponse,
  LioranDeleteOneResponse,
  LioranDropIndexResponse,
  LioranExplainResponse,
  LioranFindResponse,
  LioranFindOneResponse,
  LioranFindOptions,
  LioranInsertManyResponse,
  LioranInsertManyStreamResponse,
  LioranInsertOneResponse,
  LioranListIndexesResponse,
  LioranCollectionOptionsResponse,
  LioranCollectionDateOption,
  LioranRebuildAllIndexesResponse,
  LioranUpdateManyResponse,
  LioranUpdateOneOptions,
  LioranUpdateOneResponse,
  LioranGetCollectionMigrationsResponse,
  LioranPutCollectionMigrationsResponse,
  LioranTestCollectionMigrationResponse,
  LioranCollectionDocMigrationsConfig,
  UpdateQuery,
} from "./types";
import { HttpClient } from "./http";
import { extractFindPayload } from "./utils/normalizeFindOptions";

type Schema<T> = { parse: (value: unknown) => T };
type DocMigration<T> = { from: number; to: number; migrate: (doc: any) => T };

export class Collection<T extends DocumentData = DocumentData> {
  private schema: Schema<T> | null = null;
  private schemaVersion: number | null = null;
  private migrations: DocMigration<T>[] = [];

  constructor(
    private dbName: string,
    private colName: string,
    private http: HttpClient
  ) {}

  setSchema(schema: Schema<T>, version: number): void {
    this.schema = schema;
    this.schemaVersion = version;
  }

  addMigration(migration: DocMigration<T>): void {
    this.migrations.push(migration);
  }

  async insertOne(doc: T): Promise<T & { _id: string }> {
    return (await this.http.post<LioranInsertOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}`,
      this.prepareWrite(doc)
    )).doc;
  }

  async insertMany(docs: T[]): Promise<Array<T & { _id: string }>> {
    return (await this.http.post<LioranInsertManyResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/bulk`,
      { docs: docs.map((d) => this.prepareWrite(d)) }
    )).docs;
  }

  async insertManyStream(
    docs: Iterable<any> | AsyncIterable<any>,
    _options?: { chunkSize?: number }
  ): Promise<number> {
    const res = await this.http.postNdjson<LioranInsertManyStreamResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/bulk/stream`,
      (async function* () {
        for await (const doc of docs as any) yield doc;
      })()
    );

    if ("result" in res && typeof (res as any).result === "number") return (res as any).result;
    if ("docs" in res && Array.isArray((res as any).docs)) return (res as any).docs.length;
    return 0;
  }

  async find(
    filter: Filter = {},
    options?: LioranFindOptions
  ): Promise<Array<T & { _id?: string }>> {
    const payload = extractFindPayload(filter, options);
    const results = (await this.http.post<LioranFindResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/find`,
      payload
    )).results;
    return results.map((d) => this.migrateRead(d));
  }

  async findOne(
    filter: Filter = {},
    options?: LioranFindOptions
  ): Promise<(T & { _id?: string }) | null> {
    const payload = extractFindPayload(filter, options);
    const doc = (await this.http.post<LioranFindOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/findOne`,
      payload
    )).doc;
    return doc ? this.migrateRead(doc) : null;
  }

  async updateOne(
    filter: Filter,
    update: UpdateQuery,
    options?: LioranUpdateOneOptions
  ): Promise<(T & { _id?: string }) | null> {
    const doc = (await this.http.patch<LioranUpdateOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/updateOne`,
      { filter, update, options }
    )).doc;
    return doc ? this.migrateRead(doc) : null;
  }

  async updateMany(
    filter: Filter,
    update: UpdateQuery
  ): Promise<LioranUpdateManyResponse<T>> {
    return this.http.patch<LioranUpdateManyResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/updateMany`,
      { filter, update }
    );
  }

  async deleteMany(filter: Filter): Promise<LioranDeleteManyResponse> {
    return this.http.post<LioranDeleteManyResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/deleteMany`,
      { filter }
    );
  }

  async count(filter: Filter = {}): Promise<number> {
    return (await this.http.post<LioranCountResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/count`,
      { filter }
    )).count;
  }

  async countDocuments(filter: Filter = {}): Promise<number> {
    return this.count(filter);
  }

  async deleteOne(filter: Filter): Promise<(T & { _id?: string }) | null> {
    const doc = (await this.http.post<LioranDeleteOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/deleteOne`,
      { filter }
    )).doc;
    return doc ? this.migrateRead(doc) : null;
  }

  async aggregate<R = unknown>(pipeline: unknown[] = []): Promise<R[]> {
    return (await this.http.post<LioranAggregateResponse<R>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/aggregate`,
      { pipeline }
    )).results;
  }

  async listIndexes(): Promise<LioranListIndexesResponse["indexes"]> {
    return (await this.http.get<LioranListIndexesResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes`
    )).indexes;
  }

  async createIndex(
    field: string,
    options?: { unique?: boolean }
  ): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes`,
      { field, unique: !!options?.unique }
    );
  }

  async createTextIndex(
    field: string,
    options?: Record<string, any>
  ): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/text`,
      { field, options: options ?? {} }
    );
  }

  async dropIndex(field: string): Promise<LioranDropIndexResponse> {
    return this.http.delete<LioranDropIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/${encodeURIComponent(field)}`
    );
  }

  async dropTextIndex(field: string): Promise<LioranDropIndexResponse> {
    return this.http.delete<LioranDropIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/text/${encodeURIComponent(field)}`
    );
  }

  async rebuildIndex(field: string): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/${encodeURIComponent(field)}/rebuild`
    );
  }

  async rebuildTextIndex(field: string): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/text/${encodeURIComponent(field)}/rebuild`
    );
  }

  async rebuildIndexes(): Promise<LioranRebuildAllIndexesResponse> {
    return this.http.post<LioranRebuildAllIndexesResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/rebuild`
    );
  }

  async getOptions(): Promise<LioranCollectionOptionsResponse["options"]> {
    return (await this.http.get<LioranCollectionOptionsResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/options`
    )).options;
  }

  async setDateOption(date: LioranCollectionDateOption): Promise<LioranCollectionOptionsResponse["options"]> {
    return (await this.http.patch<LioranCollectionOptionsResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/options`,
      { date }
    )).options;
  }

  async explain(
    query: Filter = {},
    options?: LioranFindOptions
  ): Promise<LioranExplainResponse["explain"]> {
    const payload = extractFindPayload(query, options);
    return (await this.http.post<LioranExplainResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/explain`,
      payload
    )).explain;
  }

  async stats(): Promise<LioranCollectionStats> {
    return this.http.get<LioranCollectionStats>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/stats`
    );
  }

  async compact(): Promise<LioranCompactCollectionResponse> {
    return this.http.post<LioranCompactCollectionResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/compact`
    );
  }

  async getDocMigrations(): Promise<LioranGetCollectionMigrationsResponse> {
    return this.http.get<LioranGetCollectionMigrationsResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/migrations`
    );
  }

  async setDocMigrations(
    config: LioranCollectionDocMigrationsConfig | null
  ): Promise<LioranPutCollectionMigrationsResponse> {
    return this.http.put<LioranPutCollectionMigrationsResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/migrations`,
      { config }
    );
  }

  async testDocMigration(doc: any): Promise<LioranTestCollectionMigrationResponse> {
    return this.http.post<LioranTestCollectionMigrationResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/migrations/test`,
      { doc }
    );
  }

  private prepareWrite(doc: T): any {
    const parsed = this.schema ? this.schema.parse(doc) : (doc as any);
    if (this.schemaVersion != null) {
      const existing = (parsed as any)?.__v;
      if (existing === undefined) return { ...(parsed as any), __v: this.schemaVersion };
    }
    return parsed;
  }

  private migrateRead(doc: any): any {
    const current = this.schemaVersion ?? null;
    if (!current || this.migrations.length === 0) {
      return this.schema ? this.schema.parse(doc) : doc;
    }

    let out: any = doc;
    let v: number = Number((out as any)?.__v ?? current);
    if (!Number.isFinite(v)) v = current;

    // Apply migrations until we reach the configured version or no matching step exists.
    while (v < current) {
      const step = this.migrations.find((m) => m.from === v && m.to > v && m.to <= current);
      if (!step) break;
      out = step.migrate(out);
      v = step.to;
      out = { ...out, __v: v };
    }

    // Ensure the returned object matches the latest schema.
    return this.schema ? this.schema.parse(out) : out;
  }
}
