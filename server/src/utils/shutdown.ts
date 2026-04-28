type ShutdownHandler = (reason: string) => Promise<void>;

let shutdownHandler: ShutdownHandler | null = null;

export function registerShutdownHandler(handler: ShutdownHandler) {
  shutdownHandler = handler;
}

export async function requestShutdown(reason: string) {
  if (!shutdownHandler) {
    throw new Error("Shutdown handler is not registered");
  }

  await shutdownHandler(reason);
}

