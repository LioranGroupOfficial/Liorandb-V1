export function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash >>> 0;
}

export function shardForId(id: any, shards: number): number {
  const n = Math.max(1, Math.trunc(shards));
  const key = typeof id === "string" ? id : JSON.stringify(id ?? "");
  return fnv1a32(key) % n;
}

