// src/utils/parseUri.ts
export interface ParsedURI {
  host: string;
  port: number;
  username: string;
  password: string;
}

export function parseUri(uri: string): ParsedURI {
  if (!uri.startsWith("lioran://")) {
    throw new Error("Invalid URI. Must start with lioran://");
  }

  const stripped = uri.replace("lioran://", "");
  const [creds, server] = stripped.split("@");
  const [username, password] = creds.split(":");
  const [host, portStr] = server.split(":");
  const port = Number(portStr);

  if (!username || !password || !host || !port) {
    throw new Error("Invalid LioranDB URI");
  }

  return { username, password, host, port };
}
