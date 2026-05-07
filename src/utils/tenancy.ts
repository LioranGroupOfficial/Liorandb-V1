import { LiorandbError } from "./errors.js";

export type TenantLimits = {
  maxDocBytes: number;
  maxBlobBytes: number;
  maxIndexesPerCollection: number;
  maxTextIndexesPerCollection: number;
  background?: {
    maxWorkMsPerTick?: number;
    maxCollectionsPerTick?: number;
  };
};

export type TenancyConfig =
  | {
      enabled?: boolean;
      defaultLimits?: Partial<TenantLimits>;
      limitsForTenant?: (tenantId: string) => Partial<TenantLimits> | null | undefined;
    }
  | undefined;

const DEFAULT_LIMITS: TenantLimits = {
  maxDocBytes: 1 * 1024 * 1024,
  maxBlobBytes: 32 * 1024 * 1024,
  maxIndexesPerCollection: 24,
  maxTextIndexesPerCollection: 4,
  background: undefined
};

export function resolveTenantLimits(cfg: TenancyConfig, tenantId: string): TenantLimits {
  const enabled = cfg?.enabled ?? true;
  if (!enabled) return DEFAULT_LIMITS;

  const fromDefault = cfg?.defaultLimits ?? {};
  const fromHook = cfg?.limitsForTenant?.(tenantId) ?? {};

  const merged: TenantLimits = {
    ...DEFAULT_LIMITS,
    ...fromDefault,
    ...fromHook,
    background: {
      ...(DEFAULT_LIMITS.background ?? {}),
      ...(fromDefault.background ?? {}),
      ...(fromHook.background ?? {})
    }
  };

  merged.maxDocBytes = Math.max(1, Math.trunc(merged.maxDocBytes));
  merged.maxBlobBytes = Math.max(1, Math.trunc(merged.maxBlobBytes));
  merged.maxIndexesPerCollection = Math.max(0, Math.trunc(merged.maxIndexesPerCollection));
  merged.maxTextIndexesPerCollection = Math.max(0, Math.trunc(merged.maxTextIndexesPerCollection));

  return merged;
}

export function assertDocSizeWithinLimits(doc: any, maxBytes: number, details?: Record<string, unknown>) {
  const mb = Math.max(1, Math.trunc(maxBytes));
  let raw = "";
  try {
    raw = JSON.stringify(doc);
  } catch (err) {
    throw new LiorandbError("VALIDATION_FAILED", "Document is not JSON-serializable", {
      cause: err,
      details
    });
  }
  const bytes = Buffer.byteLength(raw, "utf8");
  if (bytes > mb) {
    throw new LiorandbError("VALIDATION_FAILED", "Document exceeds maxDocBytes", {
      details: { ...details, bytes, maxDocBytes: mb }
    });
  }
}

