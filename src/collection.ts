import {
  DocumentData,
  Filter,
  LioranCollectionStats,
  LioranCountResponse,
  LioranDeleteManyResponse,
  LioranFindResponse,
  LioranInsertManyResponse,
  LioranInsertOneResponse,
  LioranUpdateManyResponse,
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

  async find(filter: Filter = {}): Promise<Array<T & { _id?: string }>> {
    return (await this.http.post<LioranFindResponse<T>>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/find`,
      { query: filter }
    )).results;
  }

  async findOne(filter: Filter = {}): Promise<(T & { _id?: string }) | null> {
    const res = await this.find(filter);
    return res[0] || null;
  }

  async updateMany(
    filter: Filter,
    update: UpdateQuery
  ): Promise<LioranUpdateManyResponse> {
    return this.http.patch<LioranUpdateManyResponse>(
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

  async stats(): Promise<LioranCollectionStats> {
    return this.http.get<LioranCollectionStats>(
      `/db/${encodeURIComponent(this.dbName)}/collections/${encodeURIComponent(
        this.colName
      )}/stats`
    );
  }
}
