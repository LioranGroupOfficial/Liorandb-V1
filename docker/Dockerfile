# NOTE: This Dockerfile lives in `docker/`, but it expects the build context to be the repo root
# so that `server/` is available to COPY. Build with:
#   docker build -f docker/Dockerfile .
# or from inside `docker/`:
#   docker build -f Dockerfile ..
#
# Build the local server package (so cluster fixes in this repo are included)
FROM node:20-alpine AS build

WORKDIR /app/server

COPY server/package.json server/package-lock.json ./
# patch-package runs during `npm ci` (postinstall), so the patch files must be present first.
# COPY server/patches ./patches
RUN npm ci

COPY server/ ./
RUN npm run build

# Runtime image
FROM node:20-alpine

WORKDIR /app/server

COPY --from=build /app/server/dist ./dist
COPY --from=build /app/server/public ./public
COPY --from=build /app/server/node_modules ./node_modules

# Expose default port
EXPOSE 4000

# Set environment variables
ENV PORT=4000
ENV NODE_ENV=production

# Server runtime
# ENV LIORANDB_BASE_URL=http://localhost:4000 \
    # LIORANDB_TRUST_PROXY=1 \
    # LIORANDB_BODY_LIMIT=10mb
ENV LIORANDB_BODY_LIMIT=10mb

# Default admin bootstrap (created only if missing)
ENV LIORANDB_DEFAULT_ADMIN_USERNAME=admin \
    LIORANDB_DEFAULT_ADMIN_PASSWORD=admin

# Engine root path (node-0 uses this path; node-1..node-9 use __cluster_nodes/node-i)
# LIORANDB_ROOT_PATH=/path/to/liorandb-data

# Cluster (server default is 10 nodes if unset)
# ENV LIORANDB_CLUSTER_NODES=1 \
#     LIORANDB_CLUSTER_HOST=127.0.0.1 \
#     LIORANDB_CLUSTER_RAFT_BASE_PORT=7100 \
#     LIORANDB_CLUSTER_WAL_BASE_PORT=8100 \
#     LIORANDB_CLUSTER_CLIENT_BASE_PORT=9100 \
#     LIORANDB_RPC_TOKEN=change-me

# Force single embedded node (ignores LIORANDB_CLUSTER_* settings)
ENV LIORANDB_SINGLE_NODE=1

# Cache budget per node (MB)
ENV LIORANDB_MAX_RAM_MB=512

# Optional: pass-through engine options (JSON) to enable newer features without server code changes
# LIORANDB_ENGINE_OPTIONS_JSON={"security":{"enabled":true}}

# Default command
CMD ["node", "dist/server.js"]
