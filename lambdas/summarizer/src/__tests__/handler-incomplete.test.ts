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

const baseCallResult = {
  call_id: 'call-001',
  patient_id: 'patient-xyz',
  variables: {},
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  },
  created_at: '2026-03-28T00:00:00.000Z',
};

const incompleteCallResult = { ...baseCallResult, triage_status: 'INCOMPLETE' as const };
const greenCallResult     = { ...baseCallResult, call_id: 'call-green', triage_status: 'GREEN' as const };
const redCallResult       = { ...baseCallResult, call_id: 'call-red',   triage_status: 'RED' as const };
const yellowCallResult    = { ...baseCallResult, call_id: 'call-yellow', triage_status: 'YELLOW' as const };

const validProtocol = {
  protocol_id: 'proto-001',
  patient_id: 'patient-xyz',
  questions: [],
  conditions: [],
  confidence_score: 0.9,
  created_at: '2026-03-28T00:00:00.000Z',
};

const validProfile = {
  patient_id: 'patient-xyz',
  name: 'Test Patient',
  phone: '+15551112222',
  lace_score: 3,
  hospital_score: 2,
  composite_risk_score: 20,
  risk_level: 'LOW' as const,
  discharge_date: '2026-03-27',
  conditions: [],
};

const cleanSummary: Isbarr = {
  identify:       'Patient is Test Patient.',
  situation:      'Post-discharge triage completed.',
  background:     'Recently discharged.',
  assessment:     'No concerns.',
  recommendation: 'Continue care plan.',
  read_back:      'Summary confirmed.',
};

const incompleteEvent: SummarizerEvent = { call_id: 'call-001',    protocol_id: 'proto-001' };
const greenEvent: SummarizerEvent      = { call_id: 'call-green',  protocol_id: 'proto-001' };
const redEvent: SummarizerEvent        = { call_id: 'call-red',    protocol_id: 'proto-001' };
const yellowEvent: SummarizerEvent     = { call_id: 'call-yellow', protocol_id: 'proto-001' };

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

describe('summarizeCall — INCOMPLETE early return', () => {
  let dynamoSend: jest.Mock;
  let deps: SummarizerDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    dynamoSend = jest.fn();
    deps = makeDeps(dynamoSend);
    (getPatient as jest.Mock).mockResolvedValue({});
    (getPatientConditions as jest.Mock).mockResolvedValue([]);
    (mapToPatientProfile as jest.Mock).mockReturnValue(validProfile);
  });

  // -------------------------------------------------------------------------
  // INCOMPLETE — early return
  // -------------------------------------------------------------------------

  describe('INCOMPLETE triage_status', () => {
    it('returns skippedReason INCOMPLETE_TRIAGE with summaryGenerated false', async () => {
      dynamoSend.mockResolvedValueOnce({ Item: incompleteCallResult });

      const result = await summarizeCall(incompleteEvent, deps);

      expect(result).toEqual({
        callId: 'call-001',
        summaryGenerated: false,
        regenerated: false,
        skippedReason: 'INCOMPLETE_TRIAGE',
      });
    });

    it('does not call generateSummary', async () => {
      dynamoSend.mockResolvedValueOnce({ Item: incompleteCallResult });

      await summarizeCall(incompleteEvent, deps);

      expect(generateSummary).not.toHaveBeenCalled();
    });

    it('issues exactly one DynamoDB command (the GetCommand for CallResult) — no UpdateCommand', async () => {
      dynamoSend.mockResolvedValueOnce({ Item: incompleteCallResult });

      await summarizeCall(incompleteEvent, deps);

      expect(dynamoSend).toHaveBeenCalledTimes(1);
    });

    it('does not emit an audit log', async () => {
      dynamoSend.mockResolvedValueOnce({ Item: incompleteCallResult });

      await summarizeCall(incompleteEvent, deps);

      expect(auditLog).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Non-INCOMPLETE statuses — early return must NOT fire
  // -------------------------------------------------------------------------

  describe('GREEN triage_status proceeds normally', () => {
    it('returns summaryGenerated: true with no skippedReason', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: greenCallResult })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      const result = await summarizeCall(greenEvent, deps);

      expect(result.summaryGenerated).toBe(true);
      expect(result.skippedReason).toBeUndefined();
    });
  });

  describe('RED triage_status proceeds normally', () => {
    it('returns summaryGenerated: true with no skippedReason', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: redCallResult })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      const result = await summarizeCall(redEvent, deps);

      expect(result.summaryGenerated).toBe(true);
      expect(result.skippedReason).toBeUndefined();
    });
  });

  describe('YELLOW triage_status proceeds normally', () => {
    it('returns summaryGenerated: true with no skippedReason', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: yellowCallResult })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      const result = await summarizeCall(yellowEvent, deps);

      expect(result.summaryGenerated).toBe(true);
      expect(result.skippedReason).toBeUndefined();
    });
  });
});
