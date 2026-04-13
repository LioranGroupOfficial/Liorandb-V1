function getByPath(obj: any, path: string): any {
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
  const indexes = (indexProvider as any).indexes as Set<string>;

  if (!indexes?.size) {
    return new Set(await allDocIds());
  }

  const sel = selectIndex(query, indexes);
  if (!sel) {
    return new Set(await allDocIds());
  }

  const { field, cond } = sel;

  if ("$eq" in cond) {
    return (await indexProvider.findByIndex(field, cond.$eq)) ??
      new Set(await allDocIds());
  }

  if ("$in" in cond) {
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
    return (await indexProvider.rangeByIndex(field, cond)) ??
      new Set(await allDocIds());
  }

  return new Set(await allDocIds());
}
