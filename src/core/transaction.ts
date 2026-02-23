import { Collection } from "./collection.js";

let TX_SEQ = 0;

export class TransactionContext {
  private txId = ++TX_SEQ;
  private ops: (() => Promise<any>)[] = [];

  constructor(private db: any) {}

  collection(name: string) {
    const col = this.db.collection(name);

    return new Proxy(col, {
      get: (target, prop: any) => {
        if (typeof (target as any)[prop] !== "function") return target[prop];

        return (...args: any[]) => {
          this.ops.push(() => (target as any)[prop](...args));
        };
      }
    });
  }

  async run<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T> {
    const result = await fn(this);

    for (const op of this.ops) {
      await op();
    }

    return result;
  }
}