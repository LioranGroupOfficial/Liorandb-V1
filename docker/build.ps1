param(
  [string]$Tag = "ldep/liorandb:v1.2.3",
  [string]$TagLatest = "ldep/liorandb:latest"
)

$ErrorActionPreference = "Stop"

# This Dockerfile needs the repo root as build context (so it can COPY `server/`).
# Run from `docker/`:
#   .\build.ps1

docker build -f Dockerfile -t $Tag -t $TagLatest ..

