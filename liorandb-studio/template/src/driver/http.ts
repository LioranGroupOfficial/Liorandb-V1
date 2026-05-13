export class HttpError extends Error {
  constructor(
    message: string,
    public status: number,
    public data?: unknown
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class HttpClient {
  private token: string | null = null;
  private connectionString: string | null = null;

  constructor(private baseURL: string) {}

  setToken(token: string): void {
    this.token = token;
    this.connectionString = null;
  }

  clearToken(): void {
    this.token = null;
  }

  setConnectionString(connectionString: string): void {
    this.connectionString = connectionString;
    this.token = null;
  }

  clearConnectionString(): void {
    this.connectionString = null;
  }

  async get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PUT", path, body);
  }

  async delete<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    } else if (this.connectionString) {
      headers["x-liorandb-connection-string"] = this.connectionString;
    }

    const response = await fetch(`${this.baseURL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const raw = await response.text();
    const data = raw ? tryParseJson(raw) : null;

    if (!response.ok) {
      const message =
        typeof data === "object" &&
        data !== null &&
        (("error" in data &&
          typeof (data as { error?: unknown }).error === "string") ||
          ("reason" in data &&
            typeof (data as { reason?: unknown }).reason === "string"))
          ? ("error" in data &&
            typeof (data as { error?: unknown }).error === "string"
              ? (data as { error: string }).error
              : (data as { reason: string }).reason)
          : `${method} ${path} failed with status ${response.status}`;

      throw new HttpError(message, response.status, data);
    }

    return data as T;
  }
}

function tryParseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
