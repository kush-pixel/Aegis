import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import type { MedplumClient } from '@medplum/core';
import { initiateCall } from '../handler';
import type { CallInitiatorEvent, CallInitiatorDeps } from '../handler';
import {
  getPatient,
  getPatientConditions,
  mapToPatientProfile,
  FhirNotFoundError,
} from '@aegis/fhir-client';
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
  generateCallId: jest.fn().mockReturnValue('CALL-test123'),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validProtocol = {
  protocol_id: 'proto-001',
  patient_id: 'patient-abc',
  questions: [],
  conditions: [],
  confidence_score: 0.9,
  created_at: '2026-03-27T00:00:00.000Z',
};

const mockProfile = {
  patient_id: 'patient-abc',
  name: 'John Doe',
  phone: '+15551234567',
  discharge_date: '2026-03-25',
  conditions: [],
  lace_score: 5,
  hospital_score: 3,
  composite_risk_score: 40,
  risk_level: 'MODERATE' as const,
};

const validEvent: CallInitiatorEvent = {
  patient_id: 'patient-abc',
  protocol_id: 'proto-001',
};

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeDeps(
  dynamoSend: jest.Mock,
  connectSend: jest.Mock,
): CallInitiatorDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    connect: { send: connectSend } as unknown as ConnectClient,
    fhir: {} as MedplumClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('initiateCall', () => {
  let dynamoSend: jest.Mock;
  let connectSend: jest.Mock;
  let deps: CallInitiatorDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    dynamoSend = jest.fn();
    connectSend = jest.fn();
    deps = makeDeps(dynamoSend, connectSend);

    // Default happy-path fhir mocks
    (getPatient as jest.Mock).mockResolvedValue({});
    (getPatientConditions as jest.Mock).mockResolvedValue([]);
    (mapToPatientProfile as jest.Mock).mockReturnValue(mockProfile);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns callId, contactId, patientId, protocolId on success', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    connectSend.mockResolvedValue({ ContactId: 'contact-abc', $metadata: {} });

    const result = await initiateCall(validEvent, deps);

    expect(result.callId).toBe('CALL-test123');
    expect(result.contactId).toBe('contact-abc');
    expect(result.patientId).toBe('patient-abc');
    expect(result.protocolId).toBe('proto-001');
  });

  it('writes a valid CallResult record to DynamoDB before dialing', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    connectSend.mockResolvedValue({ ContactId: 'contact-abc', $metadata: {} });

    await initiateCall(validEvent, deps);

    const putArg = dynamoSend.mock.calls[1][0];
    const item = putArg.input.Item;
    expect(item.call_id).toBe('CALL-test123');
    expect(item.patient_id).toBe('patient-abc');
    expect(item.triage_status).toBe('INCOMPLETE');
    expect(item.variables).toEqual({});
    expect(item.sdoh_responses).toEqual({
      medication_cost_barrier: false,
      transportation_barrier: false,
      z_codes: [],
    });
    expect(item.isbarr_summary).toBeUndefined();
    expect(typeof item.created_at).toBe('string');
  });

  it('passes correct attributes to StartOutboundVoiceContactCommand', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    connectSend.mockResolvedValue({ ContactId: 'contact-abc', $metadata: {} });

    await initiateCall(validEvent, deps);

    const connectArg = connectSend.mock.calls[0][0];
    expect(connectArg.input.DestinationPhoneNumber).toBe('+15551234567');
    expect(connectArg.input.Attributes).toEqual({
      callId: 'CALL-test123',
      patientId: 'patient-abc',
      protocolId: 'proto-001',
    });
  });

  it('emits call_result_created and call_initiated audit logs', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    connectSend.mockResolvedValue({ ContactId: 'contact-abc', $metadata: {} });

    await initiateCall(validEvent, deps);

    expect(auditLog).toHaveBeenCalledTimes(2);
    expect(auditLog).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ action: 'call_result_created', callId: 'CALL-test123' }),
    );
    expect(auditLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ action: 'call_initiated', callId: 'CALL-test123' }),
    );
  });

  it('audit logs contain no PHI — no phone or patient name', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    connectSend.mockResolvedValue({ ContactId: 'contact-abc', $metadata: {} });

    await initiateCall(validEvent, deps);

    const calls = (auditLog as jest.Mock).mock.calls as [{ detail?: string }][];
    for (const [ctx] of calls) {
      expect(ctx.detail).not.toContain('+15551234567');
      expect(ctx.detail).not.toContain('John Doe');
    }
  });

  // -------------------------------------------------------------------------
  // undefined ContactId branch
  // -------------------------------------------------------------------------

  it('returns undefined contactId when Connect omits ContactId', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    connectSend.mockResolvedValue({ $metadata: {} });

    const result = await initiateCall(validEvent, deps);

    expect(result.contactId).toBeUndefined();
    expect(auditLog).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ detail: 'Contact started: unknown' }),
    );
  });

  // -------------------------------------------------------------------------
  // Validation failures
  // -------------------------------------------------------------------------

  it('throws on blank patient_id', async () => {
    await expect(
      initiateCall({ patient_id: '   ', protocol_id: 'proto-001' }, deps),
    ).rejects.toThrow('Invalid patient_id: must be non-empty');

    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it('throws on empty string patient_id', async () => {
    await expect(
      initiateCall({ patient_id: '', protocol_id: 'proto-001' }, deps),
    ).rejects.toThrow('Invalid patient_id: must be non-empty');
  });

  // -------------------------------------------------------------------------
  // Protocol lookup failures
  // -------------------------------------------------------------------------

  it('throws when protocol is not found in DynamoDB', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: undefined });

    await expect(initiateCall(validEvent, deps)).rejects.toThrow(
      'Protocol not found: proto-001',
    );

    expect(getPatient).not.toHaveBeenCalled();
    expect(connectSend).not.toHaveBeenCalled();
  });

  it('throws when DynamoDB returns empty object (no Item key)', async () => {
    dynamoSend.mockResolvedValueOnce({});

    await expect(initiateCall(validEvent, deps)).rejects.toThrow(
      'Protocol not found: proto-001',
    );
  });

  it('propagates ZodError when protocol item fails schema validation', async () => {
    const malformedProtocol = { protocol_id: 'proto-001' };
    dynamoSend.mockResolvedValueOnce({ Item: malformedProtocol });

    await expect(initiateCall(validEvent, deps)).rejects.toThrow();
    expect(getPatient).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Protocol ownership mismatch
  // -------------------------------------------------------------------------

  it('throws when protocol.patient_id does not match event.patient_id', async () => {
    const mismatchedProtocol = { ...validProtocol, patient_id: 'patient-xyz' };
    dynamoSend.mockResolvedValueOnce({ Item: mismatchedProtocol });

    await expect(initiateCall(validEvent, deps)).rejects.toThrow(
      'Protocol proto-001 does not belong to patient patient-abc',
    );

    expect(getPatient).not.toHaveBeenCalled();
    expect(connectSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // FHIR failures
  // -------------------------------------------------------------------------

  it('propagates FhirNotFoundError when patient does not exist in FHIR', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: validProtocol });
    (getPatient as jest.Mock).mockRejectedValue(
      new FhirNotFoundError('Patient', 'patient-abc'),
    );

    await expect(initiateCall(validEvent, deps)).rejects.toThrow(
      'Patient with id patient-abc not found',
    );

    expect(connectSend).not.toHaveBeenCalled();
  });

  it('propagates error when getPatientConditions throws', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: validProtocol });
    (getPatient as jest.Mock).mockResolvedValue({});
    (getPatientConditions as jest.Mock).mockRejectedValue(new Error('FHIR timeout'));

    await expect(initiateCall(validEvent, deps)).rejects.toThrow('FHIR timeout');

    expect(connectSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Connect failure
  // -------------------------------------------------------------------------

  it('propagates Connect API error — DynamoDB Put already committed', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    connectSend.mockRejectedValue(new Error('Connect service unavailable'));

    await expect(initiateCall(validEvent, deps)).rejects.toThrow(
      'Connect service unavailable',
    );

    // PutCommand was already sent before Connect call
    expect(dynamoSend).toHaveBeenCalledTimes(2);
    // First audit log (call_result_created) was emitted before Connect
    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'call_result_created' }),
    );
  });
});
