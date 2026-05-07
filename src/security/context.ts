import { AsyncLocalStorage } from "node:async_hooks";

export type Principal = {
  id: string;
  roles?: string[];
  attrs?: Record<string, unknown>;
};

export type SecurityContext = {
  principal: Principal;
};

export class SecurityContextManager {
  private als = new AsyncLocalStorage<SecurityContext>();

  withPrincipal<T>(principal: Principal, task: () => Promise<T>): Promise<T> {
    return this.als.run({ principal }, task);
  }

  currentPrincipal(): Principal | null {
    return this.als.getStore()?.principal ?? null;
  }
}

