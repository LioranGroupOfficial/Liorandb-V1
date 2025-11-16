function getByPath(obj, path) {
  return path.split(".").reduce((o, p) => (o ? o[p] : undefined), obj);
}

export function matchDocument(doc, query) {
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
        if (op === "$ne" && (val === v)) return false;
        if (op === "$in" && (!Array.isArray(v) || !v.includes(val))) return false;
      }
    } else {
      if (val !== cond) return false;
    }
  }
  return true;
}

export function applyUpdate(oldDoc, update) {
  const doc = structuredClone(oldDoc);

  // $set
  if (update.$set) {
    for (const k in update.$set) {
      const parts = k.split(".");
      let cur = doc;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = cur[parts[i]] ?? {};
        cur = cur[parts[i]];
      }
      cur[parts.at(-1)] = update.$set[k];
    }
  }

  // $inc
  if (update.$inc) {
    for (const k in update.$inc) {
      const val = getByPath(doc, k) ?? 0;
      const parts = k.split(".");
      let cur = doc;
      for (let i = 0; i < parts.length - 1; i++) {
        cur[parts[i]] = cur[parts[i]] ?? {};
        cur = cur[parts[i]];
      }
      cur[parts.at(-1)] = val + update.$inc[k];
    }
  }

  // Direct merge (no operators)
  const hasOp = Object.keys(update).some((k) => k.startsWith("$"));
  if (!hasOp) {
    return { ...doc, ...update };
  }

  return doc;
}
