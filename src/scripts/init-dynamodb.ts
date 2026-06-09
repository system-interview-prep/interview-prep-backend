import 'dotenv/config';
import {
  AttributeDefinition,
  BillingMode,
  CreateTableCommand,
  CreateTableCommandInput,
  DescribeTableCommandOutput,
  DescribeTableCommand,
  DynamoDBClient,
  GlobalSecondaryIndex,
  KeySchemaElement,
  ResourceNotFoundException,
  ScalarAttributeType,
  waitUntilTableExists,
} from '@aws-sdk/client-dynamodb';
import { createDynamoDBClient } from '../config/dynamodb-client';

type Key = {
  name: string;
  type?: ScalarAttributeType;
};

type IndexDefinition = {
  name: string;
  partitionKey: Key;
  sortKey?: Key;
};

type TableDefinition = {
  name: string;
  partitionKey: Key;
  sortKey?: Key;
  indexes?: IndexDefinition[];
  optional?: boolean;
};

const env = (name: string, fallback: string): string =>
  (process.env[name] || '').trim() || fallback;

const tables: TableDefinition[] = [
  {
    name: env('DYNAMO_SESSIONS_TABLE', 'InterviewSessions'),
    partitionKey: { name: 'id' },
    indexes: [
      {
        name: 'user_id-index',
        partitionKey: { name: 'user_id' },
        sortKey: { name: 'started_at' },
      },
    ],
  },
  {
    name: env('DYNAMO_CHAT_TEXT_TABLE', 'InterviewChatText'),
    partitionKey: { name: 'id' },
    indexes: [
      {
        name: 'session_id-index',
        partitionKey: { name: 'session_id' },
        sortKey: { name: 'created_at' },
      },
    ],
  },
  {
    name: env('DYNAMO_CHAT_VOICE_TABLE', 'InterviewChatVoice'),
    partitionKey: { name: 'id' },
    indexes: [
      {
        name: 'session_id-index',
        partitionKey: { name: 'session_id' },
        sortKey: { name: 'created_at' },
      },
    ],
  },
  {
    name: env('DYNAMO_VIDEO_CALL_TABLE', 'InterviewVideoCalls'),
    partitionKey: { name: 'id' },
    indexes: [
      {
        name: 'user_id-index',
        partitionKey: { name: 'user_id' },
        sortKey: { name: 'started_at' },
      },
      {
        name: 'session_id-index',
        partitionKey: { name: 'session_id' },
        sortKey: { name: 'started_at' },
      },
    ],
  },
  {
    // UserService currently reads DYNAMO_USER_TABLE (singular).
    name: env(
      'DYNAMO_USER_TABLE',
      env('DYNAMO_USERS_TABLE', 'Users'),
    ),
    partitionKey: { name: 'PK' },
  },
  {
    name: env('DYNAMO_JOB_CATEGORY_TABLE', 'JobCategories'),
    partitionKey: { name: 'id' },
  },
  {
    name: env('DYNAMO_JOB_PROFILE_TABLE', 'JobProfiles'),
    partitionKey: { name: 'id' },
    indexes: [
      {
        name: 'gsi1',
        partitionKey: { name: 'gsi1pk' },
        sortKey: { name: 'gsi1sk' },
      },
      {
        name: 'gsi2',
        partitionKey: { name: 'gsi2pk' },
        sortKey: { name: 'gsi2sk' },
      },
    ],
  },
  {
    name: env('DYNAMO_USER_CV_TABLE', 'UserCvs'),
    partitionKey: { name: 'user_id' },
    sortKey: { name: 'id' },
  },
  {
    name: env('DYNAMO_SCORING_HISTORY_TABLE', 'InterviewScoringHistory'),
    partitionKey: { name: 'id' },
    indexes: [
      {
        name: 'user_id-index',
        partitionKey: { name: 'user_id' },
        sortKey: { name: 'created_at' },
      },
    ],
  },
  {
    name: env(
      'DYNAMO_INTERVIEW_QUESTION_PLANS_TABLE',
      'InterviewQuestionPlans',
    ),
    partitionKey: { name: 'session_id' },
  },
  {
    name: env(
      'DYNAMO_INTERVIEW_QUESTIONS_TABLE',
      'InterviewQuestions',
    ),
    partitionKey: { name: 'id' },
    indexes: [
      {
        name: 'session_id-index',
        partitionKey: { name: 'session_id' },
        sortKey: { name: 'order' },
      },
    ],
  },
  {
    name: (process.env.DYNAMO_USER_CV_DEDUPE_TABLE || '').trim(),
    partitionKey: { name: 'user_id' },
    sortKey: { name: 'checksum' },
    optional: true,
  },
];

