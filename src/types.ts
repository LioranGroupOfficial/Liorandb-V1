// src/types.ts
export interface LioranUser {
  id: string;
  username: string;
}

export interface LioranLoginResponse {
  user: LioranUser;
  token: string;
}

export interface DocumentData {
  _id?: string;
  [key: string]: any;
}
