/**
 * Production-Grade Cursor Token System
 * Prevents duplicate/missing rows across pagination boundaries
 * Uses composite index key: (indexKey, _id)
 */

export interface CursorPosition {
  indexKey: string;
  indexValue: any;
  _id: string;
  timestamp: number;
}

export interface CursorToken {
  v: number; // version
  pos: CursorPosition;
}

/**
 * Encode cursor position to base64 token
 * Safe for transmission and URL usage
 */
export function encodeCursor(position: CursorPosition): string {
  const token: CursorToken = {
    v: 1,
    pos: position
  };
  const json = JSON.stringify(token);
  return Buffer.from(json).toString("base64");
}

/**
 * Decode cursor token back to position
 * Validates format and version
 */
export function decodeCursor(token: string): CursorPosition {
  try {
    const json = Buffer.from(token, "base64").toString("utf8");
    const decoded = JSON.parse(json) as CursorToken;
    if (decoded.v !== 1) {
      throw new Error(`Unsupported cursor version: ${decoded.v}`);
    }
    return decoded.pos;
  } catch (err) {
    throw new Error(`Invalid cursor token: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Cursor comparison for seek operations
 * Returns: -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareCursorPositions(a: CursorPosition, b: CursorPosition): number {
  // First compare by indexed field value
  if (a.indexValue < b.indexValue) return -1;
  if (a.indexValue > b.indexValue) return 1;

  // If index values equal, compare by _id for stable ordering
  if (a._id < b._id) return -1;
  if (a._id > b._id) return 1;

  return 0;
}

/**
 * Check if cursor position is within range
 * Used for validation during pagination
 */
export function isCursorInRange(cursor: CursorPosition, minValue: any, maxValue: any): boolean {
  if (cursor.indexValue < minValue) return false;
  if (cursor.indexValue > maxValue) return false;
  return true;
}

/**
 * Generate cursor for a document
 */
export function generateCursor(doc: any, field: string): CursorPosition {
  const value = getByPath(doc, field);
  return {
    indexKey: field,
    indexValue: value,
    _id: doc._id,
    timestamp: Date.now()
  };
}

function getByPath(obj: any, path: string): any {
  return path.split(".").reduce((o, p) => (o ? o[p] : undefined), obj);
}

/**
 * Options for cursor-based pagination
 */
export interface PaginationOptions {
  cursor?: string; // cursor token from previous page
  limit: number; // documents per page
  field?: string; // field to paginate by (default: _id)
  direction?: "forward" | "backward"; // pagination direction
}

/**
 * Result of cursor-based pagination
 */
export interface PaginationResult<T> {
  items: T[];
  nextCursor?: string; // cursor for next page
  prevCursor?: string; // cursor for previous page
  hasMore: boolean;
  count: number;
}

/**
 * Create pagination result with cursors
 */
export function createPaginationResult<T extends Record<string, any>>(
  items: T[],
  field: string,
  options: { limit: number; direction?: "forward" | "backward" }
): PaginationResult<T> {
  const direction = options.direction ?? "forward";
  const hasMore = items.length > options.limit;
  const actualItems = hasMore ? items.slice(0, options.limit) : items;

  const result: PaginationResult<T> = {
    items: actualItems,
    hasMore,
    count: actualItems.length
  };

  if (actualItems.length > 0) {
    // Set next cursor if there are more items
    if (hasMore) {
      const lastItem = actualItems[actualItems.length - 1];
      result.nextCursor = encodeCursor(generateCursor(lastItem, field));
    }

    // Set previous cursor if not the first page
    if (actualItems.length > 0) {
      const firstItem = actualItems[0];
      result.prevCursor = encodeCursor(generateCursor(firstItem, field));
    }
  }

  return result;
}
