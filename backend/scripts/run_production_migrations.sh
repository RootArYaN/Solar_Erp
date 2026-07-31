#!/bin/sh
set -eu

if [ "${ENVIRONMENT:-}" != "production" ]; then
  echo "Refusing production migration because ENVIRONMENT is not production." >&2
  exit 64
fi

backup_reference=${BACKUP_REFERENCE:-}
if [ -n "${backup_reference}" ]; then
  exec python -m app.db.migrate upgrade --backup-reference "${backup_reference}"
fi

# The migration layer permits an empty reference only for a brand-new database.
# It still refuses changes to an existing production database without a
# verified recovery-point identifier.
exec python -m app.db.migrate upgrade
