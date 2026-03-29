import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { MedplumClient } from '@medplum/core';
import { summarizeCall } from '../handler';
import type { SummarizerEvent, SummarizerDeps } from '../handler';
import type { Isbarr } from '@aegis/schemas';
import {
  getPatient,
  getPatientConditions,
  mapToPatientProfile,
  FhirNotFoundError,
} from '@aegis/fhir-client';
import { generateSummary } from '@aegis/bedrock-client';
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

jest.mock('@aegis/bedrock-client', () => ({
  generateSummary: jest.fn(),
}));

jest.mock('@aegis/audit', () => ({
  auditLog: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCallResult = {
  call_id: 'call-001',
  patient_id: 'patient-abc',
  variables: {
    chest_pain: {
      value: 'yes',
      confidence: 0.9,
      raw_transcript: 'Patient said yes to chest pain',
    },
  },
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  },
  triage_status: 'RED' as const,
  created_at: '2026-03-27T00:00:00.000Z',
};

const validProtocol = {
  protocol_id: 'proto-001',
  patient_id: 'patient-abc',
  questions: [],
  conditions: [],
  confidence_score: 0.85,
  created_at: '2026-03-27T00:00:00.000Z',
};

const validProfile = {
  patient_id: 'patient-abc',
  name: 'John Doe',
  phone: '+15551234567',
  lace_score: 5,
  hospital_score: 3,
  composite_risk_score: 40,
  risk_level: 'MODERATE' as const,
  discharge_date: '2026-03-25',
  conditions: ['I50.9'],
};

const cleanSummary: Isbarr = {
  identify: 'Patient is John Doe, discharged 2026-03-25.',
  situation: 'Post-discharge triage call completed for heart failure monitoring.',
  background: 'Patient was recently discharged and screened via automated voice triage.',
  assessment: 'Patient reported chest pain. Follow-up required.',
  recommendation: 'Schedule urgent cardiology follow-up within 24 hours.',
  read_back: 'Summary reviewed and confirmed by clinical team.',
};

const badSummary: Isbarr = {
  identify: 'Patient is John Doe, discharged 2026-03-25.',
  situation: 'Post-discharge triage call completed for heart failure monitoring.',
  background: 'Patient was recently discharged and screened via automated voice triage.',
  assessment: 'chest_pain_score >= 3 means urgent referral needed',
  recommendation: 'Schedule urgent cardiology follow-up within 24 hours.',
  read_back: 'Summary reviewed and confirmed by clinical team.',
};

const validEvent: SummarizerEvent = { call_id: 'call-001', protocol_id: 'proto-001' };

// ---------------------------------------------------------------------------
// Deps factory
// ---------------------------------------------------------------------------

function makeDeps(dynamoSend: jest.Mock): SummarizerDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    bedrock: {} as BedrockRuntimeClient,
    fhir: {} as MedplumClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('summarizeCall', () => {
  let dynamoSend: jest.Mock;
  let deps: SummarizerDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    dynamoSend = jest.fn();
    deps = makeDeps(dynamoSend);

    // Default happy-path fhir mocks
    (getPatient as jest.Mock).mockResolvedValue({});
    (getPatientConditions as jest.Mock).mockResolvedValue([]);
    (mapToPatientProfile as jest.Mock).mockReturnValue(validProfile);
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  it('returns { callId, summaryGenerated: true, regenerated: false } on first-attempt success', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

    const result = await summarizeCall(validEvent, deps);

    expect(result).toEqual({ callId: 'call-001', summaryGenerated: true, regenerated: false });
  });

  it('calls generateSummary exactly once on first-attempt success', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

    await summarizeCall(validEvent, deps);

    expect(generateSummary).toHaveBeenCalledTimes(1);
  });

  it('calls dynamoSend exactly 3 times on happy path', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

    await summarizeCall(validEvent, deps);

    expect(dynamoSend).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Regeneration path
  // -------------------------------------------------------------------------

  it('returns regenerated: true when first summary fails validation but second succeeds', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock)
      .mockResolvedValueOnce(badSummary)
      .mockResolvedValueOnce(cleanSummary);

    const result = await summarizeCall(validEvent, deps);

    expect(result.regenerated).toBe(true);
  });

  it('calls generateSummary exactly 2 times when first attempt fails validation', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock)
      .mockResolvedValueOnce(badSummary)
      .mockResolvedValueOnce(cleanSummary);

    await summarizeCall(validEvent, deps);

    expect(generateSummary).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Both attempts fail
  // -------------------------------------------------------------------------

  it('throws when both summary attempts fail content validation', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    (generateSummary as jest.Mock).mockResolvedValue(badSummary);

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'Generated summary failed content validation after two attempts',
    );
  });

  // -------------------------------------------------------------------------
  // Content validation — individual pattern tests
  // -------------------------------------------------------------------------

  it('fails validation when assessment contains == operator', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    const summaryWithEquals: Isbarr = { ...cleanSummary, assessment: 'score == 3' };
    (generateSummary as jest.Mock).mockResolvedValue(summaryWithEquals);

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'Generated summary failed content validation after two attempts',
    );
  });

  it('fails validation when situation contains >= operator', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    const summaryWithGte: Isbarr = { ...cleanSummary, situation: 'bp >= 140' };
    (generateSummary as jest.Mock).mockResolvedValue(summaryWithGte);

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'Generated summary failed content validation after two attempts',
    );
  });

  it('fails validation when background contains snake_case word', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    const summaryWithSnake: Isbarr = { ...cleanSummary, background: 'patient_weight increased' };
    (generateSummary as jest.Mock).mockResolvedValue(summaryWithSnake);

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'Generated summary failed content validation after two attempts',
    );
  });

  it('fails validation when recommendation contains [placeholder] pattern', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    const summaryWithPlaceholder: Isbarr = {
      ...cleanSummary,
      recommendation: '[INSERT NAME] should follow up',
    };
    (generateSummary as jest.Mock).mockResolvedValue(summaryWithPlaceholder);

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'Generated summary failed content validation after two attempts',
    );
  });

  it('fails validation when identify contains TODO (case-insensitive)', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    const summaryWithTodo: Isbarr = {
      ...cleanSummary,
      identify: 'TODO: fill in patient name',
    };
    (generateSummary as jest.Mock).mockResolvedValue(summaryWithTodo);

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'Generated summary failed content validation after two attempts',
    );
  });

  it('fails validation when read_back contains {variable} placeholder pattern', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    const summaryWithCurly: Isbarr = {
      ...cleanSummary,
      read_back: 'Call {doctor_name} immediately',
    };
    (generateSummary as jest.Mock).mockResolvedValue(summaryWithCurly);

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'Generated summary failed content validation after two attempts',
    );
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  it('throws on empty string call_id without calling DynamoDB', async () => {
    await expect(
      summarizeCall({ call_id: '', protocol_id: 'proto-001' }, deps),
    ).rejects.toThrow('Invalid call_id: must be non-empty');

    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it('throws on whitespace-only call_id', async () => {
    await expect(
      summarizeCall({ call_id: '   ', protocol_id: 'proto-001' }, deps),
    ).rejects.toThrow('Invalid call_id: must be non-empty');

    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it('throws on empty string protocol_id without calling DynamoDB', async () => {
    await expect(
      summarizeCall({ call_id: 'call-001', protocol_id: '' }, deps),
    ).rejects.toThrow('Invalid protocol_id: must be non-empty');

    expect(dynamoSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // DynamoDB lookup failures
  // -------------------------------------------------------------------------

  it('throws when CallResult is not found in DynamoDB', async () => {
    dynamoSend.mockResolvedValueOnce({});

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'CallResult not found: call-001',
    );
  });

  it('throws when TriageProtocol is not found in DynamoDB', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({});

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'TriageProtocol not found: proto-001',
    );
  });

  // -------------------------------------------------------------------------
  // Protocol ownership mismatch
  // -------------------------------------------------------------------------

  it('throws when protocol patient_id does not match callResult patient_id', async () => {
    const mismatchedProtocol = { ...validProtocol, patient_id: 'patient-xyz' };
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: mismatchedProtocol });

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow(
      'does not belong to patient',
    );
  });

  // -------------------------------------------------------------------------
  // UpdateCommand inspection
  // -------------------------------------------------------------------------

  it('writes correct key, UpdateExpression, and ExpressionAttributeValues to DynamoDB', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

    await summarizeCall(validEvent, deps);

    const updateCall = dynamoSend.mock.calls[2][0];
    expect(updateCall.input.Key.call_id).toBe('call-001');
    expect(updateCall.input.UpdateExpression).toContain('SET isbarr_summary');
    expect(updateCall.input.ExpressionAttributeValues[':summary']).toEqual(cleanSummary);
  });

  // -------------------------------------------------------------------------
  // Transcript building
  // -------------------------------------------------------------------------

  it('builds transcript from raw_transcript fields in variables', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

    await summarizeCall(validEvent, deps);

    expect(generateSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transcript: 'Patient said yes to chest pain' }),
    );
  });

  it('falls back to "No transcript available" when variables is empty', async () => {
    const callResultNoVars = { ...validCallResult, variables: {} };
    dynamoSend
      .mockResolvedValueOnce({ Item: callResultNoVars })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

    await summarizeCall(validEvent, deps);

    expect(generateSummary).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ transcript: 'No transcript available' }),
    );
  });

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  it('emits auditLog exactly once with action summary_generated and no PHI', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

    await summarizeCall(validEvent, deps);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'summary_generated' }),
    );

    const [auditArg] = (auditLog as jest.Mock).mock.calls[0] as [{ detail?: string }];
    expect(auditArg.detail).not.toContain('John Doe');
    expect(auditArg.detail).not.toContain('+15551234567');
  });

  // -------------------------------------------------------------------------
  // FHIR error propagation
  // -------------------------------------------------------------------------

  it('propagates FHIR error after DynamoDB reads succeed', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: validProtocol });
    (getPatient as jest.Mock).mockRejectedValue(new Error('FHIR service unavailable'));

    await expect(summarizeCall(validEvent, deps)).rejects.toThrow('FHIR service unavailable');
  });
});
