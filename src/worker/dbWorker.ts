import { LioranManager } from "../LioranManager.js";

const manager = new LioranManager({ ipc: false });

process.on("message", async (msg: any) => {
  const { id, action, args } = msg;

  try {
    let result;

    switch (action) {
      case "shutdown":
        await manager.closeAll();
        result = true;
        break;

      case "db":
        await manager.db(args.db);
        result = true;
        break;

      case "op": {
        const { db, col, method, params } = args;
        const collection = (await manager.db(db)).collection(col);
        result = await (collection as any)[method](...params);
        break;
      }

      case "tx": {
        const db = await manager.db(args.db);
        result = await db.transaction(args.fn);
        break;
      }

      default:
        throw new Error("Unknown IPC action");
    }

    process.send?.({ id, ok: true, result });
  } catch (err: any) {
    process.send?.({ id, ok: false, error: err.message });
  }
});