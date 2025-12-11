// src/db.ts
import { AxiosInstance } from "axios";
import { Collection } from "./collection";

export class DB {
  constructor(private name: string, private http: AxiosInstance) {}

  collection(name: string): Collection {
    return new Collection(this.name, name, this.http);
  }
}
