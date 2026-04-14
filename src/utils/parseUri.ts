export interface ParsedURI {
  protocol: "http" | "https";
  host: string;
  port: number;
  username?: string;
  password?: string;
  databaseName?: string;
  connectionString?: string;
  scheme: "http" | "lioran" | "liorandb";
}

export function parseUri(uri: string): ParsedURI {
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const url = new URL(uri);
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));

    if (!url.hostname || !port) {
      throw new Error("Invalid host URL");
    }

    return {
      protocol: url.protocol === "https:" ? "https" : "http",
      host: url.hostname,
      port,
      username: url.username || undefined,
      password: url.password || undefined,
      scheme: "http",
    };
  }

  if (uri.startsWith("lioran://")) {
    return parseLegacyLioranUri(uri);
  }

  if (uri.startsWith("liorandb://")) {
    return parseConnectionStringUri(uri);
  }

  throw new Error(
    "Invalid URI. Must start with http(s)://, lioran://, or liorandb://"
  );
}

function parseLegacyLioranUri(uri: string): ParsedURI {
  const stripped = uri.replace("lioran://", "");
  const [creds, server] = stripped.split("@");

  if (!server) {
    const [host, portStr] = creds.split(":");
    const port = Number(portStr);

    if (!host || !port) {
      throw new Error("Invalid LioranDB URI");
    }

    return { protocol: "http", host, port, scheme: "lioran" };
  }

  if (!creds) {
    throw new Error("Invalid LioranDB URI");
  }

  const [username, password] = creds.split(":");
  const [host, portStr] = server.split(":");
  const port = Number(portStr);

  if (!username || !password || !host || !port) {
    throw new Error("Invalid LioranDB URI");
  }

  return {
    protocol: "http",
    username,
    password,
    host,
    port,
    scheme: "lioran",
  };
}

function parseConnectionStringUri(uri: string): ParsedURI {
  const url = new URL(uri);
  const port = Number(url.port || 4000);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));

  if (!url.hostname || !url.username || !url.password || !databaseName) {
    throw new Error("Invalid liorandb:// connection string");
  }

  const protocol = url.protocol === "liorandbs:" ? "https" : "http";

  return {
    protocol,
    host: url.hostname,
    port,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    databaseName,
    connectionString: uri,
    scheme: "liorandb",
  };
}
