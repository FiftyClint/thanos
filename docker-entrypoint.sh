#!/bin/sh
set -e

# Hand the photo volume to the app user, then drop root.
#
# Railway and Fly attach volumes owned by root. The app runs as the unprivileged
# `node` user, so without this it cannot write a single progress photo — the
# first upload fails with EACCES and nothing explains why.
#
# Same pattern the official Postgres and Redis images use: start as root, fix
# ownership of the mount, then exec the real process as a normal user.

UPLOAD_DIR="${UPLOAD_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$UPLOAD_DIR"

  # Only chown when it isn't already ours. On a volume holding a season of
  # photos, a recursive chown on every boot would be slow for no reason.
  if [ "$(stat -c %u "$UPLOAD_DIR")" != "$(id -u node)" ]; then
    echo "entrypoint: taking ownership of $UPLOAD_DIR"
    chown -R node:node "$UPLOAD_DIR"
  fi

  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi

# Already unprivileged (e.g. the platform pinned a UID) — just run.
exec "$@"
