#!/usr/bin/env bash
set -euo pipefail

port="${1:-3000}"
project_dir="$(pwd -P)"
pids="$(lsof -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | sort -u || true)"

if [ -z "$pids" ]; then
  echo "No process is listening on port $port."
  exit 0
fi

stopped=0
for pid in $pids; do
  process_cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"
  process_binary="$(lsof -a -p "$pid" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -1)"

  if [ "$process_cwd" = "$project_dir" ] && [[ "$process_binary" == */sam ]]; then
    kill -TERM "$pid"
    echo "Stopped SAM Local process $pid on port $port."
    stopped=1
  else
    echo "Refusing to stop PID $pid: it is not a SAM process from $project_dir." >&2
  fi
done

if [ "$stopped" -eq 0 ]; then
  echo "Port $port remains in use. Stop its owner manually or use another LOCAL_PORT." >&2
  exit 1
fi
