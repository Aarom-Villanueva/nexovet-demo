#!/usr/bin/env bash
set -euo pipefail
OPS_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
OPS_ENV="${NEXOVET_ENV_FILE:-$OPS_ROOT/.env.deploy}"
OPS_PROJECT="${NEXOVET_PROJECT:-nexovet-live}"
[[ "$OPS_PROJECT" =~ ^[a-z0-9][a-z0-9_-]*$ ]] || { echo 'Proyecto Compose inválido.' >&2; exit 1; }
[[ -f "$OPS_ENV" ]] || { echo 'Falta el archivo privado de despliegue.' >&2; exit 1; }
compose() {
  docker compose --env-file "$OPS_ENV" -p "$OPS_PROJECT" -f "$OPS_ROOT/deploy/compose.yaml" "$@"
}
