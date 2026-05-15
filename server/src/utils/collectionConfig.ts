// server/src/utils/collectionConfig.ts

export type TextIndexOptions = {
  normalize?: boolean;
  stopwords?: string[];
};

export type CollectionDateOption =
  | boolean
  | "yes"
  | {
      enabled?: boolean | "yes";
      createdField?: string;
      updatedField?: string;
    };

type DbMetaShape = {
  indexes?: Record<
    string,
    Array<{
      field: string;
      options?: any;
      type?: "btree" | "text";
      textOptions?: TextIndexOptions;
    }>
  >;
  collectionOptions?: Record<
    string,
    {
      date?: CollectionDateOption;
    }
  >;
};

function getDbMeta(db: any): DbMetaShape {
  return ((db as any).meta ?? {}) as DbMetaShape;
}

export function readCollectionDateOption(db: any, col: string): CollectionDateOption | undefined {
  const meta = getDbMeta(db);
  return meta.collectionOptions?.[col]?.date;
}

export function writeCollectionDateOption(db: any, col: string, date: CollectionDateOption | undefined) {
  const meta = getDbMeta(db);
  if (!meta.collectionOptions) meta.collectionOptions = {};
  if (!meta.collectionOptions[col]) meta.collectionOptions[col] = {};

  if (date === undefined) {
    delete meta.collectionOptions[col].date;
    if (Object.keys(meta.collectionOptions[col]).length === 0) {
      delete meta.collectionOptions[col];
    }
    if (Object.keys(meta.collectionOptions).length === 0) {
      delete meta.collectionOptions;
    }
  } else {
    meta.collectionOptions[col].date = date;
  }

  (db as any).saveMeta?.();
}

async function resetCollectionHandle(db: any, colName: string) {
  const existing = db.collections?.get?.(colName);
  if (existing) {
    try {
      await existing.close?.();
    } catch {}
    db.collections.delete(colName);
  }
}

export async function reconfigureCollectionDateOption(
  db: any,
  colName: string,
  date: CollectionDateOption | undefined
) {
  writeCollectionDateOption(db, colName, date);
  await resetCollectionHandle(db, colName);
}

export function openConfiguredCollection<T = any>(db: any, colName: string) {
  const date = readCollectionDateOption(db, colName);
  return (db as any).collection(colName, undefined, undefined, { date }) as T;
}
