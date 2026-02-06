import { AxiosInstance } from "axios";
import { Collection } from "./collection";

export class DB {
  constructor(
    private name: string,
    private http: AxiosInstance
  ) {}

  collection(name: string): Collection {
    return new Collection(this.name, name, this.http);
  }

  async listCollections(): Promise<string[]> {
    const res = await this.http.get(`/db/${this.name}/collections`);
    return res.data.collections;
  }

  async createCollection(name: string): Promise<void> {
    await this.http.post(`/db/${this.name}/collections`, { name });
  }

  async dropCollection(name: string): Promise<void> {
    await this.http.delete(`/db/${this.name}/collections/${name}`);
  }

  async renameCollection(oldName: string, newName: string): Promise<void> {
    await this.http.patch(
      `/db/${this.name}/collections/${oldName}/rename`,
      { newName }
    );
  }

  async stats() {
    return (await this.http.get(`/databases/${this.name}/stats`)).data;
  }
}
