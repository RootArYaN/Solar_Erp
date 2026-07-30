#!/bin/sh
set -eu

if [ "${ENVIRONMENT:-}" != "production" ]; then
  echo "Refusing production entrypoint because ENVIRONMENT is not production." >&2
  exit 64
fi

case "${PORT:-8000}" in
  *[!0-9]*|'') echo "PORT must be a positive integer." >&2; exit 64 ;;
esac

case "${WEB_CONCURRENCY:-1}" in
  *[!0-9]*|'') echo "WEB_CONCURRENCY must be a positive integer." >&2; exit 64 ;;
  0) echo "WEB_CONCURRENCY must be at least 1." >&2; exit 64 ;;
esac

exec python -m uvicorn app.main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8000}" \
  --workers "${WEB_CONCURRENCY:-1}" \
  --loop uvloop \
  --http httptools \
  --proxy-headers \
  --forwarded-allow-ips "${FORWARDED_ALLOW_IPS:-127.0.0.1}" \
  --timeout-keep-alive 5 \
  --timeout-graceful-shutdown 30 \
  --no-server-header
