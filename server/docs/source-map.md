# Source Map

This document is a quick guide to the `src` tree.

## Top Level

- `src/index.ts`
  Public package exports.
- `src/LioranManager.ts`
  Manager lifecycle, database opening, IPC-aware manager behavior, and top-level proxies.

## Core

- `src/core/database.ts`
  Database orchestration, index registration, transactions, explain plans, compaction coordination, and encryption key rotation.
- `src/core/collection.ts`
  CRUD operations, pagination, projection, count metadata, aggregation, explain support, and document-level indexing updates.
- `src/core/index.ts`
  Secondary index storage, equality lookup, and range scan support.
- `src/core/query.ts`
  Query matching, query planning helpers, and update application helpers.
- `src/core/wal.ts`
  Encrypted write-ahead log append, replay, cleanup, and WAL key rotation.
- `src/core/checkpoint.ts`
  Checkpoint persistence and validation.
- `src/core/compaction.ts`
  Collection compaction and index rebuild flow.
- `src/core/migration.ts`
  Database migration engine.
- `src/core/migration.store.ts`
  Migration metadata storage.
- `src/core/migration.types.ts`
  Migration-related types.
- `src/core/transaction.ts`
  Transaction-related support types or helpers.

## IPC

- `src/ipc/index.ts`
  IPC-facing proxies for collection and database APIs.
- `src/ipc/queue.ts`
  Action routing for client-mode operations.
- `src/ipc/pool.ts`
  Worker-pool management.
- `src/ipc/worker.ts`
  Worker-thread execution entrypoint.

## Types

- `src/types/index.ts`
  Public TypeScript types for queries, indexes, aggregation stages, explain plans, and API contracts.

## Utils

- `src/utils/encryption.ts`
  Encryption helpers, key derivation, and explicit-key encryption/decryption utilities.
- `src/utils/secureKey.ts`
  Master-key bootstrap helpers.
- `src/utils/schema.ts`
  Schema validation support.
- `src/utils/rootpath.ts`
  Default root-path resolution.
- `src/utils/tar.ts`
  Archive-related utilities.
