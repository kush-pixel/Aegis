import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import { sendSmsFallback } from '../handler';
import type { SmsFallbackDeps } from '../handler';
import { auditLog } from '@aegis/audit';

jest.mock('@aegis/audit', () => ({ auditLog: jest.fn() }));

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const dynamoSend = jest.fn();
const fetchMock  = jest.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns an ISO timestamp that is `hoursAgo` hours in the past */
function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** A FAILED CallResult with sms_sent=true, created 5 h ago */
function makeFailedRecord(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    call_id:    'CALL-fail-001',
    patient_id: 'PAT-high-001',
    call_status: 'FAILED',
    sms_sent: true,
    created_at: hoursAgo(5),
    ...overrides,
  };
}

const highRiskPatient = {
  patient_id:            'PAT-high-001',
  name:                  'High Risk Patient',
  phone:                 '+15559990000',
  lace_score:            12,
  hospital_score:        8,
  composite_risk_score:  70,
  risk_level:            'HIGH' as const,
  discharge_date:        '2026-03-23',
  conditions:            ['CHF'],
};

const lowRiskPatient = {
  ...highRiskPatient,
  patient_id:           'PAT-low-001',
  composite_risk_score: 20,
  risk_level:           'LOW' as const,
};

function makeDeps(overrides: Partial<SmsFallbackDeps> = {}): SmsFallbackDeps {
  return {
    dynamo:   { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    connect:  { send: jest.fn() }  as unknown as ConnectClient,
    resultsTable:             'CallResults',
    protocolsTable:           'TriageProtocols',
    connectInstanceId:        'test-instance',
    connectContactFlowId:     'test-flow',
    connectSourcePhoneNumber: '+15550000000',
    patientsTable:    'PatientProfiles',
    appsyncEndpoint:  'https://appsync.example.com/graphql',
    appsyncApiKey:    'test-api-key',
    fetchFn:          fetchMock as unknown as SmsFallbackDeps['fetchFn'],
    ...overrides,
  };
}

const scheduledEvent = { source: 'aws.events', 'detail-type': 'Scheduled Event' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendSmsFallback — unreachable patient escalation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true });
  });

  // -------------------------------------------------------------------------
  // HIGH risk, sms_sent=true, older than 4 h → AppSync alert fired
  // -------------------------------------------------------------------------

  it('fires AppSync alert for HIGH risk patient with sms_sent=true older than 4 h', async () => {
    dynamoSend
      // First QueryCommand — INCOMPLETE records (main SMS pass, empty)
      .mockResolvedValueOnce({ Items: [] })
      // Second QueryCommand — FAILED records (escalation pass)
      .mockResolvedValueOnce({ Items: [makeFailedRecord()] })
      // GetCommand — PatientProfile
      .mockResolvedValueOnce({ Item: highRiskPatient });

    await sendSmsFallback(scheduledEvent, makeDeps());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://appsync.example.com/graphql');
    const body = JSON.parse(init.body as string) as {
      variables: { callId: string; patientId: string; riskLevel: string };
    };
    expect(body.variables.callId).toBe('CALL-fail-001');
    expect(body.variables.patientId).toBe('PAT-high-001');
    expect(body.variables.riskLevel).toBe('HIGH');
  });

  // -------------------------------------------------------------------------
  // LOW risk → no alert
  // -------------------------------------------------------------------------

  it('does not fire AppSync alert for LOW risk patient', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({
        Items: [makeFailedRecord({ patient_id: 'PAT-low-001', call_id: 'CALL-fail-002' })],
      })
      .mockResolvedValueOnce({ Item: lowRiskPatient });

    await sendSmsFallback(scheduledEvent, makeDeps());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Patient newer than 4 h → no alert
  // -------------------------------------------------------------------------

  it('does not fire AppSync alert when call was created less than 4 h ago', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({
        Items: [makeFailedRecord({ created_at: hoursAgo(1) })],
      });
    // No GetCommand expected since client-side filter removes the record

    await sendSmsFallback(scheduledEvent, makeDeps());

    expect(fetchMock).not.toHaveBeenCalled();
    // dynamoSend called only twice (INCOMPLETE query + FAILED query), no GetCommand
    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // FAILED query returns undefined Items → no alert, no throw
  // -------------------------------------------------------------------------

  it('handles undefined Items from FAILED query gracefully', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({}); // No Items field on FAILED query response

    await expect(sendSmsFallback(scheduledEvent, makeDeps())).resolves.toEqual({
      processed: 0,
      errors: 0,
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // PatientProfile not found → logs warning, does not throw, continues
  // -------------------------------------------------------------------------

  it('logs warning when PatientProfile is not found and does not throw', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [makeFailedRecord()] })
      .mockResolvedValueOnce({}); // No Item — patient not found

    await expect(sendSmsFallback(scheduledEvent, makeDeps())).resolves.toEqual({
      processed: 0,
      errors: 0,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    const auditCalls = (auditLog as jest.Mock).mock.calls as Array<[{ action: string }]>;
    const warningCall = auditCalls.find(([args]) => args.action === 'unreachable_alert_failed');
    expect(warningCall).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // AppSync failure → logs warning, does not throw, continues
  // -------------------------------------------------------------------------

  it('logs warning when AppSync returns HTTP 500 and does not throw', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 });

    dynamoSend
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({ Items: [makeFailedRecord()] })
      .mockResolvedValueOnce({ Item: highRiskPatient });

    await expect(sendSmsFallback(scheduledEvent, makeDeps())).resolves.toEqual({
      processed: 0,
      errors: 0,
    });

    const auditCalls = (auditLog as jest.Mock).mock.calls as Array<[{ action: string }]>;
    const warningCall = auditCalls.find(([args]) => args.action === 'unreachable_alert_failed');
    expect(warningCall).toBeDefined();
  });
});
