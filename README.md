# interview-prep-backend

NestJS backend for interview preparation.

## Requirements

- Node.js >= 16
- npm
- AWS credentials with access to the resources used by the application
- RabbitMQ 4.x, or Docker Compose

## Usage

1. Install dependencies:

   ```bash
   npm install
   ```

2. Initialize DynamoDB tables:

   ```bash
   npm run dynamodb:init
   ```

3. Start the server:

   ```bash
   npm run start:dev
   ```

## Scripts

- `npm run start` - Start the server.
- `npm run start:dev` - Start the server in watch mode.
- `npm run build` - Build the project.
- `npm run dynamodb:init` - Create or validate the required DynamoDB tables.
- `npm run worker:cv` - Build and start the CV worker.
- `npm run worker:jp` - Build and start the job-profile worker.

## DynamoDB initialization

`npm run dynamodb:init` is idempotent:

- Missing tables and indexes are created.
- Existing compatible tables are left unchanged.
- Incompatible primary keys or GSI schemas produce an error instead of
  modifying or deleting existing data.
- New tables use `PAY_PER_REQUEST` billing.

The script reads `AWS_REGION`, standard AWS credentials, and all
`DYNAMO_*_TABLE` variables from `.env`.

Required IAM actions:

```text
dynamodb:CreateTable
dynamodb:DescribeTable
```

The optional CV deduplication table is created only when configured:

```env
DYNAMO_USER_CV_DEDUPE_TABLE=UserCvDedupe
```

For DynamoDB Local:

```env
DYNAMODB_ENDPOINT=http://localhost:8000
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=local
AWS_SECRET_ACCESS_KEY=local
```

When using Docker Compose, DynamoDB Local and the initialization container are
started automatically:

```bash
docker compose up --build
```

The `dynamodb-init` container waits for DynamoDB Local, validates existing
tables, creates missing tables, and exits successfully. The backend starts only
after this initialization completes. Data is persisted in the
`dynamodb_data` Docker volume.

DynamoDB Admin is available at:

```text
http://localhost:8001
```

## RabbitMQ queues

RabbitMQ fully replaces AWS SQS for asynchronous CV and job-profile
processing. Configure local development with:

```env
RABBITMQ_URL=amqp://interview:interview_password@localhost:5672
RABBITMQ_CV_QUEUE=cv-processing
RABBITMQ_JP_QUEUE=jp-processing
RABBITMQ_RETRY_DELAY_MS=10000
RABBITMQ_MAX_ATTEMPTS=3
RABBITMQ_PREFETCH=1
```

Each processing queue has two companion queues:

- `<queue>.retry` stores failed messages temporarily, then returns them to the
  processing queue after `RABBITMQ_RETRY_DELAY_MS`.
- `<queue>.dlq` stores messages that still fail after
  `RABBITMQ_MAX_ATTEMPTS`.

Queues and messages are durable. Workers use manual acknowledgements, and only
acknowledge an original message after processing succeeds or after its retry/DLQ
copy has been confirmed by RabbitMQ.

Docker Compose starts RabbitMQ automatically. Its management interface is:

```text
http://localhost:15672
```

The default local credentials are `interview` / `interview_password`. Override
them with `RABBITMQ_USER` and `RABBITMQ_PASSWORD` before deploying outside local
development.
