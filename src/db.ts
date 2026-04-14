import { Collection } from "./collection";
import {
  DocumentData,
  LioranCollectionListResponse,
  LioranCollectionMutationResponse,
  LioranDatabaseConnectionStringResponse,
  LioranDatabaseCredentialsMutationResponse,
  LioranDatabaseCredentialsResponse,
  LioranDatabaseStats,
  LioranDeleteResponse,
  LioranRenameResponse,
} from "./types";
import { HttpClient } from "./http";

export interface DatabaseCredentialsInput {
  username: string;
  password: string;
}

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
