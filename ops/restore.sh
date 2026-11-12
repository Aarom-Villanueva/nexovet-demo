#!/usr/bin/env bash
set -euo pipefail
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ $# -eq 2 ]] || { echo 'Uso: bash ops/restore.sh archivo.dump nexovet_restore_identificador' >&2; exit 1; }
restore_file="$1"
restore_target="$2"
[[ "$restore_target" =~ ^nexovet_restore_[a-z0-9_]{1,40}$ ]] || { echo 'Solo se restaura a una base nueva nexovet_restore_*.' >&2; exit 1; }
[[ -f "$restore_file" && -f "$restore_file.sha256" ]] || { echo 'Falta respaldo o checksum.' >&2; exit 1; }
restore_hash="$(cat -- "$restore_file.sha256")"
[[ "$restore_hash" =~ ^[a-f0-9]{64}$ && "$(sha256sum -- "$restore_file" | cut -d ' ' -f 1)" == "$restore_hash" ]] || { echo 'Checksum incorrecto; no se creó ninguna base.' >&2; exit 1; }
compose exec -T db pg_restore --list < "$restore_file" > /dev/null
# createdb rechaza destinos existentes. No hay DROP ni --clean.
compose exec -T db createdb -U postgres --owner=nexovet --template=template0 "$restore_target"
compose exec -T db pg_restore -U postgres --role=nexovet --dbname="$restore_target" --single-transaction --exit-on-error --no-owner --no-acl < "$restore_file"
# Los accesos del respaldo no deben volver a ser válidos tras recuperar datos.
compose exec -T db psql -U postgres --dbname="$restore_target" --set=ON_ERROR_STOP=1 > /dev/null <<'SQL'
BEGIN;
DELETE FROM user_sessions;
DELETE FROM password_reset_tokens;
DELETE FROM auth_rate_limits;
INSERT INTO audit_logs(action,entity_type) VALUES ('operations.database_restored','database');
COMMIT;
SQL
printf 'Restaurado en %s. Accesos anteriores invalidados; falta revisar y cambiar la conexión manualmente.\n' "$restore_target"
