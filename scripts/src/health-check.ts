/**
 * Verifies all Aegis systems are operational.
 *
 * Checks:
 *   1. Medplum on port 8103
 *   2. DynamoDB on port 8000
 *   3. PatientProfiles table — exists and has data
 *   4. ClinicalRules table  — exists and has data
 *   5. CallResults, TriageProtocols, ProtocolReview tables — exist
 *   6. Dashboard dev server on port 3000
 *
 * Usage:
 *   npm run health-check --workspace=scripts
 */

import {
  DescribeTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';

// ── Environment ──────────────────────────────────────────────────────────────

const DYNAMO_ENDPOINT = process.env['DYNAMO_ENDPOINT'] ?? 'http://localhost:8000';
const MEDPLUM_BASE_URL = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103';
const AWS_REGION = process.env['AWS_REGION'] ?? 'us-east-1';

const DYNAMO_TABLE_PATIENTS  = process.env['DYNAMO_TABLE_PATIENTS']  ?? 'PatientProfiles';
const DYNAMO_TABLE_RULES     = process.env['DYNAMO_TABLE_RULES']     ?? 'ClinicalRules';
const DYNAMO_TABLE_RESULTS   = process.env['DYNAMO_TABLE_RESULTS']   ?? 'CallResults';
const DYNAMO_TABLE_PROTOCOLS = process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols';
const DYNAMO_TABLE_REVIEWS   = process.env['DYNAMO_TABLE_REVIEWS']   ?? 'ProtocolReview';

// ── DynamoDB client ──────────────────────────────────────────────────────────

const dynamoClient = new DynamoDBClient({
  endpoint:    DYNAMO_ENDPOINT,
  region:      AWS_REGION,
  credentials: {
    accessKeyId:     process.env['AWS_ACCESS_KEY_ID']     ?? 'local',
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'local',
  },
});

// ── Result tracking ──────────────────────────────────────────────────────────

let anyFailed = false;

function pass(label: string): void {
  console.log(`  [PASS] ${label}`);
}

function fail(label: string, reason: string): void {
  console.error(`  [FAIL] ${label} — ${reason}`);
  anyFailed = true;
}

// ── Check helpers ────────────────────────────────────────────────────────────

async function checkHttp(label: string, url: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      pass(label);
    } else {
      fail(label, `HTTP ${res.status}`);
    }
  } catch (err) {
    fail(label, String(err));
  }
}

async function checkTableExists(tableName: string): Promise<void> {
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
    pass(`Table: ${tableName} (exists)`);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'ResourceNotFoundException') {
      fail(`Table: ${tableName}`, 'table does not exist');
    } else {
      fail(`Table: ${tableName}`, String(err));
    }
  }
}

async function checkTableHasData(tableName: string): Promise<void> {
  try {
    const res = await dynamoClient.send(
      new DescribeTableCommand({ TableName: tableName }),
    );
    const count = res.Table?.ItemCount ?? 0;
    if (count > 0) {
      pass(`Table: ${tableName} (${count} items)`);
    } else {
      fail(`Table: ${tableName}`, 'table is empty — run morning-start first');
    }
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'ResourceNotFoundException') {
      fail(`Table: ${tableName}`, 'table does not exist');
    } else {
      fail(`Table: ${tableName}`, String(err));
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Aegis Health Check ===\n');

  // 1. Medplum
  await checkHttp(`Medplum (${MEDPLUM_BASE_URL})`, `${MEDPLUM_BASE_URL}/healthcheck`);

  // 2. DynamoDB — verify service is responding
  try {
    await dynamoClient.send(
      new DescribeTableCommand({ TableName: DYNAMO_TABLE_PATIENTS }),
    );
    pass(`DynamoDB (${DYNAMO_ENDPOINT})`);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'ResourceNotFoundException') {
      // DynamoDB is up, table just missing — still a pass for the service check
      pass(`DynamoDB (${DYNAMO_ENDPOINT})`);
    } else {
      fail(`DynamoDB (${DYNAMO_ENDPOINT})`, String(err));
    }
  }

  // 3. PatientProfiles — must exist and have data
  await checkTableHasData(DYNAMO_TABLE_PATIENTS);

  // 4. ClinicalRules — must exist and have data
  await checkTableHasData(DYNAMO_TABLE_RULES);

  // 5. Remaining tables — existence only
  await checkTableExists(DYNAMO_TABLE_RESULTS);
  await checkTableExists(DYNAMO_TABLE_PROTOCOLS);
  await checkTableExists(DYNAMO_TABLE_REVIEWS);

  // 6. Dashboard dev server
  await checkHttp('Dashboard (http://localhost:3000)', 'http://localhost:3000');

  console.log('');

  if (anyFailed) {
    console.error('=== Health check FAILED — see [FAIL] entries above ===\n');
    process.exit(1);
  } else {
    console.log('=== All systems operational ===\n');
  }
}

main().catch((err: unknown) => {
  console.error('[FATAL]', err);
  process.exit(1);
});
