/**
 * Full pipeline reset for demos.
 *
 * Steps:
 *   1. Verify Docker services (Medplum + DynamoDB)
 *   2. Ensure DynamoDB tables exist
 *   3. Seed PatientProfiles (P001–P006)
 *   4. Seed FHIR patients in Medplum
 *   5. Seed ClinicalRules
 *   6. Invoke care-planner Lambda for each patient (WARNING only if unavailable)
 *
 * Usage:
 *   npm run morning-start --workspace=scripts
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  type CreateTableCommandInput,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { InvokeCommand, LambdaClient } from '@aws-sdk/client-lambda';

// ── Environment ──────────────────────────────────────────────────────────────

const DYNAMO_ENDPOINT   = process.env['DYNAMO_ENDPOINT']   ?? 'http://localhost:8000';
const LOCALSTACK_ENDPOINT = process.env['LOCALSTACK_ENDPOINT'] ?? 'http://localhost:4566';
const MEDPLUM_BASE_URL  = process.env['MEDPLUM_BASE_URL']  ?? 'http://localhost:8103';
const AWS_REGION        = process.env['AWS_REGION']        ?? 'us-east-1';
const CARE_PLANNER_FN   = process.env['CARE_PLANNER_FUNCTION_NAME'] ?? 'aegis-care-planner';

const DYNAMO_TABLE_PATIENTS  = process.env['DYNAMO_TABLE_PATIENTS']  ?? 'PatientProfiles';
const DYNAMO_TABLE_RULES     = process.env['DYNAMO_TABLE_RULES']     ?? 'ClinicalRules';
const DYNAMO_TABLE_PROTOCOLS = process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols';
const DYNAMO_TABLE_RESULTS   = process.env['DYNAMO_TABLE_RESULTS']   ?? 'CallResults';
const DYNAMO_TABLE_REVIEWS   = process.env['DYNAMO_TABLE_REVIEWS']   ?? 'ProtocolReview';

// ── DynamoDB clients ─────────────────────────────────────────────────────────

const dynamoClient = new DynamoDBClient({
  endpoint:    DYNAMO_ENDPOINT,
  region:      AWS_REGION,
  credentials: {
    accessKeyId:     process.env['AWS_ACCESS_KEY_ID']     ?? 'local',
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'local',
  },
});

const docClient = DynamoDBDocumentClient.from(dynamoClient);

// ── Lambda client (LocalStack) ───────────────────────────────────────────────

const lambdaClient = new LambdaClient({
  endpoint:    LOCALSTACK_ENDPOINT,
  region:      AWS_REGION,
  credentials: {
    accessKeyId:     process.env['AWS_ACCESS_KEY_ID']     ?? 'local',
    secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'] ?? 'local',
  },
});

// ── Local FHIR types (no @medplum/fhirtypes dependency) ──────────────────────

interface FhirPatient {
  resourceType: 'Patient';
  id: string;
  name: Array<{ text: string }>;
  telecom: Array<{ system: string; value: string }>;
  extension: Array<Record<string, unknown>>;
}

interface FhirCondition {
  resourceType: 'Condition';
  clinicalStatus: object;
  code: object;
  subject: { reference: string };
}

// ── Demo patient data ────────────────────────────────────────────────────────

const TODAY = new Date();
const DISCHARGE_DATE = new Date(TODAY);
DISCHARGE_DATE.setDate(TODAY.getDate() - 2);
const DISCHARGE_ISO = DISCHARGE_DATE.toISOString().split('T')[0] as string;

interface DemoPatient {
  patient_id: string;
  name: string;
  phone: string;
  discharge_date: string;
  conditions: string[];
  lace_score: number;
  hospital_score: number;
  composite_risk_score: number;
  risk_level: 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
}

const DEMO_PATIENTS: DemoPatient[] = [
  {
    patient_id:          'P001',
    name:                'Maria Garcia',
    phone:               '+15550000001',
    discharge_date:      DISCHARGE_ISO,
    conditions:          ['I50.9'],
    lace_score:          14,
    hospital_score:      7,
    composite_risk_score: 66,
    risk_level:          'HIGH',
  },
  {
    patient_id:          'P002',
    name:                'James Wilson',
    phone:               '+15550000002',
    discharge_date:      DISCHARGE_ISO,
    conditions:          ['E11.9'],
    lace_score:          8,
    hospital_score:      5,
    composite_risk_score: 41,
    risk_level:          'MODERATE',
  },
  {
    patient_id:          'P003',
    name:                'Eleanor Patel',
    phone:               '+15550000003',
    discharge_date:      DISCHARGE_ISO,
    conditions:          ['J44.1', 'I50.9'],
    lace_score:          17,
    hospital_score:      10,
    composite_risk_score: 84,
    risk_level:          'VERY_HIGH',
  },
  {
    patient_id:          'P004',
    name:                'Robert Chen',
    phone:               '+15550000004',
    discharge_date:      DISCHARGE_ISO,
    conditions:          ['I10'],
    lace_score:          6,
    hospital_score:      3,
    composite_risk_score: 28,
    risk_level:          'LOW',
  },
  {
    patient_id:          'P005',
    name:                'Dorothy Kim',
    phone:               '+15550000005',
    discharge_date:      DISCHARGE_ISO,
    conditions:          ['I48.91'],
    lace_score:          15,
    hospital_score:      8,
    composite_risk_score: 72,
    risk_level:          'HIGH',
  },
  {
    patient_id:          'P006',
    name:                'Thomas Brown',
    phone:               '+15550000006',
    discharge_date:      DISCHARGE_ISO,
    conditions:          ['J18.9'],
    lace_score:          9,
    hospital_score:      5,
    composite_risk_score: 44,
    risk_level:          'MODERATE',
  },
];

// ── Clinical rules seed data ─────────────────────────────────────────────────

interface ClinicalRuleRecord {
  condition_code: string;
  version_id: string;
  rule_id: string;
  logic: 'AND' | 'OR' | 'WEIGHTED';
  conditions: Array<{
    variable_name: string;
    operator: 'eq' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains';
    value: string | number | boolean;
    weight?: number;
  }>;
  weighted_threshold?: number;
}

const CLINICAL_RULES: ClinicalRuleRecord[] = [
  {
    condition_code: 'I50.9',
    version_id:     'LATEST',
    rule_id:        'RULE-I50.9-v1',
    logic:          'AND',
    conditions:     [
      { variable_name: 'weight_gain_kg',      operator: 'gt', value: 2    },
      { variable_name: 'shortness_of_breath', operator: 'eq', value: true },
      { variable_name: 'ankle_swelling',      operator: 'eq', value: true },
    ],
  },
  {
    condition_code: 'E11.9',
    version_id:     'LATEST',
    rule_id:        'RULE-E11.9-v1',
    logic:          'AND',
    conditions:     [
      { variable_name: 'glucose_reading_high',  operator: 'eq', value: true  },
      { variable_name: 'medication_adherence',  operator: 'eq', value: false },
      { variable_name: 'diet_adherence',        operator: 'eq', value: false },
    ],
  },
  {
    condition_code: 'J44.1',
    version_id:     'LATEST',
    rule_id:        'RULE-J44.1-v1',
    logic:          'OR',
    conditions:     [
      { variable_name: 'peak_flow_below_50pct',    operator: 'eq', value: true },
      { variable_name: 'rescue_inhaler_uses_24h',  operator: 'gt', value: 2    },
      { variable_name: 'shortness_of_breath_rest', operator: 'eq', value: true },
    ],
  },
  {
    condition_code: 'I10',
    version_id:     'LATEST',
    rule_id:        'RULE-I10-v1',
    logic:          'AND',
    conditions:     [
      { variable_name: 'systolic_bp',       operator: 'gt', value: 180   },
      { variable_name: 'medication_taken',  operator: 'eq', value: false },
    ],
  },
  {
    condition_code:    'I48.91',
    version_id:        'LATEST',
    rule_id:           'RULE-I48.91-v1',
    logic:             'WEIGHTED',
    weighted_threshold: 0.3,
    conditions:        [
      { variable_name: 'palpitations',         operator: 'eq', value: true, weight: 0.4 },
      { variable_name: 'dizziness',            operator: 'eq', value: true, weight: 0.3 },
      { variable_name: 'anticoagulant_missed', operator: 'eq', value: true, weight: 0.3 },
    ],
  },
  {
    condition_code: 'J18.9',
    version_id:     'LATEST',
    rule_id:        'RULE-J18.9-v1',
    logic:          'AND',
    conditions:     [
      { variable_name: 'fever_above_38c',   operator: 'eq', value: true },
      { variable_name: 'increased_cough',   operator: 'eq', value: true },
      { variable_name: 'shortness_of_breath', operator: 'eq', value: true },
    ],
  },
];

// ── DynamoDB table definitions (mirrors create-local-tables.ts) ──────────────

const TABLES: CreateTableCommandInput[] = [
  {
    TableName:            'CallResults',
    BillingMode:          'PAY_PER_REQUEST',
    KeySchema:            [{ AttributeName: 'call_id', KeyType: 'HASH' }],
    AttributeDefinitions: [
      { AttributeName: 'call_id',             AttributeType: 'S' },
      { AttributeName: 'patient_id',          AttributeType: 'S' },
      { AttributeName: 'call_timestamp',      AttributeType: 'S' },
      { AttributeName: 'call_status',         AttributeType: 'S' },
      { AttributeName: 'triage_completed_at', AttributeType: 'S' },
      { AttributeName: 'created_at',          AttributeType: 'S' },
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function pass(label: string): void {
  console.log(`  [PASS] ${label}`);
}

function fail(label: string, reason: string): void {
  console.error(`  [FAIL] ${label}: ${reason}`);
}

function step(n: number, title: string): void {
  console.log(`\nStep ${n}: ${title}`);
}

// ── Step 1: Verify services ──────────────────────────────────────────────────

async function verifyServices(): Promise<void> {
  step(1, 'Verify Docker services');

  // Medplum
  try {
    const res = await fetch(`${MEDPLUM_BASE_URL}/healthcheck`);
    if (res.ok) {
      pass(`Medplum on ${MEDPLUM_BASE_URL}`);
    } else {
      fail(`Medplum on ${MEDPLUM_BASE_URL}`, `HTTP ${res.status}`);
      process.exit(1);
    }
  } catch (err) {
    fail(`Medplum on ${MEDPLUM_BASE_URL}`, String(err));
    process.exit(1);
  }

  // DynamoDB
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: 'PatientProfiles' }));
    pass(`DynamoDB on ${DYNAMO_ENDPOINT}`);
  } catch (err) {
    // ResourceNotFoundException is fine — means DynamoDB is responding
    const name = (err as { name?: string }).name;
    if (name === 'ResourceNotFoundException') {
      pass(`DynamoDB on ${DYNAMO_ENDPOINT}`);
    } else {
      fail(`DynamoDB on ${DYNAMO_ENDPOINT}`, String(err));
      process.exit(1);
    }
  }
}

// ── Step 2: Ensure tables ────────────────────────────────────────────────────

async function ensureTables(): Promise<void> {
  step(2, 'Ensure DynamoDB tables exist');

  for (const table of TABLES) {
    try {
      await dynamoClient.send(new CreateTableCommand(table));
      console.log(`  ✓ ${table.TableName}`);
    } catch (err) {
      if (err instanceof ResourceInUseException) {
        console.log(`  ~ ${table.TableName} (already exists)`);
      } else {
        throw err;
      }
    }
  }
}

// ── Step 3: Seed PatientProfiles ─────────────────────────────────────────────

async function seedPatientProfiles(): Promise<void> {
  step(3, 'Seed PatientProfiles');

  for (const patient of DEMO_PATIENTS) {
    await docClient.send(new PutCommand({
      TableName: DYNAMO_TABLE_PATIENTS,
      Item:      patient,
    }));
    console.log(`  ✓ ${patient.patient_id} — ${patient.name} (${patient.risk_level})`);
  }
}

// ── Step 4: Seed FHIR patients ───────────────────────────────────────────────

function buildFhirPatient(p: DemoPatient): FhirPatient {
  const EXT_BASE = 'https://aegis.health/fhir/extensions/';
  return {
    resourceType: 'Patient',
    id:           p.patient_id,
    name:         [{ text: p.name }],
    telecom:      [{ system: 'phone', value: p.phone }],
    extension:    [
      { url: `${EXT_BASE}discharge-date`,       valueString:  p.discharge_date       },
      { url: `${EXT_BASE}lace-score`,           valueInteger: p.lace_score           },
      { url: `${EXT_BASE}hospital-score`,       valueInteger: p.hospital_score       },
      { url: `${EXT_BASE}composite-risk-score`, valueDecimal: p.composite_risk_score },
      { url: `${EXT_BASE}risk-level`,           valueString:  p.risk_level           },
    ],
  };
}

function buildFhirCondition(patientId: string, conditionCode: string): FhirCondition {
  return {
    resourceType:   'Condition',
    clinicalStatus: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/condition-clinical', code: 'active' }],
    },
    code: {
      coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: conditionCode }],
    },
    subject: { reference: `Patient/${patientId}` },
  };
}

async function medplumLogin(): Promise<string> {
  const res = await fetch(`${MEDPLUM_BASE_URL}/auth/login`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      email:    'admin@example.com',
      password: 'medplum_admin',
      scope:    'openid',
      remember: true,
    }),
  });
  const data = await res.json() as { login?: string; code?: string; access_token?: string };
  if (data.access_token) return data.access_token;
  if (data.code) return data.code;
  throw new Error(`Medplum login failed: ${JSON.stringify(data)}`);
}

async function seedFhirPatients(): Promise<void> {
  step(4, 'Seed FHIR patients (Medplum)');

  let token: string;
  try {
    token = await medplumLogin();
  } catch (err) {
    console.warn(
      `  [WARNING] Medplum login failed — skipping FHIR seeding. care-planner Lambda will not work without FHIR data.\n  Reason: ${String(err)}`,
    );
    return;
  }

  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${token}`,
  };

  for (const patient of DEMO_PATIENTS) {
    // Upsert Patient (idempotent PUT)
    await fetch(`${MEDPLUM_BASE_URL}/fhir/R4/Patient/${patient.patient_id}`, {
      method:  'PUT',
      headers,
      body:    JSON.stringify(buildFhirPatient(patient)),
    });

    // Create Conditions (duplicates acceptable for demo resets)
    for (const code of patient.conditions) {
      await fetch(`${MEDPLUM_BASE_URL}/fhir/R4/Condition`, {
        method:  'POST',
        headers,
        body:    JSON.stringify(buildFhirCondition(patient.patient_id, code)),
      });
    }

    console.log(
      `  ✓ ${patient.patient_id} — Patient + ${patient.conditions.join(', ')} conditions`,
    );
  }
}

// ── Step 5: Seed ClinicalRules ───────────────────────────────────────────────

async function seedClinicalRules(): Promise<void> {
  step(5, 'Seed ClinicalRules');

  for (const rule of CLINICAL_RULES) {
    await docClient.send(new PutCommand({
      TableName: DYNAMO_TABLE_RULES,
      Item:      rule,
    }));
    console.log(`  ✓ ${rule.condition_code} (${rule.logic}) — ${rule.conditions.length} conditions`);
  }
}

// ── Step 6: Invoke care-planner Lambda ───────────────────────────────────────

async function invokeCarePlanner(): Promise<void> {
  step(6, 'Invoke care-planner Lambda');
  console.log(
    `  NOTE: This step requires the CDK stack deployed to LocalStack. Run cdk deploy to enable.`,
  );

  try {
    for (const patient of DEMO_PATIENTS) {
      const payload = Buffer.from(JSON.stringify({ patient_id: patient.patient_id }));
      const res = await lambdaClient.send(new InvokeCommand({
        FunctionName: CARE_PLANNER_FN,
        Payload:      payload,
      }));

      if (res.FunctionError) {
        const errBody = res.Payload ? Buffer.from(res.Payload).toString() : 'unknown';
        throw new Error(`Lambda error for ${patient.patient_id}: ${errBody}`);
      }

      const result = res.Payload
        ? (JSON.parse(Buffer.from(res.Payload).toString()) as { protocolId?: string })
        : {};

      console.log(
        `  ✓ ${patient.patient_id} — protocol_id: ${result.protocolId ?? '(none)'}`,
      );
    }
  } catch (err) {
    console.warn(`  [WARNING] care-planner invocation skipped: ${String(err)}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Aegis Morning Start — Demo Pipeline Reset ===');
  console.log(`  Dynamo:  ${DYNAMO_ENDPOINT}`);
  console.log(`  Medplum: ${MEDPLUM_BASE_URL}`);
  console.log(`  Lambda:  ${LOCALSTACK_ENDPOINT}`);

  await verifyServices();
  await ensureTables();
  await seedPatientProfiles();
  await seedFhirPatients();
  await seedClinicalRules();
  await invokeCarePlanner();

  console.log('\n=== Done. Demo environment is ready. ===\n');
}

main().catch((err: unknown) => {
  console.error('\n[FATAL]', err);
  process.exit(1);
});
