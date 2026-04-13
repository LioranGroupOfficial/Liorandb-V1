export interface ParsedURI {
  protocol: "http" | "https";
  host: string;
  port: number;
  username?: string;
  password?: string;
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
    };
  }

  if (!uri.startsWith("lioran://")) {
    throw new Error("Invalid URI. Must start with lioran:// or http(s)://");
  }

  const stripped = uri.replace("lioran://", "");
  const [creds, server] = stripped.split("@");

  if (!server) {
    const [host, portStr] = creds.split(":");
    const port = Number(portStr);

    if (!host || !port) {
      throw new Error("Invalid LioranDB URI");
    }

    return { protocol: "http", host, port };
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

  return { protocol: "http", username, password, host, port };
}
