export type CleanupFn = () => void | Promise<void>;

export class LifecycleManager {
  private cleanups: CleanupFn[] = [];
  private closed = false;

  register(cleanup: CleanupFn): void {
    if (this.closed) {
      throw new Error("LifecycleManager is closed");
    }
    this.cleanups.push(cleanup);
  }

  registerInterval(timer: NodeJS.Timeout): void {
    this.register(() => clearInterval(timer));
  }

  registerTimeout(timer: NodeJS.Timeout): void {
    this.register(() => clearTimeout(timer));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    const cleanups = this.cleanups;
    this.cleanups = [];

    for (let i = cleanups.length - 1; i >= 0; i--) {
      try {
        await cleanups[i]();
      } catch {}
    }
  }
}

