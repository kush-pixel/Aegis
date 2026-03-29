import { runTriage } from '../triage-engine';
import type { ClinicalRule, ExtractionResult, CompositeRisk } from '@aegis/schemas';

const makeVar = (value: string | number | boolean, confidence: number): ExtractionResult => ({
  value,
  confidence,
  raw_transcript: 'test transcript',
});

const makeCompositeRisk = (risk_level: CompositeRisk['risk_level']): CompositeRisk => ({
  lace_score: 10,
  lace_risk_level: 'MODERATE',
  hospital_score: 7,
  hospital_risk_level: 'HIGH',
  composite_score: 65,
  risk_level,
});

const andRule: ClinicalRule = {
  rule_id:        'r1',
  condition_code: 'CHF',
  version_id:     'v1',
  logic:          'AND',
  conditions:     [{ variable_name: 'weight_gain', operator: 'gte', value: 3 }],
};

describe('runTriage — UNKNOWN_CONDITION', () => {
  it('returns UNKNOWN_CONDITION when rules array is empty', () => {
    const result = runTriage({
      variables: {},
      rules: [],
      compositeRisk: makeCompositeRisk('HIGH'),
    });
    expect(result).toEqual({ status: 'UNKNOWN_CONDITION', broken_rules: [] });
  });

  it('returns UNKNOWN_CONDITION for VERY_HIGH risk with empty rules', () => {
    const result = runTriage({
      variables: {},
      rules: [],
      compositeRisk: makeCompositeRisk('VERY_HIGH'),
    });
    expect(result).toEqual({ status: 'UNKNOWN_CONDITION', broken_rules: [] });
  });

  it('returns RED (not UNKNOWN_CONDITION) when non-empty rules fire with HIGH risk', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [andRule],
      compositeRisk: makeCompositeRisk('HIGH'),
    });
    expect(result.status).toBe('RED');
    expect(result.status).not.toBe('UNKNOWN_CONDITION');
  });

  it('returns YELLOW (not UNKNOWN_CONDITION) when non-empty rules fire with LOW risk', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [andRule],
      compositeRisk: makeCompositeRisk('LOW'),
    });
    expect(result.status).toBe('YELLOW');
    expect(result.status).not.toBe('UNKNOWN_CONDITION');
  });
});
