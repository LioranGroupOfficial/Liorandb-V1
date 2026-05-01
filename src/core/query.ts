export function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((o, p) => (o ? o[p] : undefined), obj);
}

/* ----------------------------- MATCH ENGINE ----------------------------- */

export function matchDocument(doc: any, query: any): boolean {
  if (typeof query === "function") {
    return !!query(doc);
  }

  if (!query || typeof query !== "object") {
    return true;
  }

  for (const key of Object.keys(query)) {
    if (key === "$text") {
      // Text search is handled by the query planner (via text index); treat as always true here.
      continue;
    }
    const cond = query[key];
    const val = getByPath(doc, key);

    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      for (const op of Object.keys(cond)) {
        const v = cond[op];
        if (op === "$gt" && !(val > v)) return false;
        if (op === "$gte" && !(val >= v)) return false;
        if (op === "$lt" && !(val < v)) return false;
        if (op === "$lte" && !(val <= v)) return false;
        if (op === "$ne" && val === v) return false;
        if (op === "$eq" && val !== v) return false;
        if (op === "$in" && (!Array.isArray(v) || !v.includes(val))) return false;
      }
    } else {
      if (val !== cond) return false;
    }
  }
  return true;
}

/* ------------------------------ UPDATE ENGINE ------------------------------ */

export function applyUpdate(oldDoc: any, update: any): any {
  const doc = structuredClone(oldDoc);

  if (update.$set) {
    for (const k in update.$set) {
      const parts = k.split(".");
      let cur = doc;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] ??= {};
        cur = cur[parts[i]];
      }
      cur[parts.at(-1)!] = update.$set[k];
    }
  }

  if (update.$inc) {
    for (const k in update.$inc) {
      const val = getByPath(doc, k) ?? 0;
      const parts = k.split(".");
      let cur = doc;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] ??= {};
        cur = cur[parts[i]];
      }
      cur[parts.at(-1)!] = val + update.$inc[k];
    }
  }

  const hasOp = Object.keys(update).some(k => k.startsWith("$"));
  if (!hasOp) {
    return { ...doc, ...update };
  }

  return doc;
}

/* ------------------------------ INDEX ROUTER ------------------------------ */

export function extractIndexQuery(query: any): { field: string; value: any } | null {
  if (!query || typeof query !== "object" || typeof query === "function") {
    return null;
  }

  for (const key of Object.keys(query)) {
    const cond = query[key];

    // Skip _id as it's handled separately
    if (key === "_id") continue;

    // Simple equality: { field: value }
    if (!cond || typeof cond !== "object" || Array.isArray(cond)) {
      return { field: key, value: cond };
    }

    // $eq operator: { field: { $eq: value } }
    if ("$eq" in cond) {
      return { field: key, value: cond.$eq };
    }
  }

  return null;
}

export interface IndexProvider {
  indexes: Set<string>;

  findByIndex(
    field: string,
    value: any
  ): Promise<Set<string> | null>;

  rangeByIndex?(
    field: string,
    cond: any
  ): Promise<Set<string> | null>;
}

export type QueryPlan = {
  candidateIds: Set<string>;
  usedIndexes: string[];
  usedFullScan: boolean;
};

function isPlainObject(v: any) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function normalizeCond(cond: any): any {
  if (isPlainObject(cond)) return cond;
  return { $eq: cond };
}

function isIndexableCond(cond: any): boolean {
  return isPlainObject(cond) && (
    "$eq" in cond ||
    "$in" in cond ||
    "$gt" in cond ||
    "$gte" in cond ||
    "$lt" in cond ||
    "$lte" in cond
  );
}

async function evalPredicate(
  field: string,
  cond: any,
  indexProvider: IndexProvider,
  allDocIds: () => Promise<string[]>
): Promise<Set<string>> {
  if ("$eq" in cond) {
    return (await indexProvider.findByIndex(field, cond.$eq)) ?? new Set(await allDocIds());
  }

  if ("$in" in cond && Array.isArray(cond.$in)) {
    const out = new Set<string>();
    for (const v of cond.$in) {
      const r = await indexProvider.findByIndex(field, v);
      if (r) for (const id of r) out.add(id);
    }
    return out;
  }

  if (
    indexProvider.rangeByIndex &&
    ("$gt" in cond || "$gte" in cond || "$lt" in cond || "$lte" in cond)
  ) {
    return (await indexProvider.rangeByIndex(field, cond)) ?? new Set(await allDocIds());
  }

  return new Set(await allDocIds());
}

function intersectInto(target: Set<string>, other: Set<string>) {
  for (const id of target) {
    if (!other.has(id)) target.delete(id);
  }
}

/**
 * Query planner:
 * - picks a set of indexable predicates from the query
 * - estimates cost by materializing candidate id sets (bounded by index access)
 * - intersects multiple indexes (AND) starting from the most selective
 */
export async function planQuery(
  query: any,
  indexProvider: IndexProvider,
  allDocIds: () => Promise<string[]>
): Promise<QueryPlan> {
  const indexes = (indexProvider as any).indexes as Set<string>;

  if (!indexes?.size || !query || typeof query !== "object" || typeof query === "function") {
    const ids = new Set(await allDocIds());
    return { candidateIds: ids, usedIndexes: [], usedFullScan: true };
  }

  const predicates: Array<{ field: string; cond: any }> = [];

  for (const key of Object.keys(query)) {
    if (key === "_id" || key === "$text") continue;
    if (!indexes.has(key)) continue;

    const cond = normalizeCond(query[key]);
    if (!isIndexableCond(cond)) continue;

    predicates.push({ field: key, cond });
  }

  if (predicates.length === 0) {
    const ids = new Set(await allDocIds());
    return { candidateIds: ids, usedIndexes: [], usedFullScan: true };
  }

  const evaluated: Array<{ field: string; ids: Set<string> }> = [];

  for (const p of predicates) {
    const ids = await evalPredicate(p.field, p.cond, indexProvider, allDocIds);
    evaluated.push({ field: p.field, ids });
  }

  evaluated.sort((a, b) => a.ids.size - b.ids.size);

  const candidateIds = new Set(evaluated[0].ids);
  const usedIndexes = [evaluated[0].field];

  for (let i = 1; i < evaluated.length; i++) {
    intersectInto(candidateIds, evaluated[i].ids);
    usedIndexes.push(evaluated[i].field);
    if (candidateIds.size === 0) break;
  }

  return { candidateIds, usedIndexes, usedFullScan: false };
}

/**
 * Selects best possible index from query.
 */
export function selectIndex(query: any, indexes: Set<string>) {
  if (!query || typeof query !== "object" || typeof query === "function") {
    return null;
  }

  for (const key of Object.keys(query)) {
    if (!indexes.has(key)) continue;

    const cond = query[key];

    if (cond && typeof cond === "object" && !Array.isArray(cond)) {
      return { field: key, cond };
    }

    return { field: key, cond: { $eq: cond } };
  }

  return null;
}

/**
 * Executes indexed query or fallback full scan.
 */
export async function runIndexedQuery(
  query: any,
  indexProvider: IndexProvider,
  allDocIds: () => Promise<string[]>
): Promise<Set<string>> {
  const plan = await planQuery(query, indexProvider, allDocIds);
  return plan.candidateIds;
}
