import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { runTriageForCall } from '../handler';
import type { TriageEngineDeps, TriageEngineEvent } from '../handler';
import { runTriage } from '@aegis/triage-engine';
import { calcCompositeRisk } from '@aegis/risk-scorer';
import { auditLog } from '@aegis/audit';

jest.mock('@aegis/triage-engine', () => ({
  runTriage: jest.fn(),
}));

jest.mock('@aegis/risk-scorer', () => ({
  calcCompositeRisk: jest.fn(),
}));

jest.mock('@aegis/audit', () => ({
  auditLog: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validCallResult = {
  call_id: 'CALL-abc123',
  patient_id: 'patient-xyz',
  variables: {
    pain_level: { value: 8, confidence: 0.95, raw_transcript: 'my pain is eight' },
  },
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  },
  triage_status: 'INCOMPLETE' as const,
  created_at: '2026-03-27T00:00:00.000Z',
};

const validPatientProfile = {
  patient_id: 'patient-xyz',
  name: 'Jane Smith',
  phone: '+15559998888',
  discharge_date: '2026-03-25',
  conditions: ['COPD'],
  lace_score: 12,
  hospital_score: 8,
  composite_risk_score: 62,
  risk_level: 'HIGH' as const,
};

const validClinicalRule = {
  rule_id: 'rule-001',
  condition_code: 'COPD',
  version_id: 'LATEST',
  logic: 'OR' as const,
  conditions: [
    { variable_name: 'pain_level', operator: 'gt' as const, value: 7 },
  ],
};

const mockCompositeRisk = {
  lace_score: 12,
  lace_risk_level: 'HIGH' as const,
  hospital_score: 8,
  hospital_risk_level: 'HIGH' as const,
  composite_score: 62,
  risk_level: 'HIGH' as const,
};

const validEvent: TriageEngineEvent = { call_id: 'CALL-abc123' };

// ---------------------------------------------------------------------------
// Mock deps factory
// ---------------------------------------------------------------------------

function makeDeps(dynamoSend: jest.Mock): TriageEngineDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupHappyPath(
  dynamoSend: jest.Mock,
  {
    callResult = validCallResult,
    patientProfile = validPatientProfile,
    clinicalRule = validClinicalRule,
  }: { callResult?: Record<string, unknown>; patientProfile?: Record<string, unknown>; clinicalRule?: Record<string, unknown> | null } = {},
): void {
  dynamoSend
    .mockResolvedValueOnce({ Item: callResult })        // GetCommand: CallResult
    .mockResolvedValueOnce({ Item: patientProfile })    // GetCommand: PatientProfile
    .mockResolvedValueOnce(clinicalRule ? { Item: clinicalRule } : {}) // GetCommand: ClinicalRule
    .mockResolvedValueOnce({});                          // UpdateCommand
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('runTriageForCall', () => {
  let dynamoSend: jest.Mock;
  let deps: TriageEngineDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    dynamoSend = jest.fn();
    deps = makeDeps(dynamoSend);

    (calcCompositeRisk as jest.Mock).mockReturnValue(mockCompositeRisk);
  });

  // -------------------------------------------------------------------------
  // Happy path — GREEN
  // -------------------------------------------------------------------------

  it('returns GREEN result when no rules fire', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    const result = await runTriageForCall(validEvent, deps);

    expect(result.callId).toBe('CALL-abc123');
    expect(result.triageStatus).toBe('GREEN');
    expect(result.brokenRules).toEqual([]);
    expect(result.weightedScore).toBe(62);
  });

  // -------------------------------------------------------------------------
  // Happy path — YELLOW
  // -------------------------------------------------------------------------

  it('returns YELLOW result when a rule fires and risk is MODERATE', async () => {
    const moderateProfile = {
      ...validPatientProfile,
      lace_score: 7,
      hospital_score: 3,
      composite_risk_score: 40,
      risk_level: 'MODERATE' as const,
    };
    const moderateRisk = {
      ...mockCompositeRisk,
      lace_score: 7,
      hospital_score: 3,
      composite_score: 40,
      risk_level: 'MODERATE' as const,
    };

    setupHappyPath(dynamoSend, { patientProfile: moderateProfile });
    (calcCompositeRisk as jest.Mock).mockReturnValue(moderateRisk);
    (runTriage as jest.Mock).mockReturnValue({ status: 'YELLOW', broken_rules: ['pain_level'] });

    const result = await runTriageForCall(validEvent, deps);

    expect(result.triageStatus).toBe('YELLOW');
    expect(result.brokenRules).toEqual(['pain_level']);
    expect(result.weightedScore).toBe(40);
  });

  // -------------------------------------------------------------------------
  // Happy path — RED
  // -------------------------------------------------------------------------

  it('returns RED result when a rule fires and risk is HIGH', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'RED', broken_rules: ['pain_level'] });

    const result = await runTriageForCall(validEvent, deps);

    expect(result.triageStatus).toBe('RED');
    expect(result.brokenRules).toEqual(['pain_level']);
    expect(result.weightedScore).toBe(62);
  });

  // -------------------------------------------------------------------------
  // Happy path — INCOMPLETE
  // -------------------------------------------------------------------------

  it('returns INCOMPLETE when a variable has low confidence', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'INCOMPLETE', broken_rules: [] });

    const result = await runTriageForCall(validEvent, deps);

    expect(result.triageStatus).toBe('INCOMPLETE');
    expect(result.brokenRules).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Empty conditions → no rules → GREEN
  // -------------------------------------------------------------------------

  it('runs triage with empty rules when patient has no conditions', async () => {
    const noConditionsProfile = { ...validPatientProfile, conditions: [] };

    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: noConditionsProfile })
      .mockResolvedValueOnce({});  // UpdateCommand (no GetCommand for rules)

    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    const result = await runTriageForCall(validEvent, deps);

    expect(result.triageStatus).toBe('GREEN');

    const triageArg = (runTriage as jest.Mock).mock.calls[0][0] as { rules: unknown[] };
    expect(triageArg.rules).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Multiple condition codes — rules aggregated
  // -------------------------------------------------------------------------

  it('aggregates rules from multiple condition codes', async () => {
    const multiConditionProfile = {
      ...validPatientProfile,
      conditions: ['COPD', 'CHF'],
    };

    const chfRule = {
      rule_id: 'rule-002',
      condition_code: 'CHF',
      version_id: 'LATEST',
      logic: 'AND' as const,
      conditions: [{ variable_name: 'edema', operator: 'eq' as const, value: true }],
    };

    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })        // CallResult
      .mockResolvedValueOnce({ Item: multiConditionProfile })  // PatientProfile
      .mockResolvedValueOnce({ Item: validClinicalRule })      // ClinicalRule: COPD
      .mockResolvedValueOnce({ Item: chfRule })               // ClinicalRule: CHF
      .mockResolvedValueOnce({});                              // UpdateCommand

    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    const triageArg = (runTriage as jest.Mock).mock.calls[0][0] as { rules: unknown[] };
    expect(triageArg.rules).toHaveLength(2);
    expect(triageArg.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ condition_code: 'COPD' }),
        expect.objectContaining({ condition_code: 'CHF' }),
      ]),
    );
  });

  // -------------------------------------------------------------------------
  // version_id='LATEST' pointer used in GetCommand
  // -------------------------------------------------------------------------

  it("fetches ClinicalRule using version_id='LATEST' as the DynamoDB key", async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    // Third dynamo.send call is the ClinicalRule GetCommand (index 2)
    const ruleGetArg = dynamoSend.mock.calls[2][0];
    expect(ruleGetArg.input.Key).toEqual({
      condition_code: 'COPD',
      version_id: 'LATEST',
    });
  });

  // -------------------------------------------------------------------------
  // Skips condition code when no LATEST rule exists
  // -------------------------------------------------------------------------

  it('skips a condition code when no LATEST rule item exists in DynamoDB', async () => {
    setupHappyPath(dynamoSend, { clinicalRule: null });
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    const triageArg = (runTriage as jest.Mock).mock.calls[0][0] as { rules: unknown[] };
    expect(triageArg.rules).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // CallResult not found
  // -------------------------------------------------------------------------

  it('throws when CallResult is not found', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: undefined });

    await expect(runTriageForCall(validEvent, deps)).rejects.toThrow(
      'CallResult not found: CALL-abc123',
    );

    expect(calcCompositeRisk).not.toHaveBeenCalled();
    expect(runTriage).not.toHaveBeenCalled();
  });

  it('throws when DynamoDB returns empty object for CallResult', async () => {
    dynamoSend.mockResolvedValueOnce({});

    await expect(runTriageForCall(validEvent, deps)).rejects.toThrow(
      'CallResult not found: CALL-abc123',
    );
  });

  // -------------------------------------------------------------------------
  // PatientProfile not found
  // -------------------------------------------------------------------------

  it('throws when PatientProfile is not found', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Item: validCallResult })
      .mockResolvedValueOnce({ Item: undefined });

    await expect(runTriageForCall(validEvent, deps)).rejects.toThrow(
      'PatientProfile not found: patient-xyz',
    );

    expect(runTriage).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Blank call_id validation
  // -------------------------------------------------------------------------

  it('throws on blank call_id', async () => {
    await expect(
      runTriageForCall({ call_id: '   ' }, deps),
    ).rejects.toThrow('Invalid call_id: must be non-empty');

    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it('throws on empty string call_id', async () => {
    await expect(
      runTriageForCall({ call_id: '' }, deps),
    ).rejects.toThrow('Invalid call_id: must be non-empty');
  });

  // -------------------------------------------------------------------------
  // UpdateCommand fields
  // -------------------------------------------------------------------------

  it('writes triage_status, broken_rules, weighted_score, and triage_completed_at to DynamoDB', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'RED', broken_rules: ['pain_level'] });

    await runTriageForCall(validEvent, deps);

    // UpdateCommand is the last call
    const updateArg = dynamoSend.mock.calls[dynamoSend.mock.calls.length - 1][0];
    const exprVals = updateArg.input.ExpressionAttributeValues as Record<string, unknown>;

    expect(exprVals[':status']).toBe('RED');
    expect(exprVals[':rules']).toEqual(['pain_level']);
    expect(exprVals[':score']).toBe(62);
    expect(typeof exprVals[':completed_at']).toBe('string');
    expect(exprVals[':completed_at']).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('UpdateCommand targets the correct call_id key', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    const updateArg = dynamoSend.mock.calls[dynamoSend.mock.calls.length - 1][0];
    expect(updateArg.input.Key).toEqual({ call_id: 'CALL-abc123' });
  });

  // -------------------------------------------------------------------------
  // auditLog
  // -------------------------------------------------------------------------

  it('emits exactly one triage_completed audit log', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'triage_completed',
        actor: 'triage-engine',
        resource: 'CallResult',
        callId: 'CALL-abc123',
      }),
    );
  });

  it('audit log detail contains no PHI — no patient name or phone', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    const calls = (auditLog as jest.Mock).mock.calls as [{ detail?: string }][];
    for (const [ctx] of calls) {
      expect(ctx.detail).not.toContain('Jane Smith');
      expect(ctx.detail).not.toContain('+15559998888');
      expect(ctx.detail).not.toContain('patient-xyz');
    }
  });

  // -------------------------------------------------------------------------
  // calcCompositeRisk receives correct scores from PatientProfile
  // -------------------------------------------------------------------------

  it('passes profile lace_score and hospital_score to calcCompositeRisk', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    expect(calcCompositeRisk).toHaveBeenCalledWith({
      lace_score: 12,
      hospital_score: 8,
    });
  });

  // -------------------------------------------------------------------------
  // runTriage receives correct variables and compositeRisk
  // -------------------------------------------------------------------------

  it('passes callResult variables and compositeRisk to runTriage', async () => {
    setupHappyPath(dynamoSend);
    (runTriage as jest.Mock).mockReturnValue({ status: 'GREEN', broken_rules: [] });

    await runTriageForCall(validEvent, deps);

    expect(runTriage).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: validCallResult.variables,
        compositeRisk: mockCompositeRisk,
      }),
    );
  });
});
