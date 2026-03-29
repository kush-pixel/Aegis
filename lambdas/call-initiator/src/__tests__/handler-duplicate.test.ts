import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import type { MedplumClient } from '@medplum/core';
import { initiateCall } from '../handler';
import type { CallInitiatorEvent, CallInitiatorDeps } from '../handler';
import { getPatient, getPatientConditions, mapToPatientProfile } from '@aegis/fhir-client';
import { auditLog } from '@aegis/audit';

jest.mock('@aegis/fhir-client', () => ({
  getPatient: jest.fn(),
  getPatientConditions: jest.fn(),
  mapToPatientProfile: jest.fn(),
  FhirNotFoundError: class FhirNotFoundError extends Error {
    constructor(resourceType: string, id: string) {
      super(`${resourceType} with id ${id} not found`);
      this.name = 'FhirNotFoundError';
    }
  },
}));

jest.mock('@aegis/audit', () => ({
  auditLog: jest.fn(),
}));

jest.mock('@aegis/validation', () => ({
  validatePatientId: jest.requireActual('@aegis/validation').validatePatientId,
  generateCallId: jest.fn().mockReturnValue('CALL-dup999'),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validProtocol = {
  protocol_id:      'proto-001',
  patient_id:       'patient-abc',
  questions:        [],
  conditions:       [],
  confidence_score: 0.9,
  created_at:       '2026-03-27T00:00:00.000Z',
};

const mockProfile = {
  patient_id:           'patient-abc',
  name:                 'John Doe',
  phone:                '+15551234567',
  discharge_date:       '2026-03-25',
  conditions:           [],
  lace_score:           5,
  hospital_score:       3,
  composite_risk_score: 40,
  risk_level:           'MODERATE' as const,
};

const validEvent: CallInitiatorEvent = {
  patient_id:  'patient-abc',
  protocol_id: 'proto-001',
};

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeDeps(dynamoSend: jest.Mock, connectSend: jest.Mock): CallInitiatorDeps {
  return {
    dynamo:   { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    connect:  { send: connectSend } as unknown as ConnectClient,
    fhir:     {} as MedplumClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initiateCall — duplicate active call prevention', () => {
  let dynamoSend: jest.Mock;
  let connectSend: jest.Mock;
  let deps: CallInitiatorDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    dynamoSend  = jest.fn();
    connectSend = jest.fn();
    deps        = makeDeps(dynamoSend, connectSend);

    (getPatient as jest.Mock).mockResolvedValue({});
    (getPatientConditions as jest.Mock).mockResolvedValue([]);
    (mapToPatientProfile as jest.Mock).mockReturnValue(mockProfile);
  });

  // -------------------------------------------------------------------------
  // Blocked scenarios
  // -------------------------------------------------------------------------

  it('throws when an existing call has triage_status INCOMPLETE', async () => {
    const existingActiveCall = {
      call_id:        'CALL-existing',
      patient_id:     'patient-abc',
      triage_status:  'INCOMPLETE',
      call_timestamp: '2026-03-27T10:00:00.000Z',
    };

    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })          // GetCommand: protocol
      .mockResolvedValueOnce({ Items: [existingActiveCall] }); // QueryCommand: duplicate found

    await expect(initiateCall(validEvent, deps)).rejects.toThrow(
      'Active call already exists for patient patient-abc. Complete or cancel it before placing a new call.',
    );
  });

  it('does not create a CallResult PutCommand when duplicate found', async () => {
    const existingActiveCall = {
      call_id:        'CALL-existing',
      patient_id:     'patient-abc',
      triage_status:  'INCOMPLETE',
      call_timestamp: '2026-03-27T10:00:00.000Z',
    };

    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({ Items: [existingActiveCall] });

    await expect(initiateCall(validEvent, deps)).rejects.toThrow();

    // Only 2 DynamoDB calls: GetCommand + QueryCommand — no PutCommand
    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  it('does not call Connect when duplicate found', async () => {
    const existingActiveCall = {
      call_id:        'CALL-existing',
      patient_id:     'patient-abc',
      triage_status:  'INCOMPLETE',
      call_timestamp: '2026-03-27T10:00:00.000Z',
    };

    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({ Items: [existingActiveCall] });

    await expect(initiateCall(validEvent, deps)).rejects.toThrow();

    expect(connectSend).not.toHaveBeenCalled();
  });

  it('throws when an existing call has call_status IN_PROGRESS', async () => {
    const inProgressCall = {
      call_id:        'CALL-inprogress',
      patient_id:     'patient-abc',
      triage_status:  'GREEN',
      call_status:    'IN_PROGRESS',
      call_timestamp: '2026-03-27T10:00:00.000Z',
    };

    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({ Items: [inProgressCall] });

    await expect(initiateCall(validEvent, deps)).rejects.toThrow(
      'Active call already exists for patient patient-abc. Complete or cancel it before placing a new call.',
    );

    expect(connectSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Proceed scenarios
  // -------------------------------------------------------------------------

  it('proceeds normally when no existing calls exist (empty query result)', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })    // GetCommand: protocol
      .mockResolvedValueOnce({ Items: [] })              // QueryCommand: no active calls
      .mockResolvedValueOnce({});                        // PutCommand: CallResult
    connectSend.mockResolvedValue({ ContactId: 'contact-new', $metadata: {} });

    const result = await initiateCall(validEvent, deps);

    expect(result.callId).toBe('CALL-dup999');
    expect(connectSend).toHaveBeenCalledTimes(1);
  });

  it('proceeds normally when query returns undefined Items (table empty)', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })    // GetCommand: protocol
      .mockResolvedValueOnce({})                         // QueryCommand: no Items key
      .mockResolvedValueOnce({});                        // PutCommand: CallResult
    connectSend.mockResolvedValue({ ContactId: 'contact-new', $metadata: {} });

    const result = await initiateCall(validEvent, deps);

    expect(result.callId).toBe('CALL-dup999');
    expect(connectSend).toHaveBeenCalledTimes(1);
  });

  it('proceeds normally when existing call is COMPLETE', async () => {
    const completedCall = {
      call_id:        'CALL-done',
      patient_id:     'patient-abc',
      triage_status:  'GREEN',
      call_status:    'COMPLETE',
      call_timestamp: '2026-03-26T09:00:00.000Z',
    };

    // The FilterExpression only matches INCOMPLETE/IN_PROGRESS, so COMPLETE calls are not returned
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })    // GetCommand: protocol
      .mockResolvedValueOnce({ Items: [] })              // QueryCommand: COMPLETE call filtered out
      .mockResolvedValueOnce({});                        // PutCommand: CallResult
    connectSend.mockResolvedValue({ ContactId: 'contact-new', $metadata: {} });

    // Suppress unused variable warning — the completedCall fixture documents intent
    void completedCall;

    const result = await initiateCall(validEvent, deps);

    expect(result.callId).toBe('CALL-dup999');
    expect(connectSend).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Initial record fields
  // -------------------------------------------------------------------------

  it('creates initial CallResult with call_status IN_PROGRESS and call_timestamp set', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});
    connectSend.mockResolvedValue({ ContactId: 'contact-new', $metadata: {} });

    await initiateCall(validEvent, deps);

    const putArg = dynamoSend.mock.calls[2][0];
    const item   = putArg.input.Item;
    expect(item.call_status).toBe('IN_PROGRESS');
    expect(typeof item.call_timestamp).toBe('string');
    expect(item.triage_status).toBe('INCOMPLETE');
  });
});
