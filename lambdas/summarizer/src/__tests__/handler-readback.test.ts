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

const validCallResultGreen = {
  call_id: 'call-green-001',
  patient_id: 'patient-abc',
  variables: {},
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  },
  triage_status: 'GREEN' as const,
  created_at: '2026-03-28T00:00:00.000Z',
};

const validCallResultYellow = {
  ...validCallResultGreen,
  call_id: 'call-yellow-001',
  triage_status: 'YELLOW' as const,
};

const validCallResultRed = {
  ...validCallResultGreen,
  call_id: 'call-red-001',
  triage_status: 'RED' as const,
};

const validProtocol = {
  protocol_id: 'proto-001',
  patient_id: 'patient-abc',
  questions: [],
  conditions: [],
  confidence_score: 0.85,
  created_at: '2026-03-28T00:00:00.000Z',
};

const validProfile = {
  patient_id: 'patient-abc',
  name: 'Jane Doe',
  phone: '+15559876543',
  lace_score: 3,
  hospital_score: 2,
  composite_risk_score: 20,
  risk_level: 'LOW' as const,
  discharge_date: '2026-03-26',
  conditions: [],
};

const cleanSummary: Isbarr = {
  identify: 'Patient is Jane Doe, discharged 2026-03-26.',
  situation: 'Post-discharge triage call completed with no concerns identified.',
  background: 'Patient was recently discharged and screened via automated voice triage.',
  assessment: 'Patient reported no symptoms. No follow-up required.',
  recommendation: 'Continue current care plan. No immediate action needed.',
  read_back: 'Summary reviewed and confirmed by clinical team.',
};

const validEventGreen: SummarizerEvent = { call_id: 'call-green-001', protocol_id: 'proto-001' };
const validEventYellow: SummarizerEvent = { call_id: 'call-yellow-001', protocol_id: 'proto-001' };
const validEventRed: SummarizerEvent = { call_id: 'call-red-001', protocol_id: 'proto-001' };

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

describe('summarizeCall — GREEN read-back auto-population', () => {
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
  // GREEN — auto-population
  // -------------------------------------------------------------------------

  describe('GREEN triage_status', () => {
    it('calls dynamoSend 4 times (get callResult, get protocol, set isbarr_summary, set read_back)', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validCallResultGreen })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      await summarizeCall(validEventGreen, deps);

      expect(dynamoSend).toHaveBeenCalledTimes(4);
    });

    it('4th UpdateCommand sets read_back to the GREEN auto-populated string', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validCallResultGreen })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      await summarizeCall(validEventGreen, deps);

      const call4 = dynamoSend.mock.calls[3]?.[0] as { input: Record<string, unknown> };
      const values = call4.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':rb']).toBe(
        'No callback required \u2014 patient stable and recovering as expected.',
      );
    });

    it('4th UpdateCommand targets the correct key', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validCallResultGreen })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      await summarizeCall(validEventGreen, deps);

      const call4 = dynamoSend.mock.calls[3]?.[0] as { input: Record<string, unknown> };
      expect(call4.input['Key']).toEqual({ call_id: 'call-green-001' });
    });

    it('still returns summaryGenerated: true', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validCallResultGreen })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      const result = await summarizeCall(validEventGreen, deps);

      expect(result).toEqual({ callId: 'call-green-001', summaryGenerated: true, regenerated: false });
    });
  });

  // -------------------------------------------------------------------------
  // YELLOW — no auto-population
  // -------------------------------------------------------------------------

  describe('YELLOW triage_status', () => {
    it('calls dynamoSend exactly 3 times (no read_back update)', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validCallResultYellow })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      await summarizeCall(validEventYellow, deps);

      expect(dynamoSend).toHaveBeenCalledTimes(3);
    });
  });

  // -------------------------------------------------------------------------
  // RED — no auto-population
  // -------------------------------------------------------------------------

  describe('RED triage_status', () => {
    it('calls dynamoSend exactly 3 times (no read_back update)', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validCallResultRed })
        .mockResolvedValueOnce({ Item: validProtocol })
        .mockResolvedValueOnce({});
      (generateSummary as jest.Mock).mockResolvedValue(cleanSummary);

      await summarizeCall(validEventRed, deps);

      expect(dynamoSend).toHaveBeenCalledTimes(3);
    });
  });
});
