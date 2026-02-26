import os from "os";
import path from "path";

/**
 * Returns a unique IPC socket path per worker.
 * Required for worker pooling.
 *
 * Each worker must listen on a different socket.
 */

export function getIPCSocketPath(rootPath: string, workerId: number) {
  const safeRoot = rootPath.replace(/[:\\\/]/g, "_");

  if (os.platform() === "win32") {
    // Windows Named Pipe
    return `\\\\.\\pipe\\liorandb_${safeRoot}_${workerId}`;
  }

  // Unix Domain Socket
  return path.join(rootPath, `.lioran_${workerId}.sock`);
}