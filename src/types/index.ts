export interface LioranManagerOptions {
  rootPath?: string
  encryptionKey?: string | Buffer
}

export interface UpdateOptions {
  upsert?: boolean
}

export type Query<T = any> = Partial<T> & {
  [key: string]: any
}
