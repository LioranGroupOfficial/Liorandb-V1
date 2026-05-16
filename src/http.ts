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

  async postNdjson<T>(path: string, docs: Iterable<unknown> | AsyncIterable<unknown>): Promise<T> {
    const stream = tryNdjsonReadable(docs);
    if (stream) {
      return this.request<T>(
        "POST",
        path,
        stream,
        { "Content-Type": "application/x-ndjson" },
        true
      );
    }

    let buffered = "";
    for await (const doc of docs as any) buffered += `${JSON.stringify(doc)}\n`;
    return this.request<T>(
      "POST",
      path,
      buffered,
      { "Content-Type": "application/x-ndjson" },
      true
    );
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
    rawBody?: boolean
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    if (extraHeaders) Object.assign(headers, extraHeaders);

    if (body !== undefined && headers["Content-Type"] === undefined) {
      headers["Content-Type"] = "application/json";
    }

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    } else if (this.connectionString) {
      headers["x-liorandb-connection-string"] = this.connectionString;
    }

    const requestBody =
      body === undefined
        ? undefined
        : rawBody
          ? (body as any)
          : JSON.stringify(body);

    const init: any = {
      method,
      headers,
      body: requestBody,
    };

    // Node's fetch requires `duplex: "half"` when sending a stream body.
    if (rawBody && requestBody && typeof (requestBody as any).pipe === "function") {
      init.duplex = "half";
    }

    const response = await fetch(`${this.baseURL}${path}`, init);

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

function tryNdjsonReadable(docs: Iterable<unknown> | AsyncIterable<unknown>): any | null {
  // Prefer true streaming in Node.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Readable } = require("stream") as typeof import("stream");
    return Readable.from(
      (async function* () {
        for await (const doc of docs as any) {
          yield `${JSON.stringify(doc)}\n`;
        }
      })()
    );
  } catch {
    return null;
  }
}
