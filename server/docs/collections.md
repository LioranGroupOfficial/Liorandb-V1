# Collections and Queries

## Insert

```ts
await users.insertOne({ name: "Ava", age: 25 });
await users.insertMany([
  { name: "Ben", age: 30 },
  { name: "Cara", age: 22 }
]);
```

Documents get an `_id` automatically if one is not provided.

## Find

```ts
const docs = await users.find(
  { age: { $gte: 18 } },
  {
    projection: ["name", "email"],
    limit: 10,
    offset: 20
  }
);
```

Supported query operators include:

- `$eq`
- `$ne`
- `$in`
- `$gt`
- `$gte`
- `$lt`
- `$lte`

## Find One

```ts
const doc = await users.findOne(
  { email: "ava@example.com" },
  { projection: ["name", "email"] }
);
```

`findOne()` shares the same filter and projection behavior as `find()`, but returns a single result or `null`.

## Count

```ts
const total = await users.count();
const activeCount = await users.countDocuments({ active: true });
```

`count()` is the O(1) total-document path.

## Update

```ts
await users.updateOne(
  { email: "ava@example.com" },
  { $set: { active: true } }
);

await users.updateMany(
  { age: { $lt: 18 } },
  { $set: { minor: true } }
);
```

Supported update operators include:

- `$set`
- `$inc`

## Delete

```ts
await users.deleteOne({ email: "ava@example.com" });
await users.deleteMany({ active: false });
```

## Aggregation

```ts
const summary = await users.aggregate([
  { $match: { active: true } },
  { $group: { _id: "$age", count: { $sum: 1 } } }
]);
```

Supported stages:

- `$match`
- `$group`
- `$project`
- `$skip`
- `$limit`

Supported group accumulators:

- `$sum`
- `$avg`
- `$min`
- `$max`
- `$push`
- `$first`
- `$last`

## Explain Plans

```ts
const plan = await users.explain(
  { email: "ava@example.com" },
  { limit: 1 }
);
```

Explain output includes:

- `indexUsed`
- `indexType`
- `scannedDocuments`
- `returnedDocuments`
- `candidateDocuments`
- `executionTimeMs`
- `usedFullScan`

Database-level explain is also available:

```ts
const plan = await db.explain("users", { email: "ava@example.com" });
```
