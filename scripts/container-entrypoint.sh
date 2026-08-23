#!/bin/sh
set -eu

if [ ! -f "${DATABASE_PATH:-/data/school-1-11.sqlite}" ] && [ -f /app/bootstrap/school-1-11.sqlite ]; then
  cp /app/bootstrap/school-1-11.sqlite "${DATABASE_PATH:-/data/school-1-11.sqlite}"
fi

exec "$@"
