#!/bin/sh
set -eu

if [ "${ENVIRONMENT:-}" != "production" ]; then
  echo "Refusing production migration because ENVIRONMENT is not production." >&2
  exit 64
fi

backup_reference=${BACKUP_REFERENCE:-}
if [ "${#backup_reference}" -lt 8 ]; then
  echo "BACKUP_REFERENCE must contain the verified database/storage recovery-point identifier." >&2
  exit 64
fi

exec python -m app.db.migrate upgrade --backup-reference "${backup_reference}"
