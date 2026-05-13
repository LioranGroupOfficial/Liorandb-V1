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
  LioranInsertOneResponse,
  LioranListIndexesResponse,
  LioranRebuildAllIndexesResponse,
  LioranUpdateManyResponse,
  LioranUpdateOneOptions,
  LioranUpdateOneResponse,
  UpdateQuery,
} from "./types";
import { HttpClient } from "./http";

export class Collection<T extends DocumentData = DocumentData> {
  constructor(
    private dbName: string,
    private colName: string,
    private http: HttpClient
  ) {}

  async insertOne(doc: T): Promise<T & { _id: string }> {
    return (await this.http.post<LioranInsertOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}`,
      doc
    )).doc;
  }

  async insertMany(docs: T[]): Promise<Array<T & { _id: string }>> {
    return (await this.http.post<LioranInsertManyResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/bulk`,
      { docs }
    )).docs;
  }

  async find(
    filter: Filter = {},
    options?: LioranFindOptions
  ): Promise<Array<T & { _id?: string }>> {
    return (await this.http.post<LioranFindResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/find`,
      { query: filter, options }
    )).results;
  }

  async findOne(
    filter: Filter = {},
    options?: LioranFindOptions
  ): Promise<(T & { _id?: string }) | null> {
    return (await this.http.post<LioranFindOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/findOne`,
      { query: filter, options }
    )).doc;
  }

  async updateOne(
    filter: Filter,
    update: UpdateQuery,
    options?: LioranUpdateOneOptions
  ): Promise<(T & { _id?: string }) | null> {
    return (await this.http.patch<LioranUpdateOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/updateOne`,
      { filter, update, options }
    )).doc;
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
    return (await this.http.post<LioranDeleteOneResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/deleteOne`,
      { filter }
    )).doc;
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

  async createIndex(field: string, options?: { unique?: boolean }): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes`,
      { field, unique: !!options?.unique }
    );
  }

  async dropIndex(field: string): Promise<LioranDropIndexResponse> {
    return this.http.delete<LioranDropIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/${encodeURIComponent(field)}`
    );
  }

  async rebuildIndex(field: string): Promise<LioranCreateIndexResponse> {
    return this.http.post<LioranCreateIndexResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/${encodeURIComponent(field)}/rebuild`
    );
  }

  async rebuildIndexes(): Promise<LioranRebuildAllIndexesResponse> {
    return this.http.post<LioranRebuildAllIndexesResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/indexes/rebuild`
    );
  }

  async explain(
    query: Filter = {},
    options?: LioranFindOptions
  ): Promise<LioranExplainResponse["explain"]> {
    return (await this.http.post<LioranExplainResponse>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/explain`,
      { query, options }
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
}
