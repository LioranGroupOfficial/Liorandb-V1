import { parentPort } from "worker_threads";

/**
 * Worker Thread Entry
 *
 * - Does NOT own LioranManager
 * - Does NOT open sockets
 * - Pure compute worker
 * - Communicates via postMessage
 */

if (!parentPort) {
  throw new Error("worker.ts must be run as a worker thread");
}

/* -------------------------------------------------- */
/* TASK HANDLER                                       */
/* -------------------------------------------------- */

parentPort.on("message", async (msg: any) => {
  const { id, task } = msg;

  try {
    // Extend this section with real compute-heavy logic if needed
    const result = await executeTask(task);

    parentPort!.postMessage({
      id,
      ok: true,
      result
    });

  } catch (err: any) {
    parentPort!.postMessage({
      id,
      ok: false,
      error: err?.message || "Worker execution error"
    });
  }
});

/* -------------------------------------------------- */
/* TASK EXECUTION                                     */
/* -------------------------------------------------- */

async function executeTask(task: any): Promise<any> {
  /**
   * Currently passthrough.
   * You can extend this to support:
   * - Aggregations
   * - Sorting large datasets
   * - Map/reduce
   * - Index rebuild compute
   * - Heavy JSON transforms
   */

  return task;
}

/* -------------------------------------------------- */
/* ERROR HANDLING                                     */
/* -------------------------------------------------- */

process.on("uncaughtException", err => {
  console.error("[Worker] Uncaught Exception:", err);
  process.exit(1);
});

process.on("unhandledRejection", err => {
  console.error("[Worker] Unhandled Rejection:", err);
  process.exit(1);
});