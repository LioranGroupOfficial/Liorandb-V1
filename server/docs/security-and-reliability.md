# Security and Reliability

## Document Encryption

Documents are encrypted with AES-256-GCM before they are written to disk.

```ts
const manager = new LioranManager({
  encryptionKey: "my-secret"
});
```

## Encryption Key Rotation

You can re-encrypt a database with a new key:

```ts
await db.rotateEncryptionKey("new-secret");
```

This rewrites:

- collection documents
- WAL files

## WAL

Transactional writes go through the WAL and are replayed during recovery if needed.

```ts
await db.transaction(async (tx) => {
  tx.collection("users").insertOne({
    name: "Ava",
    email: "ava@example.com"
  });
});
```

Current WAL behavior:

- WAL records are encrypted on disk.
- Legacy plaintext WAL lines can still be replayed for compatibility.
- Recovery validates record integrity before applying operations.

## Checkpoints

Checkpoint metadata tracks the last durable log position and allows faster recovery.

## Compaction

```ts
await users.compact();
await db.compactAll();
```

Compaction rebuilds collection storage and then rebuilds registered indexes.

## Important Caveat

Indexes are currently stored separately from encrypted documents and are not encrypted at rest. If you need field-level secrecy for indexed values too, that needs a separate design pass.
