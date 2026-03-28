import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { MedplumClient } from '@medplum/core';
import { generateCarePlan } from '../handler';
import type { CarePlannerEvent, CarePlannerDeps } from '../handler';
import {
  getPatient,
  getPatientConditions,
  mapToPatientProfile,
  FhirNotFoundError,
} from '@aegis/fhir-client';
import { calcCompositeRisk } from '@aegis/risk-scorer';
import { generateProtocol } from '@aegis/bedrock-client';
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

jest.mock('@aegis/risk-scorer', () => ({
  calcCompositeRisk: jest.fn(),
}));

jest.mock('@aegis/bedrock-client', () => ({
  generateProtocol: jest.fn(),
}));

jest.mock('@aegis/validation', () => ({
  validatePatientId: jest.requireActual('@aegis/validation').validatePatientId,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validProfile = {
  patient_id: 'patient-abc',
  name: 'Jane Doe',
  phone: '+15559876543',
  lace_score: 8,
  hospital_score: 5,
  composite_risk_score: 62,
  risk_level: 'HIGH' as const,
  discharge_date: '2026-03-20',
  conditions: ['I50.9'],
};

const highConfidenceProtocol = {
  protocol_id: 'proto-high',
  patient_id: 'patient-abc',
  questions: [],
  conditions: [],
  confidence_score: 0.85,
  created_at: '2026-03-27T00:00:00.000Z',
};

const lowConfidenceProtocol = {
  protocol_id: 'proto-low',
  patient_id: 'patient-abc',
  questions: [],
  conditions: [],
  confidence_score: 0.60,
  created_at: '2026-03-27T00:00:00.000Z',
};

const mockCompositeRisk = {
  lace_score: 8,
  lace_risk_level: 'HIGH' as const,
  hospital_score: 5,
  hospital_risk_level: 'HIGH' as const,
  composite_score: 62,
  risk_level: 'HIGH' as const,
};

const validEvent: CarePlannerEvent = { patient_id: 'patient-abc' };

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeDeps(dynamoSend: jest.Mock): CarePlannerDeps {
  return {
    dynamo:   { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    bedrock:  {} as BedrockRuntimeClient,
    kbClient: {} as BedrockAgentRuntimeClient,
    fhir:     {} as MedplumClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateCarePlan', () => {
  let dynamoSend: jest.Mock;
  let deps: CarePlannerDeps;

  beforeEach(() => {
    jest.clearAllMocks();

    dynamoSend = jest.fn();
    deps = makeDeps(dynamoSend);

    // Default happy-path mocks
    (getPatient as jest.Mock).mockResolvedValue({});
    (getPatientConditions as jest.Mock).mockResolvedValue([]);
    (mapToPatientProfile as jest.Mock).mockReturnValue(validProfile);
    (calcCompositeRisk as jest.Mock).mockReturnValue(mockCompositeRisk);
  });

  // -------------------------------------------------------------------------
  // Happy path — high confidence, no review created
  // -------------------------------------------------------------------------

  it('returns patientId, protocolId, reviewCreated false when confidence >= 0.70', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);
    dynamoSend.mockResolvedValueOnce({});

    const result = await generateCarePlan(validEvent, deps);

    expect(result).toEqual({
      patientId: 'patient-abc',
      protocolId: 'proto-high',
      reviewCreated: false,
    });
  });

  it('calls dynamoSend exactly 1 time when confidence >= 0.70 (only protocol PutCommand)', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    expect(dynamoSend).toHaveBeenCalledTimes(1);
  });

  it('emits care_plan_generated audit log exactly once on happy path', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'care_plan_generated' }),
    );
  });

  // -------------------------------------------------------------------------
  // Protocol PutCommand writes the correct item
  // -------------------------------------------------------------------------

  it('writes protocol item with correct protocol_id and patient_id to DynamoDB', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    const putArg = dynamoSend.mock.calls[0][0];
    expect(putArg.input.Item.protocol_id).toBe('proto-high');
    expect(putArg.input.Item.patient_id).toBe('patient-abc');
  });

  // -------------------------------------------------------------------------
  // Happy path — low confidence, no existing review → review created
  // -------------------------------------------------------------------------

  it('returns reviewCreated true when confidence < 0.70 and no existing review', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})              // PutCommand — protocol
      .mockResolvedValueOnce({ Items: [] })   // QueryCommand — review check
      .mockResolvedValueOnce({});             // PutCommand — review

    const result = await generateCarePlan(validEvent, deps);

    expect(result.reviewCreated).toBe(true);
  });

  it('calls dynamoSend exactly 3 times when confidence < 0.70 and no existing review', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    expect(dynamoSend).toHaveBeenCalledTimes(3);
  });

  it('writes review item with PENDING status, correct patient_id and protocol_id', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    const reviewPutArg = dynamoSend.mock.calls[2][0];
    expect(reviewPutArg.input.Item.status).toBe('PENDING');
    expect(reviewPutArg.input.Item.patient_id).toBe('patient-abc');
    expect(reviewPutArg.input.Item.protocol_id).toBe('proto-low');
  });

  it('generates a valid UUID for review_id on new review item', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [] })
      .mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    const reviewPutArg = dynamoSend.mock.calls[2][0];
    expect(reviewPutArg.input.Item.review_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('creates a new review when QueryCommand returns response with no Items key (undefined fallback)', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})   // PutCommand — protocol
      .mockResolvedValueOnce({})   // QueryCommand — response omits Items key entirely
      .mockResolvedValueOnce({});  // PutCommand — review

    const result = await generateCarePlan(validEvent, deps);

    expect(result.reviewCreated).toBe(true);
    expect(dynamoSend).toHaveBeenCalledTimes(3);
  });

  // -------------------------------------------------------------------------
  // Idempotency — PENDING review already exists
  // -------------------------------------------------------------------------

  it('returns reviewCreated false when a PENDING review already exists', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [{ review_id: 'existing', status: 'PENDING' }] });

    const result = await generateCarePlan(validEvent, deps);

    expect(result.reviewCreated).toBe(false);
  });

  it('calls dynamoSend exactly 2 times when a PENDING review already exists', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [{ review_id: 'existing', status: 'PENDING' }] });

    await generateCarePlan(validEvent, deps);

    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Idempotency — APPROVED review already exists
  // -------------------------------------------------------------------------

  it('returns reviewCreated false when an APPROVED review already exists', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [{ review_id: 'r1', status: 'APPROVED' }] });

    const result = await generateCarePlan(validEvent, deps);

    expect(result.reviewCreated).toBe(false);
    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Idempotency — AUTO_APPROVED review already exists
  // -------------------------------------------------------------------------

  it('returns reviewCreated false when an AUTO_APPROVED review already exists', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(lowConfidenceProtocol);
    dynamoSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ Items: [{ review_id: 'r1', status: 'AUTO_APPROVED' }] });

    const result = await generateCarePlan(validEvent, deps);

    expect(result.reviewCreated).toBe(false);
    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  // -------------------------------------------------------------------------
  // Validation failures
  // -------------------------------------------------------------------------

  it('throws "Invalid patient_id: must be non-empty" when patient_id is empty string', async () => {
    await expect(
      generateCarePlan({ patient_id: '' }, deps),
    ).rejects.toThrow('Invalid patient_id: must be non-empty');

    expect(getPatient).not.toHaveBeenCalled();
    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it('throws "Invalid patient_id: must be non-empty" when patient_id is only whitespace', async () => {
    await expect(
      generateCarePlan({ patient_id: '   ' }, deps),
    ).rejects.toThrow('Invalid patient_id: must be non-empty');

    expect(getPatient).not.toHaveBeenCalled();
    expect(dynamoSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // FhirNotFoundError propagates
  // -------------------------------------------------------------------------

  it('propagates FhirNotFoundError when patient does not exist in FHIR', async () => {
    (getPatient as jest.Mock).mockRejectedValue(
      new FhirNotFoundError('Patient', 'patient-abc'),
    );

    await expect(generateCarePlan(validEvent, deps)).rejects.toThrow('patient-abc');

    expect(generateProtocol).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Bedrock generateProtocol error propagates
  // -------------------------------------------------------------------------

  it('propagates error when generateProtocol rejects', async () => {
    (generateProtocol as jest.Mock).mockRejectedValue(new Error('Bedrock throttled'));

    await expect(generateCarePlan(validEvent, deps)).rejects.toThrow('Bedrock throttled');

    expect(dynamoSend).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // calcCompositeRisk called with correct scores
  // -------------------------------------------------------------------------

  it('calls calcCompositeRisk with lace_score and hospital_score from profile', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    expect(calcCompositeRisk).toHaveBeenCalledWith({
      lace_score: 8,
      hospital_score: 5,
    });
  });

  // -------------------------------------------------------------------------
  // generateProtocol called with correct knowledge_base_id from env
  // -------------------------------------------------------------------------

  it('calls generateProtocol with knowledge_base_id from BEDROCK_KNOWLEDGE_BASE_ID env var', async () => {
    const originalKbId = process.env['BEDROCK_KNOWLEDGE_BASE_ID'];
    process.env['BEDROCK_KNOWLEDGE_BASE_ID'] = 'kb-test-123';

    // Re-import the module so the module-level constant picks up the new env value
    jest.resetModules();

    // Re-apply mocks after resetModules
    jest.mock('@aegis/fhir-client', () => ({
      getPatient: jest.fn().mockResolvedValue({}),
      getPatientConditions: jest.fn().mockResolvedValue([]),
      mapToPatientProfile: jest.fn().mockReturnValue(validProfile),
      FhirNotFoundError: class FhirNotFoundError extends Error {
        constructor(resourceType: string, id: string) {
          super(`${resourceType} with id ${id} not found`);
          this.name = 'FhirNotFoundError';
        }
      },
    }));
    jest.mock('@aegis/audit', () => ({ auditLog: jest.fn() }));
    jest.mock('@aegis/risk-scorer', () => ({
      calcCompositeRisk: jest.fn().mockReturnValue(mockCompositeRisk),
    }));
    jest.mock('@aegis/bedrock-client', () => ({
      generateProtocol: jest.fn().mockResolvedValue(highConfidenceProtocol),
    }));
    jest.mock('@aegis/validation', () => ({
      validatePatientId: jest.requireActual('@aegis/validation').validatePatientId,
    }));

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { generateCarePlan: freshGenerateCarePlan } = require('../handler') as typeof import('../handler');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const freshGenerateProtocol = (require('@aegis/bedrock-client') as typeof import('@aegis/bedrock-client')).generateProtocol as jest.Mock;

    const freshDynamoSend = jest.fn().mockResolvedValueOnce({});
    const freshDeps = makeDeps(freshDynamoSend);

    await freshGenerateCarePlan(validEvent, freshDeps);

    expect(freshGenerateProtocol).toHaveBeenCalledWith(
      freshDeps.bedrock,
      freshDeps.kbClient,
      expect.objectContaining({ knowledge_base_id: 'kb-test-123' }),
    );

    // Restore env
    if (originalKbId === undefined) {
      delete process.env['BEDROCK_KNOWLEDGE_BASE_ID'];
    } else {
      process.env['BEDROCK_KNOWLEDGE_BASE_ID'] = originalKbId;
    }
  });

  // -------------------------------------------------------------------------
  // Audit log contains no PHI
  // -------------------------------------------------------------------------

  it('audit log detail does not contain patient name or phone number', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    const calls = (auditLog as jest.Mock).mock.calls as [{ detail?: string }][];
    for (const [ctx] of calls) {
      expect(ctx.detail).not.toContain('Jane Doe');
      expect(ctx.detail).not.toContain('+15559876543');
    }
  });
});
