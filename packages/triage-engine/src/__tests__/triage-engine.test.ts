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
  rule_id: 'r1',
  condition_code: 'CHF',
  version_id: 'v1',
  logic: 'AND',
  conditions: [{ variable_name: 'weight_gain', operator: 'gte', value: 3 }],
};

// WEIGHTED rule with threshold=0.45, weight=0.4 on weight_gain
// Normal: sum=0.4 < 0.45 → SILENT (GREEN); VERY_HIGH: 0.45-0.05=0.40, 0.4>=0.40 → FIRES (RED)
const weightedRule: ClinicalRule = {
  rule_id: 'r2',
  condition_code: 'CHF',
  version_id: 'v1',
  logic: 'WEIGHTED',
  weighted_threshold: 0.45,
  conditions: [{ variable_name: 'weight_gain', operator: 'gte', value: 3, weight: 0.4 }],
};

describe('runTriage', () => {
  it('returns GREEN with empty broken_rules when no rules fire', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(1, 0.9) }, // 1 < 3, rule silent
      rules: [andRule],
      compositeRisk: makeCompositeRisk('HIGH'),
    });
    expect(result).toEqual({ status: 'GREEN', broken_rules: [] });
  });

  it('returns YELLOW with broken_rules when a rule fires and risk is LOW', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [andRule],
      compositeRisk: makeCompositeRisk('LOW'),
    });
    expect(result).toEqual({ status: 'YELLOW', broken_rules: ['weight_gain'] });
  });

  it('returns YELLOW with broken_rules when a rule fires and risk is MODERATE', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [andRule],
      compositeRisk: makeCompositeRisk('MODERATE'),
    });
    expect(result).toEqual({ status: 'YELLOW', broken_rules: ['weight_gain'] });
  });

  it('returns RED with broken_rules when a rule fires and risk is HIGH', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [andRule],
      compositeRisk: makeCompositeRisk('HIGH'),
    });
    expect(result).toEqual({ status: 'RED', broken_rules: ['weight_gain'] });
  });

  it('returns RED with broken_rules when a rule fires and risk is VERY_HIGH', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [andRule],
      compositeRisk: makeCompositeRisk('VERY_HIGH'),
    });
    expect(result).toEqual({ status: 'RED', broken_rules: ['weight_gain'] });
  });

  it('returns INCOMPLETE with empty broken_rules when a rule returns INCOMPLETE', () => {
    const result = runTriage({
      variables: { weight_gain: makeVar(5, 0.3) }, // confidence < 0.5
      rules: [andRule],
      compositeRisk: makeCompositeRisk('HIGH'),
    });
    expect(result).toEqual({ status: 'INCOMPLETE', broken_rules: [] });
  });

  it('returns GREEN for HIGH risk when WEIGHTED rule is silent, then RED for VERY_HIGH after threshold adjustment', () => {
    const highResult = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [weightedRule],
      compositeRisk: makeCompositeRisk('HIGH'),
    });
    expect(highResult).toEqual({ status: 'GREEN', broken_rules: [] });

    const veryHighResult = runTriage({
      variables: { weight_gain: makeVar(5, 0.9) },
      rules: [weightedRule],
      compositeRisk: makeCompositeRisk('VERY_HIGH'),
    });
    expect(veryHighResult).toEqual({ status: 'RED', broken_rules: ['weight_gain'] });
  });

  it('returns UNKNOWN_CONDITION with empty broken_rules when rules array is empty', () => {
    const result = runTriage({
      variables: {},
      rules: [],
      compositeRisk: makeCompositeRisk('VERY_HIGH'),
    });
    expect(result).toEqual({ status: 'UNKNOWN_CONDITION', broken_rules: [] });
  });
});
