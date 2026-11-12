#!/bin/sh
set -eu
# Solo en un volumen nuevo; la cuenta usada por Node no es superusuario.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set=ON_ERROR_STOP=1 \
  --set=app_password="$APP_DB_PASSWORD" --set=database_name="$POSTGRES_DB" <<'SQL'
CREATE ROLE nexovet LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
ALTER DATABASE :"database_name" OWNER TO nexovet;
SQL
