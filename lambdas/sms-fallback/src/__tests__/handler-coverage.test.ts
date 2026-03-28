/**
 * Supplemental coverage tests for sms-fallback handler.
 * Covers branches not reached by handler.test.ts.
 */
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import { sendSmsFallback } from '../handler';
import type { SmsFallbackDeps } from '../handler';

jest.mock('@aegis/audit', () => ({ auditLog: jest.fn() }));

const dynamoSend = jest.fn();
const connectSend = jest.fn();

function makeDeps(): SmsFallbackDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    connect: { send: connectSend } as unknown as ConnectClient,
    resultsTable: 'CallResults',
    protocolsTable: 'TriageProtocols',
    connectInstanceId: 'test-instance',
    connectContactFlowId: 'test-flow',
    connectSourcePhoneNumber: '+15550000000',
  };
}

const oldRecord = {
  call_id: 'CALL-old001',
  patient_id: 'PAT-001',
  patient_phone: '+15551234567',
  variables: {},
  sdoh_responses: { medication_cost_barrier: false, transportation_barrier: false, z_codes: [] },
  triage_status: 'INCOMPLETE',
  call_status: 'INCOMPLETE',
  // no sms_protocol_id — triggers patient_id-index fallback
  created_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
};

const scheduledEvent = { source: 'aws.events', 'detail-type': 'Scheduled Event' };

beforeEach(() => {
  jest.clearAllMocks();
});

describe('sendSmsFallback — protocol fallback path (no sms_protocol_id)', () => {
  it('counts error when patient_id-index QueryCommand returns no Items key (undefined Items)', async () => {
    // GSI returns the old record
    dynamoSend.mockResolvedValueOnce({ Items: [oldRecord] });
    // patient_id-index QueryCommand returns {} with no Items key → ?? [] → [0] is undefined → throws
    dynamoSend.mockResolvedValueOnce({});

    const result = await sendSmsFallback(scheduledEvent, makeDeps());

    expect(result).toEqual({ processed: 0, errors: 1 });
  });
});
