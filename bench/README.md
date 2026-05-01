# Benchmarks (Storage Robustness)

These scripts are **not** part of `npm test`. They are meant for large-dataset / long-running profiling.

## Storage benchmark

Build first:

`npm run build`

Run:

`npm run bench:storage`

Environment variables:
- `LIORAN_BENCH_DOCS` (default `200000`)
- `LIORAN_BENCH_BATCH` (default `500`)
- `LIORAN_BENCH_DOC_BYTES` (default `512`) – approximate payload size
- `LIORAN_BENCH_COMPACT` (`1` to run compaction at the end)
- `LIORAN_BENCH_TIERED_FIELDS` (comma separated, e.g. `body`) – enables tiered storage for those fields
- `LIORAN_BENCH_TIERED_THRESHOLD` (bytes, default `8192`)

Output is a JSON summary printed to stdout (ops/s, size on disk, compaction time).

