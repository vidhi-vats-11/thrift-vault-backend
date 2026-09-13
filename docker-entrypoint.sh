#!/bin/sh
# Container entrypoint: apply migrations, then hand the process over to the server.
#
# This exists as a file rather than a chained start command because some hosts
# (Render among them) run the container command in exec form, without a shell —
# so `a && b` is passed to `a` as literal arguments instead of chaining, the
# migration runs, and the container then exits without ever starting the server.
#
# `set -e` aborts before the server starts if migrations fail, so the app never
# serves traffic against a half-migrated schema. `exec` replaces this shell with
# node so the server keeps PID 1 and receives SIGTERM directly on shutdown.
set -e

echo "[entrypoint] applying database migrations"
npx --no-install prisma migrate deploy

echo "[entrypoint] starting server"
exec node src/server.js
