import { IPCClient } from "./client.js";
import { getDefaultRootPath } from "../utils/rootpath.js";

export class DBQueue {
  private client: IPCClient;

  constructor(rootPath = getDefaultRootPath()) {
    this.client = new IPCClient(rootPath);
  }

  exec(action: string, args: any) {
    return this.client.exec(action, args);
  }

  async shutdown() {
    try {
      await this.exec("shutdown", {});
    } catch {}
    this.client.close();
  }
}

export const dbQueue = new DBQueue();