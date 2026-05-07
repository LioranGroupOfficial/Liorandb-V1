import { parentPort } from "worker_threads";
import { LiorandbError } from "../utils/errors.js";
import { matchDocument } from "../core/query.js";
import { decryptData } from "../utils/encryption.js";

/**
 * Worker Thread Entry
 *
 * - Does NOT own LioranManager
 * - Does NOT open sockets
 * - Pure compute worker
 * - Communicates via postMessage
 */

if (!parentPort) {
  throw new LiorandbError("INTERNAL", "worker.ts must be run as a worker thread");
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
  if (!task || typeof task !== "object") return task;

  if (task.type === "filterProject") {
    const docs = Array.isArray(task.docs) ? task.docs : [];
    const query = task.query;
    const projection = Array.isArray(task.projection) ? task.projection : undefined;

    const out: any[] = [];
    for (const doc of docs) {
      try {
        if (doc && matchDocument(doc, query)) {
          out.push(projectDocument(doc, projection));
        }
      } catch {}
    }

    return { docs: out };
  }

  if (task.type === "decryptDocs") {
    const enc = Array.isArray(task.enc) ? task.enc : [];
    const docs: any[] = [];
    for (const v of enc) {
      if (typeof v !== "string") continue;
      try {
        docs.push(decryptData(v));
      } catch {}
    }
    return { docs };
  }

  return task;
}

function projectDocument(doc: any, projection?: string[]) {
  if (!projection || projection.length === 0) return doc;

  const out: Record<string, any> = {};

  for (const field of projection) {
    if (typeof field !== "string" || field.length === 0) continue;
    const parts = field.split(".");
    let source: any = doc;

    for (const part of parts) {
      if (source == null) {
        source = undefined;
        break;
      }
      source = source[part];
    }

    if (source === undefined) continue;

    let target: Record<string, any> = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = target[part];
      if (!existing || typeof existing !== "object" || Array.isArray(existing)) {
        target[part] = {};
      }
      target = target[part];
    }

    target[parts[parts.length - 1]] = source;
  }

  return out;
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
