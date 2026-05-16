import { parseUri } from "./utils/parseUri";
import {
  LioranAuthResponse,
  LioranCorsUpdateResponse,
  LioranDatabaseCountResponse,
  LioranDatabaseListResponse,
  LioranDatabaseMutationResponse,
  LioranDatabaseStats,
  LioranDatabaseUserListResponse,
  LioranDeleteResponse,
  LioranDocResponse,
  LioranDocsListResponse,
  LioranHealthResponse,
  LioranHostInfoResponse,
  LioranIssueUserTokenResponse,
  LioranMaintenanceCreateSnapshotResponse,
  LioranMaintenanceCompactAllResponse,
  LioranMaintenancePauseResponse,
  LioranMaintenanceSnapshotsResponse,
  LioranMaintenanceResumeResponse,
  LioranMaintenanceRestoreResponse,
  LioranMaintenanceStopResponse,
  LioranMaintenanceStatusResponse,
  LioranManagedDatabase,
  LioranManagedUser,
  LioranMeResponse,
  LioranUser,
  LioranUsersResponse,
  LioranCoreStatusResponse,
  LioranCoreIpcResponse,
  LioranCoreManagersResponse,
  LioranCoreDatabasesResponse,
  LioranCoreDatabaseStatusResponse,
  LioranDbSchemaVersionResponse,
} from "./types";
import { DB } from "./db";
import { HttpClient } from "./http";

export interface RegisterUserInput {
  userId: string;
  username?: string;
  password?: string;
  role?: "admin" | "user";
  externalUserId?: string;
}

export interface CreateDatabaseInput {
  name: string;
  ownerUserId?: string;
}

export class LioranClient {
  private token: string | null = null;
  private connectionString: string | null = null;
  private user: LioranUser | null = null;
  private http: HttpClient;

  constructor(private uri: string) {
    const { protocol, host, port } = parseUri(uri);
    this.http = new HttpClient(`${protocol}://${host}:${port}`);
  }

  async connect(): Promise<void> {
    const parsed = parseUri(this.uri);

    if (parsed.scheme === "liorandb" && parsed.connectionString) {
      this.setConnectionString(parsed.connectionString);
      // Populate `user` from the server since connection-string auth identities
      // are derived server-side (owner, db name, etc).
      await this.me();
      return;
    }

    const { username, password } = parsed;

    if (!username || !password) {
      throw new Error(
        "No credentials found in URI. Use login(username, password), superAdminLogin(secret), setToken(token), or setConnectionString(connectionString)."
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

  async superAdminLogin(secret: string): Promise<LioranAuthResponse> {
    const res = await this.http.post<LioranAuthResponse>(
      "/auth/super-admin/login",
      { secret }
    );

    this.setAuthState(res);
    return res;
  }

  async register(
    username: string,
    password: string
  ): Promise<LioranAuthResponse>;
  async register(input: RegisterUserInput): Promise<LioranAuthResponse>;
  async register(
    usernameOrInput: string | RegisterUserInput,
    password?: string
  ): Promise<LioranAuthResponse> {
    this.assertAuthenticated();

    const input =
      typeof usernameOrInput === "string"
        ? {
            userId: usernameOrInput,
            username: usernameOrInput,
            password,
            role: "user" as const,
          }
        : usernameOrInput;

    const res = await this.http.post<LioranAuthResponse>("/auth/register", {
      userId: input.userId,
      username: input.username ?? input.userId,
      password: input.password,
      role: input.role ?? "user",
      externalUserId: input.externalUserId,
    });

    if (res.token) this.setAuthState(res);
    return res;
  }

  async me(): Promise<LioranMeResponse> {
    this.assertAuthenticated();
    const res = await this.http.get<LioranMeResponse>("/auth/me");
    this.user = res.user;
    return res;
  }

  async listUsers(): Promise<LioranManagedUser[]> {
    this.assertAuthenticated();
    const res = await this.http.get<LioranUsersResponse>("/auth/users");
    return res.users;
  }

  async updateMyCors(origins: string[]): Promise<LioranCorsUpdateResponse> {
    this.assertAuthenticated();
    return this.http.put<LioranCorsUpdateResponse>("/auth/me/cors", { origins });
  }

  async updateUserCors(
    userId: string,
    origins: string[]
  ): Promise<LioranCorsUpdateResponse> {
    this.assertAuthenticated();
    return this.http.put<LioranCorsUpdateResponse>(
      `/auth/users/${encodeURIComponent(userId)}/cors`,
      { origins }
    );
  }

  async issueUserToken(userId: string): Promise<LioranIssueUserTokenResponse> {
    this.assertAuthenticated();
    return this.http.post<LioranIssueUserTokenResponse>(
      `/auth/users/${encodeURIComponent(userId)}/token`
    );
  }

  async health(): Promise<LioranHealthResponse> {
    return this.http.get<LioranHealthResponse>("/health");
  }

  async info(): Promise<LioranHostInfoResponse> {
    return this.http.get<LioranHostInfoResponse>("/api");
  }

  async listDocs(): Promise<LioranDocsListResponse> {
    return this.http.get<LioranDocsListResponse>("/docs");
  }

  async getDoc(id: string): Promise<LioranDocResponse> {
    return this.http.get<LioranDocResponse>(`/docs/${encodeURIComponent(id)}`);
  }

  async maintenanceStatus(): Promise<LioranMaintenanceStatusResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranMaintenanceStatusResponse>("/maintenance/status");
  }

  async listSnapshots(): Promise<LioranMaintenanceSnapshotsResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranMaintenanceSnapshotsResponse>(
      "/maintenance/snapshots"
    );
  }

  async createSnapshotNow(): Promise<LioranMaintenanceCreateSnapshotResponse> {
    this.assertAuthenticated();
    return this.http.post<LioranMaintenanceCreateSnapshotResponse>(
      "/maintenance/snapshots"
    );
  }

  async compactAllDatabases(): Promise<LioranMaintenanceCompactAllResponse> {
    this.assertAuthenticated();
    return this.http.post<LioranMaintenanceCompactAllResponse>(
      "/maintenance/compact/all"
    );
  }

  async stopServer(secret: string): Promise<LioranMaintenanceStopResponse> {
    return this.http.post<LioranMaintenanceStopResponse>("/maintenance/stop", {
      secret,
    });
  }

  async pauseServer(secret: string): Promise<LioranMaintenancePauseResponse> {
    return this.http.post<LioranMaintenancePauseResponse>("/maintenance/pause", {
      secret,
    });
  }

  async resumeServer(secret: string): Promise<LioranMaintenanceResumeResponse> {
    return this.http.post<LioranMaintenanceResumeResponse>(
      "/maintenance/resume",
      { secret }
    );
  }

  async restoreServerSnapshot(
    secret: string,
    snapshotPath: string
  ): Promise<LioranMaintenanceRestoreResponse> {
    return this.http.post<LioranMaintenanceRestoreResponse>(
      "/maintenance/restore",
      { secret, snapshotPath }
    );
  }

  async coreStatus(): Promise<LioranCoreStatusResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranCoreStatusResponse>("/core/status");
  }

