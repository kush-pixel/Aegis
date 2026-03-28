/**
 * End-to-end pipeline integration test.
 *
 * All scenarios run in deterministic mock mode (USE_BEDROCK_MOCK=true).
 * No PHI — all patient identifiers are synthetic test values.
 * No internal mocking of package functions; real exports are called throughout.
 */

import { getMockProtocol, getMockExtractionResults, getMockSummary } from '@aegis/bedrock-client';
import { calcCompositeRisk } from '@aegis/risk-scorer';
import { runTriage } from '@aegis/triage-engine';
import type { TriageInput } from '@aegis/triage-engine';
import { mapResponsesToZCodes, PRAPARE_QUESTIONS } from '@aegis/sdoh';
import { auditLog } from '@aegis/audit';
import { generateCallId, validatePatientId } from '@aegis/validation';
import { CallResultSchema } from '@aegis/schemas';
import type { ClinicalRule, ExtractionResult } from '@aegis/schemas';

// ── test-wide setup ──────────────────────────────────────────────────────────

const PATIENT_ID = 'TEST-001';
const PATIENT_NAME = 'Test Patient';

let consoleSpy: jest.SpyInstance;

beforeAll(() => {
  process.env['USE_BEDROCK_MOCK'] = 'true';
  // Suppress audit output from polluting test results
  consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterAll(() => {
  consoleSpy.mockRestore();
});

// ── shared helpers ───────────────────────────────────────────────────────────

/** A rule that fires when chest_pain === 'yes' (what getMockExtractionResults returns). */
const FIRING_RULE: ClinicalRule = {
  rule_id: 'test-rule-chest-pain',
  condition_code: 'I50.9',
  version_id: '1',
  logic: 'AND',
  conditions: [{ variable_name: 'chest_pain', operator: 'eq', value: 'yes' }],
};

/** A rule that never fires because no mock variable has value 'no'. */
const SILENT_RULE: ClinicalRule = {
  rule_id: 'test-rule-silent',
  condition_code: 'I50.9',
  version_id: '1',
  logic: 'AND',
  conditions: [{ variable_name: 'chest_pain', operator: 'eq', value: 'no' }],
};

function makeVariables(): Record<string, ExtractionResult> {
  const protocol = getMockProtocol(PATIENT_ID);
  const names = protocol.questions.map((q) => q.variable_name);
  return getMockExtractionResults(names);
}

// ── scenario 1: GREEN ────────────────────────────────────────────────────────

describe('Scenario 1 — GREEN (no rules fire, low risk)', () => {
  const callId = generateCallId();

  it('validatePatientId accepts synthetic test ID', () => {
    expect(validatePatientId(PATIENT_ID)).toBe(true);
  });

  it('generates a valid call ID', () => {
    expect(callId).toMatch(/^CALL-[0-9a-f]+$/);
  });

  it('runTriage returns GREEN when rules array is empty', () => {
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 2, hospital_score: 1 });
    expect(compositeRisk.risk_level).toBe('LOW');

    const input: TriageInput = { variables, rules: [], compositeRisk };
    const result = runTriage(input);

    expect(result.status).toBe('GREEN');
    expect(result.broken_rules).toHaveLength(0);
  });

  it('runTriage returns GREEN when rule is silent (no value match)', () => {
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 2, hospital_score: 1 });
    const input: TriageInput = { variables, rules: [SILENT_RULE], compositeRisk };
    const result = runTriage(input);

    expect(result.status).toBe('GREEN');
  });

  it('assembles a valid CallResult for GREEN scenario', () => {
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 2, hospital_score: 1 });
    const triageResult = runTriage({ variables, rules: [], compositeRisk });
    const sdoh = mapResponsesToZCodes({ medication_cost_barrier: false, transportation_barrier: false });
    const summary = getMockSummary(PATIENT_NAME);

    const callResult = CallResultSchema.parse({
      call_id: callId,
      patient_id: PATIENT_ID,
      variables,
      sdoh_responses: sdoh,
      triage_status: triageResult.status,
      isbarr_summary: summary,
      created_at: new Date().toISOString(),
    });

    expect(callResult.triage_status).toBe('GREEN');
    auditLog({ action: 'triage.completed', actor: 'pipeline-test', resource: PATIENT_ID, callId, detail: 'GREEN' });
  });
});

// ── scenario 2: YELLOW ───────────────────────────────────────────────────────

