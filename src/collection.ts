// src/collection.ts
import { AxiosInstance } from "axios";
import { DocumentData } from "./types";

export class Collection {
  constructor(
    private dbName: string,
    private colName: string,
    private http: AxiosInstance
  ) {}

  async insertOne(doc: DocumentData) {
    return (await this.http.post(`/db/${this.dbName}/collections/${this.colName}`, doc)).data;
  }

  async find(query: object) {
    return (await this.http.post(`/db/${this.dbName}/collections/${this.colName}/find`, { query })).data.results;
  }

  async findOne(query: object) {
    const results = await this.find(query);
    return results.length > 0 ? results[0] : null;
  }

  async updateOne(filter: object, update: object) {
    const doc = await this.findOne(filter);
    if (!doc?._id) throw new Error("Document not found for update");
    return (await this.http.patch(`/db/${this.dbName}/collections/${this.colName}/${doc._id}`, update)).data;
  }

  async deleteOne(filter: object) {
    const doc = await this.findOne(filter);
    if (!doc?._id) throw new Error("Document not found for delete");
    return (await this.http.delete(`/db/${this.dbName}/collections/${this.colName}/${doc._id}`)).data;
  }
}
