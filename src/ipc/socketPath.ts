import os from "os";
import path from "path";

export function getIPCSocketPath(rootPath: string) {
  if (os.platform() === "win32") {
    return `\\\\.\\pipe\\liorandb_${rootPath.replace(/[:\\\/]/g, "_")}`;
  }

  return path.join(rootPath, ".lioran.sock");
}