describe('Scenario 2 — YELLOW (rule fires, moderate risk)', () => {
  it('calcCompositeRisk returns MODERATE for lace=6, hospital=4', () => {
    const risk = calcCompositeRisk({ lace_score: 6, hospital_score: 4 });
    expect(risk.risk_level).toBe('MODERATE');
    expect(risk.composite_score).toBeGreaterThanOrEqual(30);
    expect(risk.composite_score).toBeLessThan(60);
  });

  it('runTriage returns YELLOW when rule fires and risk is MODERATE', () => {
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 6, hospital_score: 4 });

    const input: TriageInput = { variables, rules: [FIRING_RULE], compositeRisk };
    const result = runTriage(input);

    expect(result.status).toBe('YELLOW');
    expect(result.broken_rules).toContain('chest_pain');
  });

  it('assembles a valid CallResult for YELLOW scenario', () => {
    const callId = generateCallId();
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 6, hospital_score: 4 });
    const triageResult = runTriage({ variables, rules: [FIRING_RULE], compositeRisk });
    const sdoh = mapResponsesToZCodes({ medication_cost_barrier: true, transportation_barrier: false });
    const summary = getMockSummary(PATIENT_NAME);

    const callResult = CallResultSchema.parse({
      call_id: callId,
      patient_id: PATIENT_ID,
      variables,
      sdoh_responses: sdoh,
      triage_status: triageResult.status,
      isbarr_summary: summary,
      created_at: new Date().toISOString(),
    });

    expect(callResult.triage_status).toBe('YELLOW');
    auditLog({ action: 'triage.completed', actor: 'pipeline-test', resource: PATIENT_ID, callId, detail: 'YELLOW' });
  });
});

// ── scenario 3: RED ──────────────────────────────────────────────────────────

describe('Scenario 3 — RED (rule fires, high risk)', () => {
  it('calcCompositeRisk returns HIGH for lace=15, hospital=10', () => {
    const risk = calcCompositeRisk({ lace_score: 15, hospital_score: 10 });
    expect(risk.risk_level).toBe('HIGH');
    expect(risk.composite_score).toBeGreaterThanOrEqual(60);
    expect(risk.composite_score).toBeLessThan(80);
  });

  it('runTriage returns RED when rule fires and risk is HIGH', () => {
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 15, hospital_score: 10 });

    const input: TriageInput = { variables, rules: [FIRING_RULE], compositeRisk };
    const result = runTriage(input);

    expect(result.status).toBe('RED');
    expect(result.broken_rules).toContain('chest_pain');
  });

  it('runTriage also returns RED for VERY_HIGH risk', () => {
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 19, hospital_score: 13 });
    expect(compositeRisk.risk_level).toBe('VERY_HIGH');

    const result = runTriage({ variables, rules: [FIRING_RULE], compositeRisk });
    expect(result.status).toBe('RED');
  });

  it('assembles a valid CallResult for RED scenario', () => {
    const callId = generateCallId();
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 15, hospital_score: 10 });
    const triageResult = runTriage({ variables, rules: [FIRING_RULE], compositeRisk });
    const sdoh = mapResponsesToZCodes({ medication_cost_barrier: false, transportation_barrier: true });
    const summary = getMockSummary(PATIENT_NAME);

    const callResult = CallResultSchema.parse({
      call_id: callId,
      patient_id: PATIENT_ID,
      variables,
      sdoh_responses: sdoh,
      triage_status: triageResult.status,
      isbarr_summary: summary,
      created_at: new Date().toISOString(),
    });

    expect(callResult.triage_status).toBe('RED');
    auditLog({ action: 'triage.completed', actor: 'pipeline-test', resource: PATIENT_ID, callId, detail: 'RED' });
  });
});

// ── scenario 4: INCOMPLETE ───────────────────────────────────────────────────