  async coreIpc(): Promise<LioranCoreIpcResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranCoreIpcResponse>("/core/ipc");
  }

  async coreManagers(): Promise<LioranCoreManagersResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranCoreManagersResponse>("/core/managers");
  }

  async coreDatabases(): Promise<LioranCoreDatabasesResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranCoreDatabasesResponse>("/core/databases");
  }

  async coreDatabaseStatus(db: string): Promise<LioranCoreDatabaseStatusResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranCoreDatabaseStatusResponse>(
      `/core/databases/${encodeURIComponent(db)}/status`
    );
  }

  async coreDatabaseSchemaVersion(db: string): Promise<LioranDbSchemaVersionResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranDbSchemaVersionResponse>(
      `/core/databases/${encodeURIComponent(db)}/schemaVersion`
    );
  }

  async setCoreDatabaseSchemaVersion(
    db: string,
    schemaVersion: string
  ): Promise<LioranDbSchemaVersionResponse> {
    this.assertAuthenticated();
    return this.http.put<LioranDbSchemaVersionResponse>(
      `/core/databases/${encodeURIComponent(db)}/schemaVersion`,
      { schemaVersion }
    );
  }

  setToken(token: string): void {
    this.token = token;
    this.connectionString = null;
    this.user = null;
    this.http.clearConnectionString();
    this.http.setToken(token);
  }

  setConnectionString(connectionString: string): void {
    this.connectionString = connectionString;
    this.token = null;
    this.http.clearToken();
    this.http.setConnectionString(connectionString);
  }

  getToken(): string | null {
    return this.token;
  }

  getConnectionString(): string | null {
    return this.connectionString;
  }

  getUser(): LioranUser | null {
    return this.user;
  }

  isAuthenticated(): boolean {
    return Boolean(this.token || this.connectionString);
  }

  logout(): void {
    this.token = null;
    this.connectionString = null;
    this.user = null;
    this.http.clearToken();
    this.http.clearConnectionString();
  }

  async db(name: string): Promise<DB> {
    this.assertAuthenticated();
    return new DB(name, this.http);
  }

  async listDatabases(): Promise<LioranManagedDatabase[]> {
    this.assertAuthenticated();
    const res = await this.http.get<LioranDatabaseListResponse>("/databases");
    return res.databases;
  }

  async countDatabases(userId?: string): Promise<LioranDatabaseCountResponse> {
    this.assertAuthenticated();
    const suffix = userId ? `?userId=${encodeURIComponent(userId)}` : "";
    return this.http.get<LioranDatabaseCountResponse>(`/databases/count${suffix}`);
  }

  async listUserDatabases(userId: string): Promise<LioranDatabaseUserListResponse> {
    this.assertAuthenticated();
    return this.http.get<LioranDatabaseUserListResponse>(
      `/databases/user/${encodeURIComponent(userId)}`
    );
  }

  async createDatabase(
    input: string | CreateDatabaseInput
  ): Promise<LioranDatabaseMutationResponse> {
    this.assertAuthenticated();
    const body =
      typeof input === "string"
        ? { name: input }
        : { name: input.name, ownerUserId: input.ownerUserId };

    return this.http.post<LioranDatabaseMutationResponse>("/databases", body);
  }

  async dropDatabase(name: string): Promise<LioranDeleteResponse> {
    this.assertAuthenticated();
    return this.http.delete<LioranDeleteResponse>(
      `/databases/${encodeURIComponent(name)}`
    );
  }

  async databaseStats(name: string): Promise<LioranDatabaseStats> {
    this.assertAuthenticated();
    return this.http.get<LioranDatabaseStats>(
      `/databases/${encodeURIComponent(name)}/stats`
    );
  }

  private setAuthState(auth: LioranAuthResponse): void {
    if (!auth.token) {
      throw new Error("Authentication failed: server returned no token.");
    }

    this.token = auth.token;
    this.connectionString = null;
    this.user = auth.user;
    this.http.clearConnectionString();
    this.http.setToken(auth.token);
  }

  private assertAuthenticated(): void {
    if (!this.token && !this.connectionString) {
      throw new Error(
        "Client is not authenticated. Call connect(), login(), superAdminLogin(), setToken(), or setConnectionString() first."
      );
    }
  }
}
