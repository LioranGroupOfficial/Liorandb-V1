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

export type Filter = Record<string, any>;

export type UpdateQuery = {
  $set?: Record<string, any>;
  $inc?: Record<string, number>;
  $unset?: Record<string, boolean>;
};
