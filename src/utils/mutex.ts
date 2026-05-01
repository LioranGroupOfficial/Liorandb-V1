export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<R>(task: () => Promise<R>): Promise<R> {
    let release!: () => void;
    const next = new Promise<void>(resolve => { release = resolve; });

    const prev = this.tail;
    this.tail = prev.then(() => next);

    await prev;
    try {
      return await task();
    } finally {
      release();
    }
  }
}

