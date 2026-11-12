#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
umask 077
backup_dir="${BACKUP_DIR:-$OPS_ROOT/.local/backups}"
mkdir -p -- "$backup_dir"
backup_tmp="$(mktemp "$backup_dir/nexovet-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX.partial")"
trap 'rm -f -- "$backup_tmp" "$backup_tmp.sha256"' EXIT
compose exec -T db sh -c 'exec pg_dump -U postgres -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$backup_tmp"
compose exec -T db pg_restore --list < "$backup_tmp" > /dev/null
sha256sum -- "$backup_tmp" | cut -d ' ' -f 1 > "$backup_tmp.sha256"
backup_path="${backup_tmp%.partial}.dump"
mv -- "$backup_tmp.sha256" "$backup_path.sha256"
mv -- "$backup_tmp" "$backup_path"
printf '%s\n' "$backup_path"
