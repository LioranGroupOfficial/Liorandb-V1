let running = false;

export async function runExclusiveMaintenance<T>(taskName: string, fn: () => Promise<T>): Promise<T> {
  if (running) {
    const err = new Error(`maintenance already running (cannot start: ${taskName})`);
    (err as any).code = "MAINTENANCE_RUNNING";
    throw err;
  }

  running = true;
  try {
    return await fn();
  } finally {
    running = false;
  }
}

