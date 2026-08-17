#!/usr/bin/env bash
set -euo pipefail

port="${LOCAL_PORT:-3000}"
network="${LOCAL_NETWORK:-pokedex-local}"
base_url="http://127.0.0.1:${port}"
log_file="$(mktemp -t pokedex-sam-local.XXXXXX)"

sam local start-api \
  --template-file .aws-sam/app/template.yaml \
  --env-vars env.json \
  --docker-network "$network" \
  --port "$port" >"$log_file" 2>&1 &
sam_pid=$!

cleanup() {
  kill "$sam_pid" >/dev/null 2>&1 || true
  wait "$sam_pid" >/dev/null 2>&1 || true
  rm -f "$log_file"
}
trap cleanup EXIT INT TERM

for attempt in $(seq 1 60); do
  if ! kill -0 "$sam_pid" >/dev/null 2>&1; then
    echo "SAM Local stopped before the API became ready. Log follows:" >&2
    sed -n '1,240p' "$log_file" >&2
    exit 1
  fi
  if curl --silent --output /dev/null "$base_url/users"; then
    break
  fi
  if [ "$attempt" -eq 60 ]; then
    echo "SAM Local did not become ready. Log follows:" >&2
    sed -n '1,240p' "$log_file" >&2
    exit 1
  fi
  sleep 1
done

assert_request() {
  expected_status="$1"
  method="$2"
  path="$3"
  body="${4:-}"
  assertion="${5:-.}"
  response_file="$(mktemp -t pokedex-response.XXXXXX)"

  if [ -n "$body" ]; then
    actual_status="$(curl --silent --output "$response_file" --write-out '%{http_code}' \
      --request "$method" "$base_url$path" \
      --header 'Content-Type: application/json' --data "$body")"
  else
    actual_status="$(curl --silent --output "$response_file" --write-out '%{http_code}' \
      --request "$method" "$base_url$path")"
  fi

  if [ "$actual_status" != "$expected_status" ]; then
    echo "$method $path: expected $expected_status, received $actual_status" >&2
    sed -n '1,80p' "$response_file" >&2
    echo "SAM Local log follows:" >&2
    sed -n '1,240p' "$log_file" >&2
    rm -f "$response_file"
    exit 1
  fi

  if ! jq --exit-status "$assertion" "$response_file" >/dev/null; then
    echo "$method $path: JSON assertion failed: $assertion" >&2
    sed -n '1,80p' "$response_file" >&2
    exit 1
  fi
  rm -f "$response_file"
  echo "PASS $method $path -> $actual_status"
}

run_id="test-$(date +%s)-$$"
user_id="user-$run_id"
pokemon_id="pokemon-$run_id"

assert_request 201 POST /users "{\"userId\":\"$user_id\",\"username\":\"Local Trainer\",\"balance\":100}" ".userId == \"$user_id\""
assert_request 201 POST /pokemons "{\"pokemonId\":\"$pokemon_id\",\"name\":\"Localmon\",\"type\":\"test\",\"price\":25}" ".pokemonId == \"$pokemon_id\""
assert_request 200 GET /users '' "type == \"array\" and any(.[]; .userId == \"$user_id\")"
assert_request 200 GET /pokemons '' "type == \"array\" and any(.[]; .pokemonId == \"$pokemon_id\")"
assert_request 201 POST "/users/$user_id/purchases" "{\"pokemonId\":\"$pokemon_id\"}" '.purchaseId | type == "string"'
assert_request 400 POST "/users/$user_id/purchases" '{}' '.message | type == "string"'
assert_request 404 POST /users/missing/purchases '{"pokemonId":"pikachu"}' '.message | type == "string"'
assert_request 404 POST "/users/$user_id/purchases" '{"pokemonId":"missing"}' '.message | type == "string"'

echo "All local integration tests passed."
