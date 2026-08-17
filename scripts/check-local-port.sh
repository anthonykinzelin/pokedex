#!/usr/bin/env bash
set -euo pipefail

port="${1:-3000}"

if ! command -v lsof >/dev/null 2>&1; then
  exit 0
fi

listener="$(lsof -nP -iTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
if [ -z "$listener" ]; then
  exit 0
fi

echo "Port $port is already in use; the local API was not started." >&2
echo "$listener" >&2
echo >&2
echo "If this is an old SAM process from this project, run:" >&2
echo "  make local-api-stop LOCAL_PORT=$port" >&2
echo "  make local LOCAL_PORT=$port" >&2
echo >&2
echo "Or choose another port and update api_base_url in Postman:" >&2
echo "  make local LOCAL_PORT=3002" >&2
echo "  api_base_url = http://127.0.0.1:3002" >&2
exit 1
