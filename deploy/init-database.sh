#!/bin/sh
set -eu
# Separate the application owner from the database administration role.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  --set=app_password="$SLOP_APP_PASSWORD" <<'SQL'
CREATE ROLE slop_city LOGIN PASSWORD :'app_password';
ALTER DATABASE slop_city OWNER TO slop_city;
ALTER SCHEMA public OWNER TO slop_city;
SQL