function keySchema(partitionKey: Key, sortKey?: Key): KeySchemaElement[] {
  return [
    { AttributeName: partitionKey.name, KeyType: 'HASH' },
    ...(sortKey
      ? [{ AttributeName: sortKey.name, KeyType: 'RANGE' as const }]
      : []),
  ];
}

function attributeDefinitions(table: TableDefinition): AttributeDefinition[] {
  const attributes = new Map<string, ScalarAttributeType>();
  const add = (key?: Key) => {
    if (key) attributes.set(key.name, key.type || 'S');
  };

  add(table.partitionKey);
  add(table.sortKey);
  for (const index of table.indexes || []) {
    add(index.partitionKey);
    add(index.sortKey);
  }

  return [...attributes].map(([AttributeName, AttributeType]) => ({
    AttributeName,
    AttributeType,
  }));
}

function globalSecondaryIndexes(
  indexes: IndexDefinition[] = [],
): GlobalSecondaryIndex[] | undefined {
  if (indexes.length === 0) return undefined;
  return indexes.map((index) => ({
    IndexName: index.name,
    KeySchema: keySchema(index.partitionKey, index.sortKey),
    Projection: { ProjectionType: 'ALL' },
  }));
}

function createInput(table: TableDefinition): CreateTableCommandInput {
  return {
    TableName: table.name,
    BillingMode: BillingMode.PAY_PER_REQUEST,
    AttributeDefinitions: attributeDefinitions(table),
    KeySchema: keySchema(table.partitionKey, table.sortKey),
    GlobalSecondaryIndexes: globalSecondaryIndexes(table.indexes),
  };
}

function schemaSignature(schema: KeySchemaElement[] | undefined): string {
  return (schema || [])
    .map((key) => `${key.KeyType}:${key.AttributeName}`)
    .sort()
    .join('|');
}

function validateExistingTable(
  expected: TableDefinition,
  actual: DescribeTableCommandOutput,
): void {
  const table = actual.Table;
  const problems: string[] = [];

  if (
    schemaSignature(table?.KeySchema) !==
    schemaSignature(keySchema(expected.partitionKey, expected.sortKey))
  ) {
    problems.push('primary key schema differs');
  }

  const existingIndexes = new Map(
    (table?.GlobalSecondaryIndexes || []).map((index: any) => [
      index.IndexName,
      index.KeySchema,
    ]),
  );
  for (const index of expected.indexes || []) {
    const actualSchema = existingIndexes.get(index.name);
    if (!actualSchema) {
      problems.push(`missing GSI ${index.name}`);
      continue;
    }
    if (
      schemaSignature(actualSchema as KeySchemaElement[]) !==
      schemaSignature(keySchema(index.partitionKey, index.sortKey))
    ) {
      problems.push(`GSI ${index.name} key schema differs`);
    }
  }

  if (problems.length > 0) {
    throw new Error(
      `Table ${expected.name} exists but is incompatible: ${problems.join(
        ', ',
      )}. DynamoDB key schemas cannot be changed in place; migrate or recreate the table.`,
    );
  }
}

async function ensureTable(
  client: DynamoDBClient,
  table: TableDefinition,
): Promise<'created' | 'exists'> {
  try {
    const description = await client.send(
      new DescribeTableCommand({ TableName: table.name }),
    );
    validateExistingTable(table, description);
    console.log(`[exists]  ${table.name}`);
    return 'exists';
  } catch (error) {
    if (!(error instanceof ResourceNotFoundException)) throw error;
  }

  console.log(`[create]  ${table.name}`);
  await client.send(new CreateTableCommand(createInput(table)));
  const result = await waitUntilTableExists(
    { client, maxWaitTime: 180 },
    { TableName: table.name },
  );
  if (result.state !== 'SUCCESS') {
    throw new Error(`Timed out waiting for table ${table.name}`);
  }
  console.log(`[ready]   ${table.name}`);
  return 'created';
}

async function main(): Promise<void> {
  const client = createDynamoDBClient();
  const activeTables = tables.filter(
    (table) => table.name || !table.optional,
  );

  console.log(
    `Ensuring ${activeTables.length} DynamoDB tables in ${
      process.env.AWS_REGION || 'us-east-1'
    }${process.env.DYNAMODB_ENDPOINT ? ` (${process.env.DYNAMODB_ENDPOINT})` : ''}...`,
  );

  let created = 0;
  for (const table of activeTables) {
    if ((await ensureTable(client, table)) === 'created') created++;
  }

  client.destroy();
  console.log(
    `DynamoDB initialization complete: ${created} created, ${
      activeTables.length - created
    } already existed.`,
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(`DynamoDB initialization failed:\n${message}`);
  process.exitCode = 1;
});