describe('Scenario 4 — INCOMPLETE (low-confidence variable)', () => {
  it('runTriage returns INCOMPLETE when a referenced variable has confidence below 0.5', () => {
    const lowConfidenceVariables: Record<string, ExtractionResult> = {
      chest_pain: { value: 'yes', confidence: 0.9, raw_transcript: 'mock transcript' },
      medication_adherence: { value: 'unsure', confidence: 0.3, raw_transcript: 'patient was unclear' },
    };

    const ruleReferencingLowConfidence: ClinicalRule = {
      rule_id: 'test-rule-med-adherence',
      condition_code: 'Z91.19',
      version_id: '1',
      logic: 'AND',
      conditions: [{ variable_name: 'medication_adherence', operator: 'eq', value: 'no' }],
    };

    const compositeRisk = calcCompositeRisk({ lace_score: 8, hospital_score: 5 });
    const input: TriageInput = {
      variables: lowConfidenceVariables,
      rules: [ruleReferencingLowConfidence],
      compositeRisk,
    };

    const result = runTriage(input);
    expect(result.status).toBe('INCOMPLETE');
    expect(result.broken_rules).toHaveLength(0);
  });

  it('runTriage returns INCOMPLETE even when risk is VERY_HIGH', () => {
    const lowConfidenceVariables: Record<string, ExtractionResult> = {
      chest_pain: { value: 'yes', confidence: 0.4, raw_transcript: 'transcript' },
    };

    const compositeRisk = calcCompositeRisk({ lace_score: 19, hospital_score: 13 });
    const input: TriageInput = {
      variables: lowConfidenceVariables,
      rules: [FIRING_RULE],
      compositeRisk,
    };

    const result = runTriage(input);
    expect(result.status).toBe('INCOMPLETE');
  });

  it('auditLog is called for INCOMPLETE outcome', () => {
    const callId = generateCallId();
    auditLog({ action: 'triage.incomplete', actor: 'pipeline-test', resource: PATIENT_ID, callId, detail: 'INCOMPLETE' });
    expect(consoleSpy).toHaveBeenCalled();
  });
});

// ── scenario 5: SDOH barrier mapping ────────────────────────────────────────

describe('Scenario 5 — SDOH barrier mapping', () => {
  it('PRAPARE_QUESTIONS defines exactly 2 screening questions', () => {
    expect(PRAPARE_QUESTIONS).toHaveLength(2);
    expect(PRAPARE_QUESTIONS.map((q) => q.id)).toEqual(
      expect.arrayContaining(['medication_cost_barrier', 'transportation_barrier']),
    );
  });

  it('maps both barriers true → z_codes includes Z59.7 and Z59.8', () => {
    const result = mapResponsesToZCodes({ medication_cost_barrier: true, transportation_barrier: true });
    expect(result.medication_cost_barrier).toBe(true);
    expect(result.transportation_barrier).toBe(true);
    expect(result.z_codes).toContain('Z59.7');
    expect(result.z_codes).toContain('Z59.8');
    expect(result.z_codes).toHaveLength(2);
  });

  it('maps both barriers false → z_codes is empty', () => {
    const result = mapResponsesToZCodes({ medication_cost_barrier: false, transportation_barrier: false });
    expect(result.z_codes).toHaveLength(0);
  });

  it('maps only medication_cost_barrier true → only Z59.7 present', () => {
    const result = mapResponsesToZCodes({ medication_cost_barrier: true, transportation_barrier: false });
    expect(result.z_codes).toEqual(['Z59.7']);
  });

  it('maps only transportation_barrier true → only Z59.8 present', () => {
    const result = mapResponsesToZCodes({ medication_cost_barrier: false, transportation_barrier: true });
    expect(result.z_codes).toEqual(['Z59.8']);
  });

  it('SDOH result integrates into CallResult schema', () => {
    const callId = generateCallId();
    const variables = makeVariables();
    const compositeRisk = calcCompositeRisk({ lace_score: 4, hospital_score: 2 });
    const triageResult = runTriage({ variables, rules: [], compositeRisk });
    const sdoh = mapResponsesToZCodes({ medication_cost_barrier: true, transportation_barrier: true });
    const summary = getMockSummary(PATIENT_NAME);

    const callResult = CallResultSchema.parse({
      call_id: callId,
      patient_id: PATIENT_ID,
      variables,
      sdoh_responses: sdoh,
      triage_status: triageResult.status,
      isbarr_summary: summary,
      created_at: new Date().toISOString(),
    });

    expect(callResult.sdoh_responses.z_codes).toHaveLength(2);
    expect(callResult.sdoh_responses.z_codes).toContain('Z59.7');
    expect(callResult.sdoh_responses.z_codes).toContain('Z59.8');
    auditLog({ action: 'sdoh.screened', actor: 'pipeline-test', resource: PATIENT_ID, callId });
  });
});
