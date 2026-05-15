#!/bin/bash
set -e

ENV_FILE="$(dirname "$0")/artifacts/api-server/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: $ENV_FILE not found"
  exit 1
fi

export DATABASE_URL=$(grep "^DATABASE_URL" "$ENV_FILE" | cut -d= -f2- | tr -d '"' | tr -d "'")

if [ -z "$DATABASE_URL" ]; then
  echo "Error: DATABASE_URL not found in $ENV_FILE"
  exit 1
fi

echo "Pushing schema to: $(echo $DATABASE_URL | sed 's/:\/\/[^@]*@/:\\/\\/<credentials>@/')"
pnpm --filter @workspace/db run push
