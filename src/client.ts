import { parseUri } from "./utils/parseUri";
import {
  LioranAuthResponse,
  LioranDatabaseListResponse,
  LioranDatabaseMutationResponse,
  LioranDatabaseStats,
  LioranDeleteResponse,
  LioranHealthResponse,
  LioranHostInfoResponse,
  LioranRenameResponse,
  LioranUser,
} from "./types";
import { DB } from "./db";
import { HttpClient } from "./http";

export class LioranClient {
  private token: string | null = null;
  private user: LioranUser | null = null;
  private http: HttpClient;

  constructor(private uri: string) {
    const { protocol, host, port } = parseUri(uri);

    this.http = new HttpClient(`${protocol}://${host}:${port}`);
  }

  async connect(): Promise<void> {
    const { username, password } = parseUri(this.uri);

    if (!username || !password) {
      throw new Error(
        "No credentials found in URI. Use login(username, password) or setToken(token)."
      );
    }

    const res = await this.http.post<LioranAuthResponse>("/auth/login", {
      username,
      password,
    });

    this.setAuthState(res);
  }

  async login(username: string, password: string): Promise<LioranAuthResponse> {
    const res = await this.http.post<LioranAuthResponse>("/auth/login", {
      username,
      password,
    });

    this.setAuthState(res);
    return res;
  }

  async register(username: string, password: string): Promise<LioranAuthResponse> {
    const res = await this.http.post<LioranAuthResponse>("/auth/register", {
      username,
      password,
    });

    this.setAuthState(res);
    return res;
  }

  async health(): Promise<LioranHealthResponse> {
    return this.http.get<LioranHealthResponse>("/health");
  }

  async info(): Promise<LioranHostInfoResponse> {
    return this.http.get<LioranHostInfoResponse>("/");
  }

  setToken(token: string): void {
    this.token = token;
    this.http.setToken(token);
  }

  getToken(): string | null {
    return this.token;
  }

  getUser(): LioranUser | null {
    return this.user;
  }

  isAuthenticated(): boolean {
    return Boolean(this.token);
  }

  logout(): void {
    this.token = null;
    this.user = null;
    this.http.clearToken();
  }

  db(name: string): DB {
    this.assertAuthenticated();
    return new DB(name, this.http);
  }

  async listDatabases(): Promise<string[]> {
    this.assertAuthenticated();
    const res = await this.http.get<LioranDatabaseListResponse>("/databases");
    return res.databases;
  }

  async createDatabase(name: string): Promise<LioranDatabaseMutationResponse> {
    this.assertAuthenticated();
    return this.http.post<LioranDatabaseMutationResponse>(
      "/databases",
      { name }
    );
  }

  async dropDatabase(name: string): Promise<LioranDeleteResponse> {
    this.assertAuthenticated();
    return this.http.delete<LioranDeleteResponse>(`/databases/${name}`);
  }

  async renameDatabase(
    oldName: string,
    newName: string
  ): Promise<LioranRenameResponse> {
    this.assertAuthenticated();
    return this.http.patch<LioranRenameResponse>(`/databases/${oldName}/rename`, {
      newName,
    });
  }

  async databaseStats(name: string): Promise<LioranDatabaseStats> {
    this.assertAuthenticated();
    return this.http.get<LioranDatabaseStats>(`/databases/${name}/stats`);
  }

  private setAuthState(auth: LioranAuthResponse): void {
    this.token = auth.token;
    this.user = auth.user;
    this.http.setToken(auth.token);
  }

  private assertAuthenticated(): void {
    if (!this.token) {
      throw new Error(
        "Client is not authenticated. Call connect(), login(), register(), or setToken() first."
      );
    }
  }
}
