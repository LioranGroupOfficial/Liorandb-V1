import { Collection } from "./collection";
import {
  DocumentData,
  LioranCollectionListResponse,
  LioranCollectionMutationResponse,
  LioranDatabaseStats,
  LioranDeleteResponse,
  LioranRenameResponse,
} from "./types";
import { HttpClient } from "./http";

export class DB {
  constructor(
    private name: string,
    private http: HttpClient
  ) {}

  collection<T extends DocumentData = DocumentData>(name: string): Collection<T> {
    return new Collection<T>(this.name, name, this.http);
  }

  async listCollections(): Promise<string[]> {
    const res = await this.http.get<LioranCollectionListResponse>(
      `/db/${this.name}/collections`
    );
    return res.collections;
  }

  async createCollection(name: string): Promise<LioranCollectionMutationResponse> {
    return this.http.post<LioranCollectionMutationResponse>(
      `/db/${this.name}/collections`,
      { name }
    );
  }

  async dropCollection(name: string): Promise<LioranDeleteResponse> {
    return this.http.delete<LioranDeleteResponse>(
      `/db/${this.name}/collections/${name}`
    );
  }

  async renameCollection(
    oldName: string,
    newName: string
  ): Promise<LioranRenameResponse> {
    return this.http.patch<LioranRenameResponse>(
      `/db/${this.name}/collections/${oldName}/rename`,
      { newName }
    );
  }

  async stats(): Promise<LioranDatabaseStats> {
    return this.http.get<LioranDatabaseStats>(`/databases/${this.name}/stats`);
  }
}
