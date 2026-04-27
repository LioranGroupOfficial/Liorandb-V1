import { LioranClient } from "./client";

export type LioranManagerOptions = string | { uri: string };

/**
 * Remote-compatible manager facade that matches the common `@liorandb/core`
 * entrypoint shape, but uses the host server HTTP API under the hood.
 *
 * Note: `await manager.db("name")` works because `await` accepts non-Promise values.
 */
export class LioranManager extends LioranClient {
  constructor(uriOrOptions: LioranManagerOptions) {
    const uri = typeof uriOrOptions === "string" ? uriOrOptions : uriOrOptions.uri;
    super(uri);
  }

  async closeAll(): Promise<void> {
    // No-op for the HTTP driver (kept for core API compatibility).
  }

  async close(): Promise<void> {
    // Alias for core-style shutdown.
    await this.closeAll();
  }
}

