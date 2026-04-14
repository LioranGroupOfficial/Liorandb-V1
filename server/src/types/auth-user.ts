// src/types/auth-user.ts
export type AuthRole = "super_admin" | "admin" | "user";

export interface AuthUser {
  _id?: string;
  userId: string;
  username: string;
  role: AuthRole;
  externalUserId?: string;
  passwordHash?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export interface ManagedDatabaseRecord {
  _id?: string;
  ownerUserId: string;
  ownerRole: AuthRole;
  requestedName: string;
  databaseName: string;
  dbUsername?: string;
  dbPasswordHash?: string;
  dbPasswordCipherText?: string;
  dbPasswordIv?: string;
  dbPasswordTag?: string;
  credentialsUpdatedAt?: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

export type RequestAuthContext =
  | {
      authType: "jwt";
      userId: string;
      username: string;
      role: AuthRole;
      externalUserId?: string;
    }
  | {
      authType: "connection";
      userId: string;
      username: string;
      role: "user";
      databaseName: string;
    };
