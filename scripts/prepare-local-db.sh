#!/usr/bin/env bash
set -euo pipefail

table_name="${1:-pokedex-local-data}"
endpoint="http://127.0.0.1:8000"

for attempt in $(seq 1 30); do
  if aws --endpoint-url "$endpoint" dynamodb list-tables >/dev/null 2>&1; then
    break
  fi
  if [ "$attempt" -eq 30 ]; then
    echo "DynamoDB Local did not become ready on port 8000." >&2
    exit 1
  fi
  sleep 1
done

if ! aws --endpoint-url "$endpoint" dynamodb describe-table --table-name "$table_name" >/dev/null 2>&1; then
  aws --endpoint-url "$endpoint" dynamodb create-table \
    --table-name "$table_name" \
    --billing-mode PAY_PER_REQUEST \
    --attribute-definitions \
      AttributeName=PK,AttributeType=S \
      AttributeName=SK,AttributeType=S \
      AttributeName=GSI1PK,AttributeType=S \
      AttributeName=GSI1SK,AttributeType=S \
    --key-schema \
      AttributeName=PK,KeyType=HASH \
      AttributeName=SK,KeyType=RANGE \
    --global-secondary-indexes \
      'IndexName=GSI1,KeySchema=[{AttributeName=GSI1PK,KeyType=HASH},{AttributeName=GSI1SK,KeyType=RANGE}],Projection={ProjectionType=ALL}' \
    >/dev/null
fi

TABLE_NAME="$table_name" DYNAMODB_ENDPOINT="$endpoint" node scripts/seed.js
echo "DynamoDB Local is ready and seeded: $table_name"
