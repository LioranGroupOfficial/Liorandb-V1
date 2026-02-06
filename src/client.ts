import axios, { AxiosInstance } from "axios";
import { parseUri } from "./utils/parseUri";
import { LioranLoginResponse } from "./types";
import { DB } from "./db";

export class LioranClient {
  private token: string | null = null;
  private http: AxiosInstance;

  constructor(private uri: string) {
    const { host, port } = parseUri(uri);

    this.http = axios.create({
      baseURL: `http://${host}:${port}`,
      headers: { "Content-Type": "application/json" },
    });
  }

  async connect(): Promise<void> {
    const { username, password } = parseUri(this.uri);

    const res = await this.http.post<LioranLoginResponse>("/auth/login", {
      username,
      password,
    });

    this.token = res.data.token;

    this.http.defaults.headers.common["Authorization"] =
      `Bearer ${this.token}`;
  }

  db(name: string): DB {
    if (!this.token) {
      throw new Error("Client not connected. Call connect() first.");
    }
    return new DB(name, this.http);
  }

  async listDatabases(): Promise<string[]> {
    const res = await this.http.get("/databases");
    return res.data.databases;
  }

  async createDatabase(name: string): Promise<void> {
    await this.http.post("/databases", { name });
  }

  async dropDatabase(name: string): Promise<void> {
    await this.http.delete(`/databases/${name}`);
  }

  async renameDatabase(oldName: string, newName: string): Promise<void> {
    await this.http.patch(`/databases/${oldName}/rename`, {
      newName,
    });
  }

  async databaseStats(name: string) {
    return (await this.http.get(`/databases/${name}/stats`)).data;
  }
}
