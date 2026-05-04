/**
 * Covering Index Execution Path
 * If query fields ⊆ index fields → serve directly from index without disk read
 * Dramatically improves performance for covered queries
 */

export interface IndexMetadata {
  field: string;
  type: "btree" | "hash" | "text";
  fields: string[]; // all fields stored in index
  unique?: boolean;
  sparse?: boolean;
}

export interface CoveringIndexEntry {
  key: string; // indexed value
  values: Map<string, any>; // field -> value mapping
  _id: string;
  _ts?: number; // optional timestamp
}

/**
 * Query coverage analyzer
 * Determines if index can fully cover a query
 */
export class QueryCoverageAnalyzer {
  /**
   * Analyze if index covers all required fields for a query
   */
  static canIndexCoverQuery(
    indexMetadata: IndexMetadata,
    queryFields: string[],
    projectionFields?: string[]
  ): boolean {
    const requiredFields = new Set(queryFields);

    // Add projection fields if specified
    if (projectionFields) {
      for (const field of projectionFields) {
        if (field !== "_id") {
          requiredFields.add(field);
        }
      }
    }

    // Check if all required fields exist in index
    for (const field of requiredFields) {
      if (!indexMetadata.fields.includes(field)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Estimate selectivity benefit of using index vs full scan
   * Lower ratio = better benefit
   */
  static estimateCoverageBenefit(
    indexSelectivity: number, // 0.0-1.0, lower is better
    projectionSelectivity: number // 0.0-1.0, fraction of fields returned
  ): {
    ioBenefit: number; // savings ratio
    cpuBenefit: number; // savings ratio
    recommendation: "use-index" | "full-scan" | "either";
  } {
    const ioBenefit = 1.0 - indexSelectivity;
    const cpuBenefit = projectionSelectivity;

    let recommendation: "use-index" | "full-scan" | "either" = "either";
    if (ioBenefit > 0.5) {
      recommendation = "use-index";
    } else if (ioBenefit < 0.1) {
      recommendation = "full-scan";
    }

    return {
      ioBenefit,
      cpuBenefit,
      recommendation
    };
  }
}

/**
 * Covering Index Result Set
 * Materializes results directly from index
 */
export class CoveringIndexResultSet {
  private entries: CoveringIndexEntry[];
  private projectionFields: string[];
  private filterFn?: (doc: any) => boolean;

  constructor(
    entries: CoveringIndexEntry[],
    projectionFields: string[] = [],
    filterFn?: (doc: any) => boolean
  ) {
    this.entries = entries;
    this.projectionFields = projectionFields;
    this.filterFn = filterFn;
  }

  /**
   * Execute covered query without disk access
   * Complexity: O(k) where k = result size
   */
  execute<T = any>(): T[] {
    const results: T[] = [];

    for (const entry of this.entries) {
      // Build document from index entry
      const doc = this.buildDocFromIndexEntry(entry);

      // Apply filter if provided
      if (this.filterFn && !this.filterFn(doc)) {
        continue;
      }

      // Project fields
      const projected = this.projectFields(doc);
      results.push(projected as T);
    }

    return results;
  }

  /**
   * Get first result (for limit 1 queries)
   */
  getFirst<T = any>(): T | null {
    for (const entry of this.entries) {
      const doc = this.buildDocFromIndexEntry(entry);

      if (this.filterFn && !this.filterFn(doc)) {
        continue;
      }

      return this.projectFields(doc) as T;
    }

    return null;
  }

  /**
   * Count results (for count queries)
   */
  count(): number {
    let count = 0;
    for (const entry of this.entries) {
      const doc = this.buildDocFromIndexEntry(entry);

      if (this.filterFn && !this.filterFn(doc)) {
        continue;
      }

      count++;
    }

    return count;
  }

  /**
   * Build document from index entry values
   */
  private buildDocFromIndexEntry(entry: CoveringIndexEntry): Record<string, any> {
    const doc: Record<string, any> = {
      _id: entry._id
    };

    for (const [field, value] of entry.values) {
      doc[field] = value;
    }

    if (entry._ts !== undefined) {
      doc._ts = entry._ts;
    }

    return doc;
  }

  /**
   * Apply projection to document
   */
  private projectFields(doc: Record<string, any>): Record<string, any> {
    if (this.projectionFields.length === 0) {
      return doc; // Return all fields
    }

    const projected: Record<string, any> = {};

    for (const field of this.projectionFields) {
      if (field in doc) {
        projected[field] = doc[field];
      }
    }

    // Always include _id unless explicitly excluded
    if (!this.projectionFields.includes("-_id")) {
      projected._id = doc._id;
    }

    return projected;
  }

  /**
   * Get size estimate in bytes
   */
  getEstimatedSize(): number {
    let bytes = 0;
    for (const entry of this.entries) {
      bytes += this.estimateEntrySize(entry);
    }
    return bytes;
  }

  private estimateEntrySize(entry: CoveringIndexEntry): number {
    let bytes = 0;
    bytes += entry._id.length; // _id string
    bytes += entry.key.length; // key string
    for (const [field, value] of entry.values) {
      bytes += field.length; // field name
      bytes += this.estimateValueSize(value);
    }
    return bytes;
  }

  private estimateValueSize(value: any): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === "string") return value.length;
    if (typeof value === "number") return 8;
    if (typeof value === "boolean") return 1;
    if (Array.isArray(value)) return value.reduce((sum, v) => sum + this.estimateValueSize(v), 0);
    if (typeof value === "object") {
      return JSON.stringify(value).length;
    }
    return 8;
  }
}

/**
 * Query execution planner with covering index support
 */
export class CoveringIndexPlanner {
  private indexes: Map<string, IndexMetadata> = new Map();

  /**
   * Register available index
   */
  registerIndex(name: string, metadata: IndexMetadata): void {
    this.indexes.set(name, metadata);
  }

  /**
   * Plan query execution
   * Returns covering index if available, otherwise null
   */
  planCoveringIndexExecution(
    queryFields: string[],
    projectionFields?: string[]
  ): {
    indexName: string;
    metadata: IndexMetadata;
  } | null {
    // Find first index that covers all required fields
    for (const [name, metadata] of this.indexes) {
      if (
        QueryCoverageAnalyzer.canIndexCoverQuery(
          metadata,
          queryFields,
          projectionFields
        )
      ) {
        return { indexName: name, metadata };
      }
    }

    return null;
  }

  /**
   * Get all indexes and their coverage status
   */
  getIndexCoverageStats(
    queryFields: string[],
    projectionFields?: string[]
  ): Array<{
    indexName: string;
    covers: boolean;
    coverageScore: number;
  }> {
    const stats = [];

    for (const [name, metadata] of this.indexes) {
      const covers = QueryCoverageAnalyzer.canIndexCoverQuery(
        metadata,
        queryFields,
        projectionFields
      );

      // Calculate coverage score (0-1)
      const allRequiredFields = new Set([...queryFields]);
      if (projectionFields) {
        projectionFields.forEach(f => allRequiredFields.add(f));
      }

      let matchingFields = 0;
      for (const field of allRequiredFields) {
        if (metadata.fields.includes(field)) {
          matchingFields++;
        }
      }

      const coverageScore = allRequiredFields.size > 0 ? matchingFields / allRequiredFields.size : 0;

      stats.push({
        indexName: name,
        covers,
        coverageScore
      });
    }

    return stats.sort((a, b) => b.coverageScore - a.coverageScore);
  }
}
