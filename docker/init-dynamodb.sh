#!/bin/sh
set -eu

endpoint="${DYNAMODB_ENDPOINT:-http://dynamodb-local:8000}"
max_attempts="${DYNAMODB_INIT_MAX_ATTEMPTS:-60}"
attempt=1

echo "Waiting for DynamoDB at ${endpoint}..."

while ! node -e "
const { DynamoDBClient, ListTablesCommand } = require('@aws-sdk/client-dynamodb');
const client = new DynamoDBClient({
  endpoint: process.argv[1],
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || 'local',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || 'local'
  }
});
client.send(new ListTablesCommand({ Limit: 1 }))
  .then(() => client.destroy())
  .catch(() => {
    client.destroy();
    process.exit(1);
  });
" "${endpoint}"
do
  if [ "${attempt}" -ge "${max_attempts}" ]; then
    echo "DynamoDB was not ready after ${max_attempts} attempts." >&2
    exit 1
  fi
  echo "DynamoDB is not ready yet (${attempt}/${max_attempts})..."
  attempt=$((attempt + 1))
  sleep 2
done

echo "DynamoDB is ready. Checking required tables..."
node dist/scripts/init-dynamodb.js
echo "DynamoDB tables are ready."
