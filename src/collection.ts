import { AxiosInstance } from "axios";
import { DocumentData, Filter, UpdateQuery } from "./types";

export class Collection {
  constructor(
    private dbName: string,
    private colName: string,
    private http: AxiosInstance
  ) {}

  async insertOne(doc: DocumentData) {
    return (await this.http.post(
      `/db/${this.dbName}/collections/${this.colName}`,
      doc
    )).data.doc;
  }

  async insertMany(docs: DocumentData[]) {
    return (await this.http.post(
      `/db/${this.dbName}/collections/${this.colName}/bulk`,
      { docs }
    )).data.docs;
  }

  async find(filter: Filter = {}) {
    return (await this.http.post(
      `/db/${this.dbName}/collections/${this.colName}/find`,
      { query: filter }
    )).data.results;
  }

  async findOne(filter: Filter = {}) {
    const res = await this.find(filter);
    return res[0] || null;
  }

  async updateMany(filter: Filter, update: UpdateQuery) {
    return (await this.http.patch(
      `/db/${this.dbName}/collections/${this.colName}/updateMany`,
      { filter, update }
    )).data;
  }

  async deleteMany(filter: Filter) {
    return (await this.http.post(
      `/db/${this.dbName}/collections/${this.colName}/deleteMany`,
      { filter }
    )).data;
  }

  async count(filter: Filter = {}) {
    return (await this.http.post(
      `/db/${this.dbName}/collections/${this.colName}/count`,
      { filter }
    )).data.count;
  }

  async stats() {
    return (await this.http.get(
      `/db/${this.dbName}/collections/${this.colName}/stats`
    )).data;
  }
}
