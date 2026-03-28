/**
 * Creates all five DynamoDB tables in the local DynamoDB instance.
 * Idempotent — ignores ResourceInUseException if a table already exists.
 *
 * Usage:
 *   DYNAMO_ENDPOINT=http://localhost:8000 npx ts-node src/create-local-tables.ts
 *   npm run create-local-tables --workspace=scripts
 */

import {
  CreateTableCommand,
  DynamoDBClient,
  type CreateTableCommandInput,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';

const ENDPOINT = process.env['DYNAMO_ENDPOINT'] ?? 'http://localhost:8000';
const REGION   = process.env['AWS_REGION']        ?? 'us-east-1';

const client = new DynamoDBClient({
  endpoint:    ENDPOINT,
  region:      REGION,
  credentials: {
    accessKeyId:     process.env['AWS_ACCESS_KEY_ID']     ?? 'local',
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'local',
  },
});

const TABLES: CreateTableCommandInput[] = [
  // ── CallResults ────────────────────────────────────────────────────────────
  // Required by: /api/triage (dashboard), sms-fallback lambda, sms-responder lambda
  {
    TableName:            'CallResults',
    BillingMode:          'PAY_PER_REQUEST',
    KeySchema:            [{ AttributeName: 'call_id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'call_id',              AttributeType: 'S' },
      { AttributeName: 'patient_id',           AttributeType: 'S' },
      { AttributeName: 'call_timestamp',       AttributeType: 'S' },
      { AttributeName: 'call_status',          AttributeType: 'S' },
      { AttributeName: 'triage_completed_at',  AttributeType: 'S' },
      { AttributeName: 'created_at',           AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName:  'patient_id-call_timestamp-index',
        KeySchema:  [
          { AttributeName: 'patient_id',     KeyType: 'HASH'  },
          { AttributeName: 'call_timestamp', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName:  'call_status-triage_completed_at-index',
        KeySchema:  [
          { AttributeName: 'call_status',         KeyType: 'HASH'  },
          { AttributeName: 'triage_completed_at', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
      {
        IndexName:  'call_status-created_at-index',
        KeySchema:  [
          { AttributeName: 'call_status', KeyType: 'HASH'  },
          { AttributeName: 'created_at',  KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  // ── PatientProfiles ────────────────────────────────────────────────────────
  // GSI: phone-index required by sms-responder lambda
  {
    TableName:            'PatientProfiles',
    BillingMode:          'PAY_PER_REQUEST',
    KeySchema:            [{ AttributeName: 'patient_id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'patient_id', AttributeType: 'S' },
      { AttributeName: 'phone',      AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName:  'phone-index',
        KeySchema:  [{ AttributeName: 'phone', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },

  // ── TriageProtocols ────────────────────────────────────────────────────────
  {
    TableName:            'TriageProtocols',
    BillingMode:          'PAY_PER_REQUEST',
    KeySchema:            [
      { AttributeName: 'patient_id', KeyType: 'HASH'  },
      { AttributeName: 'version_id', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'patient_id', AttributeType: 'S' },
      { AttributeName: 'version_id', AttributeType: 'S' },
    ],
  },

  // ── ClinicalRules ──────────────────────────────────────────────────────────
  // PK=condition_code SK=version_id — triage-engine reads with Key: { condition_code, version_id: 'LATEST' }
  {
    TableName:            'ClinicalRules',
    BillingMode:          'PAY_PER_REQUEST',
    KeySchema:            [
      { AttributeName: 'condition_code', KeyType: 'HASH'  },
      { AttributeName: 'version_id',     KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'condition_code', AttributeType: 'S' },
      { AttributeName: 'version_id',     AttributeType: 'S' },
    ],
  },

  // ── ProtocolReview ─────────────────────────────────────────────────────────
  // GSI: patient_id-index required by care-planner lambda
  {
    TableName:            'ProtocolReview',
    BillingMode:          'PAY_PER_REQUEST',
    KeySchema:            [{ AttributeName: 'protocol_id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'protocol_id', AttributeType: 'S' },
      { AttributeName: 'patient_id',  AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName:  'patient_id-index',
        KeySchema:  [{ AttributeName: 'patient_id', KeyType: 'HASH' }],
        Projection: { ProjectionType: 'ALL' },
      },
    ],
  },
];

async function main(): Promise<void> {
  console.log(`Creating tables on ${ENDPOINT} ...`);

  for (const table of TABLES) {
    try {
      await client.send(new CreateTableCommand(table));
      console.log(`  ✓ ${table.TableName}`);
    } catch (err) {
      if (err instanceof ResourceInUseException) {
        console.log(`  ~ ${table.TableName} (already exists)`);
      } else {
        throw err;
      }
    }
  }

  console.log('Done.');
}

main().catch((err: unknown) => {
  console.error('Failed to create tables:', err);
  process.exit(1);
});
