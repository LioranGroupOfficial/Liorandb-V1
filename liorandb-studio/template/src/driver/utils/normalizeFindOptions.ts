import type { Filter, LioranFindOptions } from "../types";

function normalizeSortDir(sortDir: LioranFindOptions["sortDir"]): 1 | -1 {
  if (sortDir === -1 || sortDir === "-1" || sortDir === "desc") return -1;
  return 1;
}

export function normalizeFindOptions(
  options?: LioranFindOptions
): LioranFindOptions | undefined {
  if (!options) return undefined;

  const normalized: LioranFindOptions = { ...options };

  if (!normalized.sort && normalized.sortBy) {
    normalized.sort = { [normalized.sortBy]: normalizeSortDir(normalized.sortDir) };
  }

  delete (normalized as any).sortBy;
  delete (normalized as any).sortDir;

  return normalized;
}

export function extractFindPayload(
  query: Filter,
  options?: LioranFindOptions
): { query: Filter; options?: LioranFindOptions } {
  // Preferred pattern: embed options in the query under a reserved key.
  // If the caller also passes `options`, the explicit argument wins.
  const embedded = (query as any)?.__options;
  if (!options && embedded && typeof embedded === "object") {
    const { __options, ...rest } = query as any;
    return { query: rest, options: normalizeFindOptions(embedded) };
  }

  if ((query as any)?.__options !== undefined) {
    const { __options, ...rest } = query as any;
    return { query: rest, options: normalizeFindOptions(options) };
  }

  return { query, options: normalizeFindOptions(options) };
}

