export interface LioranUser {
  id: string;
  username: string;
}

export interface LioranAuthResponse {
  user: LioranUser;
  token: string;
}

export interface LioranHealthResponse {
  ok: true;
  time: string;
}

export interface LioranHostInfoResponse {
  name: string;
  role: string;
  status: string;
}

export interface LioranDatabaseListResponse {
  databases: string[];
}

export interface LioranDatabaseMutationResponse {
  ok: boolean;
  db: string;
}

export interface LioranDeleteResponse {
  ok: boolean;
}

export interface LioranRenameResponse {
  ok: true;
  old: string;
  new: string;
}

export interface LioranDatabaseStats {
  name: string;
  collections: number;
  documents: number;
}

export interface LioranCollectionListResponse {
  collections: string[];
}

export interface LioranCollectionMutationResponse {
  ok: boolean;
  collection: string;
}

export interface LioranCollectionStats {
  name: string;
  documents: number;
}

export interface LioranInsertOneResponse<T extends DocumentData> {
  ok: true;
  doc: T & { _id: string };
}

export interface LioranInsertManyResponse<T extends DocumentData> {
  ok: true;
  docs: Array<T & { _id: string }>;
}

export interface LioranFindResponse<T extends DocumentData> {
  results: Array<T & { _id?: string }>;
}

export interface LioranUpdateManyResponse {
  updated: number;
}

export interface LioranDeleteManyResponse {
  deleted: number;
}

export interface LioranCountResponse {
  count: number;
}

export interface DocumentData {
  _id?: string;
  [key: string]: any;
}

export type Filter = Record<string, any>;

export type UpdateQuery = {
  $set?: Record<string, any>;
  $inc?: Record<string, number>;
  $unset?: Record<string, boolean>;
};
