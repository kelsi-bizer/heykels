#!/usr/bin/env bash
# Start a throwaway local Postgres for development.
#
# In production this is Cloud SQL for PostgreSQL and none of this runs. It exists
# because Postgres refuses to run as root and there is no docker daemon in some
# sandboxes, so `docker compose up` is not always an option.
set -euo pipefail

PGDATA="${PGDATA:-/tmp/pgdata-heykels}"
PGPORT="${PGPORT:-5433}"
PGBIN="${PGBIN:-/usr/lib/postgresql/16/bin}"
DBNAME="${DBNAME:-heykels}"

if "$PGBIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "postgres already running on :$PGPORT"
  exit 0
fi

if [ ! -s "$PGDATA/PG_VERSION" ]; then
  rm -rf "$PGDATA"
  mkdir -p "$PGDATA"
  chown postgres:postgres "$PGDATA" 2>/dev/null || true
  chmod 700 "$PGDATA"
  su postgres -c "$PGBIN/initdb -D $PGDATA -U postgres --auth=trust -E UTF8" >/dev/null
fi

su postgres -c "$PGBIN/pg_ctl -D $PGDATA -l $PGDATA/server.log -o '-p $PGPORT -k /tmp' start" >/dev/null
for _ in $(seq 1 30); do
  su postgres -c "$PGBIN/pg_isready -h 127.0.0.1 -p $PGPORT" >/dev/null 2>&1 && break
  sleep 0.5
done

su postgres -c "psql -h /tmp -p $PGPORT -U postgres -tAc \"SELECT 1 FROM pg_database WHERE datname='$DBNAME'\"" \
  | grep -q 1 || su postgres -c "psql -h /tmp -p $PGPORT -U postgres -c 'CREATE DATABASE $DBNAME'" >/dev/null

echo "postgres ready on :$PGPORT (db=$DBNAME)"
