import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { MedplumClient } from '@medplum/core';
import { generateCarePlan } from '../handler';
import type { CarePlannerEvent, CarePlannerDeps } from '../handler';
import { getPatient, getPatientConditions, mapToPatientProfile } from '@aegis/fhir-client';
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

jest.mock('@aegis/risk-scorer', () => ({
  calcCompositeRisk: jest.fn(),
}));

jest.mock('@aegis/bedrock-client', () => ({
  generateProtocol: jest.fn(),
}));

jest.mock('@aegis/audit', () => ({
  auditLog: jest.fn(),
}));

jest.mock('@aegis/validation', () => ({
  validatePatientId: jest.requireActual('@aegis/validation').validatePatientId,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validProfile = {
  patient_id:           'patient-abc',
  name:                 'Jane Smith',
  phone:                '+15559876543',
  discharge_date:       '2026-03-25',
  conditions:           ['J18.9', 'I10'],
  lace_score:           8,
  hospital_score:       5,
  composite_risk_score: 60,
  risk_level:           'HIGH' as const,
};

const profileNoConditions = {
  ...validProfile,
  conditions: [],
};

const profileOneCondition = {
  ...validProfile,
  conditions: ['J18.9'],
};

const highConfidenceProtocol = {
  protocol_id:      'proto-001',
  patient_id:       'patient-abc',
  questions:        [],
  conditions:       [],
  confidence_score: 0.95,
  created_at:       '2026-03-27T00:00:00.000Z',
};

const mockCompositeRisk = {
  lace_score:           8,
  hospital_score:       5,
  composite_risk_score: 60,
  risk_level:           'HIGH' as const,
};

const validEvent: CarePlannerEvent = { patient_id: 'patient-abc' };

// ---------------------------------------------------------------------------
// Mock deps factory
// rulesCheckSend is a SEPARATE mock so it can be controlled independently
// from the main dynamoSend (protocol Put, review Query/Put).
// ---------------------------------------------------------------------------

function makeDeps(dynamoSend: jest.Mock, rulesCheckSend: jest.Mock): CarePlannerDeps {
  return {
    dynamo:           { send: dynamoSend }           as unknown as DynamoDBDocumentClient,
    rulesCheckDynamo: { send: rulesCheckSend }        as unknown as DynamoDBDocumentClient,
    bedrock:          {} as BedrockRuntimeClient,
    kbClient:         {} as BedrockAgentRuntimeClient,
    fhir:             {} as MedplumClient,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('generateCarePlan — no clinical rules', () => {
  let dynamoSend: jest.Mock;
  let rulesCheckSend: jest.Mock;
  let deps: CarePlannerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    dynamoSend     = jest.fn();
    rulesCheckSend = jest.fn();
    deps           = makeDeps(dynamoSend, rulesCheckSend);

    (getPatient as jest.Mock).mockResolvedValue({});
    (getPatientConditions as jest.Mock).mockResolvedValue([]);
    (mapToPatientProfile as jest.Mock).mockReturnValue(validProfile);
    (calcCompositeRisk as jest.Mock).mockReturnValue(mockCompositeRisk);
  });

  // -------------------------------------------------------------------------
  // All conditions have no rules → block
  // -------------------------------------------------------------------------

  it('creates PENDING ProtocolReview with notes when no rules exist for any condition code', async () => {
    // rulesCheckSend: GetCommand for each of the 2 condition codes returns no Item
    rulesCheckSend
      .mockResolvedValueOnce({})   // J18.9 — no rule
      .mockResolvedValueOnce({});  // I10   — no rule
    // dynamoSend: review PutCommand
    dynamoSend.mockResolvedValueOnce({});

    const result = await generateCarePlan(validEvent, deps);

    expect(result.patientId).toBe('patient-abc');
    expect(result.protocolId).toBeNull();
    expect(result.reviewCreated).toBe(true);
    expect(result.blockedReason).toBe('NO_RULES_FOUND');
  });

  it('does not call generateProtocol when no rules exist', async () => {
    rulesCheckSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    expect(generateProtocol).not.toHaveBeenCalled();
  });

  it('does not write a protocol PutCommand when no rules exist', async () => {
    rulesCheckSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    // dynamoSend should only have the review PutCommand (1 call), not a protocol Put
    expect(dynamoSend).toHaveBeenCalledTimes(1);
    const putArg = dynamoSend.mock.calls[0][0];
    // The single Put goes to the REVIEWS table, not PROTOCOLS
    expect(putArg.input.TableName).not.toContain('TriageProtocols');
  });

  it('sets correct fields on the PENDING review record', async () => {
    rulesCheckSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    const putArg = dynamoSend.mock.calls[0][0];
    const item   = putArg.input.Item;
    expect(item.patient_id).toBe('patient-abc');
    expect(item.protocol_id).toBe('NONE');
    expect(item.status).toBe('PENDING');
    expect(item.confidence_score).toBe(0);
    expect(item.notes).toContain('J18.9');
    expect(item.notes).toContain('I10');
    expect(item.notes).toContain('Nurse review required');
  });

  it('emits care_plan_blocked audit log with no PHI', async () => {
    rulesCheckSend
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    dynamoSend.mockResolvedValueOnce({});

    await generateCarePlan(validEvent, deps);

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'care_plan_blocked' }),
    );
    const [ctx] = (auditLog as jest.Mock).mock.calls[0] as [{ detail?: string }];
    expect(ctx.detail).not.toContain('Jane Smith');
    expect(ctx.detail).not.toContain('+15559876543');
  });

  // -------------------------------------------------------------------------
  // At least one condition has rules → proceeds normally
  // -------------------------------------------------------------------------

  it('proceeds to generateProtocol when at least one condition code has a LATEST rule', async () => {
    (mapToPatientProfile as jest.Mock).mockReturnValue(profileOneCondition);
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);

    // rulesCheckSend: J18.9 has a rule
    rulesCheckSend.mockResolvedValueOnce({ Item: { condition_code: 'J18.9', version_id: 'LATEST' } });
    // dynamoSend: protocol Put
    dynamoSend.mockResolvedValueOnce({});

    const result = await generateCarePlan(validEvent, deps);

    expect(generateProtocol).toHaveBeenCalledTimes(1);
    expect(result.protocolId).toBe('proto-001');
    expect(result.blockedReason).toBeUndefined();
  });

  it('proceeds normally when first condition has no rule but second does', async () => {
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);

    rulesCheckSend
      .mockResolvedValueOnce({})  // J18.9 — no rule
      .mockResolvedValueOnce({ Item: { condition_code: 'I10', version_id: 'LATEST' } }); // I10 — has rule
    dynamoSend.mockResolvedValueOnce({}); // protocol Put

    const result = await generateCarePlan(validEvent, deps);

    expect(generateProtocol).toHaveBeenCalledTimes(1);
    expect(result.protocolId).toBe('proto-001');
    expect(result.blockedReason).toBeUndefined();
  });

  it('skips the rules check entirely when patient has no conditions and proceeds normally', async () => {
    (mapToPatientProfile as jest.Mock).mockReturnValue(profileNoConditions);
    (generateProtocol as jest.Mock).mockResolvedValue(highConfidenceProtocol);

    // No rulesCheckSend calls expected (empty conditions array)
    dynamoSend.mockResolvedValueOnce({}); // protocol Put only

    const result = await generateCarePlan(validEvent, deps);

    expect(generateProtocol).toHaveBeenCalledTimes(1);
    expect(result.protocolId).toBe('proto-001');
    expect(rulesCheckSend).not.toHaveBeenCalled();
  });
});
