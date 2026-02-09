import { LioranManager } from "../LioranManager.js";

const manager = new LioranManager();

process.on("message", async (msg: any) => {
  const { id, action, args } = msg;

  try {
    let result;

    switch (action) {
      case "db": {
        const db = await manager.db(args.db);
        result = true;
        break;
      }

      case "collection": {
        const db = await manager.db(args.db);
        result = db.collection(args.collection);
        break;
      }

      case "op": {
        const { db, col, method, params } = args;
        const collection = (await manager.db(db)).collection(col);
        result = await (collection as any)[method](...params);
        break;
      }

      default:
        throw new Error("Unknown action");
    }

    process.send?.({ id, ok: true, result });
  } catch (err: any) {
    process.send?.({ id, ok: false, error: err.message });
  }
});
