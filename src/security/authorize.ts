import { LiorandbError } from "../utils/errors.js";
import type { Principal } from "./context.js";

export type SecurityAction =
  | "db:read"
  | "db:write"
  | "db:index:create"
  | "db:index:drop"
  | "db:compact"
  | "db:backup"
  | "db:restore"
  | "db:key:rotate";

export type SecurityResource = {
  db?: string;
  collection?: string;
  op?: string;
};

export type AuthorizeHook = (principal: Principal | null, action: SecurityAction, resource: SecurityResource) => void;

export function defaultAuthorize(principal: Principal | null, action: SecurityAction): void {
  // Default policy: allow everything (library mode).
  // Production deployments should provide an AuthorizeHook.
  void principal;
  void action;
}

export function requirePrincipal(principal: Principal | null) {
  if (!principal) {
    throw new LiorandbError("VALIDATION_FAILED", "Missing principal for secured operation");
  }
}

