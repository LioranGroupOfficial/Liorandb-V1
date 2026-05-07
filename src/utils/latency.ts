import { LiorandbError } from "./errors.js";

export type LatencyViolationMode = "none" | "warn" | "throw";

export type LatencyBudgetViolation = {
  label: string;
  elapsedMs: number;
  budgetMs: number;
};

export type LatencyBudgetReporter = (v: LatencyBudgetViolation) => void;

let reporter: LatencyBudgetReporter = (() => {
  // Default: stay silent in production unless explicitly enabled.
  // Console logging is surprisingly expensive under load and can amplify tail latency.
  const enabled = process.env.LIORANDB_LATENCY_BUDGET_LOG === "1";
  if (!enabled) return () => {};
  return v => {
    // eslint-disable-next-line no-console
    console.warn(`[LatencyBudget] ${v.label} exceeded budget`, { elapsedMs: v.elapsedMs, budgetMs: v.budgetMs });
  };
})();

export function setLatencyBudgetReporter(next: LatencyBudgetReporter | null | undefined): void {
  reporter = next ?? (() => {});
}

export async function withLatencyBudget<T>(
  label: string,
  budgetMs: number | undefined,
  mode: LatencyViolationMode | undefined,
  task: () => Promise<T>
): Promise<T> {
  const effectiveMode: LatencyViolationMode = mode ?? "warn";
  const ms = budgetMs === undefined ? undefined : Math.max(0, Math.trunc(budgetMs));
  if (!ms || ms <= 0 || effectiveMode === "none") {
    return await task();
  }

  const startedAt = Date.now();

  if (effectiveMode === "warn") {
    const result = await task();
    const elapsed = Date.now() - startedAt;
    if (elapsed > ms) {
      reporter({ label, elapsedMs: elapsed, budgetMs: ms });
    }
    return result;
  }

  // throw: fail-fast for the caller (note underlying work may still complete in background).
  let timeout: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new LiorandbError("INTERNAL", "Latency budget exceeded", {
        details: { label, budgetMs: ms }
      }));
    }, ms);
    timeout.unref?.();
  });

  try {
    const result = await Promise.race([task(), timeoutPromise]);
    const elapsed = Date.now() - startedAt;
    if (elapsed > ms) {
      // If task won the race but still exceeded (unlikely), treat as violation.
      throw new LiorandbError("INTERNAL", "Latency budget exceeded", {
        details: { label, elapsedMs: elapsed, budgetMs: ms }
      });
    }
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
