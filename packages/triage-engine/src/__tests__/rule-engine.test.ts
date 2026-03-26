import { evaluateRule } from '../rule-engine';
import type { ClinicalRule, ExtractionResult } from '@aegis/schemas';

const makeVar = (value: string | number | boolean, confidence: number): ExtractionResult => ({
  value,
  confidence,
  raw_transcript: 'test transcript',
});

describe('evaluateRule', () => {
  describe('AND logic', () => {
    const rule: ClinicalRule = {
      rule_id: 'r1',
      condition_code: 'CHF',
      version_id: 'v1',
      logic: 'AND',
      conditions: [
        { variable_name: 'weight_gain', operator: 'gte', value: 3 },
        { variable_name: 'edema', operator: 'eq', value: true },
      ],
    };

    it('returns FIRES with fired_variables when all conditions are met', () => {
      const vars = {
        weight_gain: makeVar(4, 0.9),
        edema: makeVar(true, 0.85),
      };
      const result = evaluateRule(rule, vars, false);
      expect(result).toEqual({ outcome: 'FIRES', fired_variables: ['weight_gain', 'edema'] });
    });

    it('returns SILENT when one condition fails', () => {
      const vars = {
        weight_gain: makeVar(2, 0.9), // 2 < 3, fails gte
        edema: makeVar(true, 0.85),
      };
      expect(evaluateRule(rule, vars, false)).toEqual({ outcome: 'SILENT' });
    });
  });

  describe('OR logic', () => {
    const rule: ClinicalRule = {
      rule_id: 'r2',
      condition_code: 'COPD',
      version_id: 'v1',
      logic: 'OR',
      conditions: [
        { variable_name: 'sob', operator: 'eq', value: true },
        { variable_name: 'fever', operator: 'gt', value: 38.5 },
      ],
    };

    it('returns FIRES with fired_variables when at least one condition is met', () => {
      const vars = {
        sob: makeVar(false, 0.9),
        fever: makeVar(39.0, 0.88), // fires
      };
      const result = evaluateRule(rule, vars, false);
      expect(result).toEqual({ outcome: 'FIRES', fired_variables: ['fever'] });
    });

    it('returns SILENT when no conditions are met', () => {
      const vars = {
        sob: makeVar(false, 0.9),
        fever: makeVar(37.0, 0.88),
      };
      expect(evaluateRule(rule, vars, false)).toEqual({ outcome: 'SILENT' });
    });
  });

  describe('WEIGHTED logic', () => {
    const rule: ClinicalRule = {
      rule_id: 'r3',
      condition_code: 'CHF',
      version_id: 'v1',
      logic: 'WEIGHTED',
      weighted_threshold: 0.6,
      conditions: [
        { variable_name: 'weight_gain', operator: 'gte', value: 3, weight: 0.4 },
        { variable_name: 'edema', operator: 'eq', value: true, weight: 0.4 },
      ],
    };

    it('returns FIRES when weighted sum meets threshold', () => {
      // 0.4 + 0.4 = 0.8 >= 0.6
      const vars = {
        weight_gain: makeVar(4, 0.9),
        edema: makeVar(true, 0.9),
      };
      const result = evaluateRule(rule, vars, false);
      expect(result).toEqual({ outcome: 'FIRES', fired_variables: ['weight_gain', 'edema'] });
    });

    it('returns SILENT when weighted sum is below threshold', () => {
      // only weight_gain fires: 0.4 < 0.6
      const vars = {
        weight_gain: makeVar(4, 0.9),
        edema: makeVar(false, 0.9),
      };
      expect(evaluateRule(rule, vars, false)).toEqual({ outcome: 'SILENT' });
    });

    it('returns FIRES with VERY_HIGH risk when adjusted threshold is met (was SILENT at normal)', () => {
      // threshold=0.45, only weight_gain fires: sum=0.4
      // Normal: 0.4 < 0.45 → SILENT; VERY_HIGH: 0.45-0.05=0.40, 0.4>=0.40 → FIRES
      const boundaryRule: ClinicalRule = { ...rule, weighted_threshold: 0.45 };
      const vars = {
        weight_gain: makeVar(4, 0.9),
        edema: makeVar(false, 0.9),
      };
      expect(evaluateRule(boundaryRule, vars, false)).toEqual({ outcome: 'SILENT' });
      expect(evaluateRule(boundaryRule, vars, true)).toEqual({
        outcome: 'FIRES',
        fired_variables: ['weight_gain'],
      });
    });

    it('returns SILENT when condition has no weight (treated as 0)', () => {
      const noWeightRule: ClinicalRule = {
        rule_id: 'r4',
        condition_code: 'CHF',
        version_id: 'v1',
        logic: 'WEIGHTED',
        weighted_threshold: 0.5,
        conditions: [{ variable_name: 'weight_gain', operator: 'gte', value: 3 }],
      };
      const vars = { weight_gain: makeVar(5, 0.9) };
      // condition fires but weight=undefined→0, weightedSum=0 < 0.5 → SILENT
      expect(evaluateRule(noWeightRule, vars, false)).toEqual({ outcome: 'SILENT' });
    });

    it('fires WEIGHTED rule when weighted_threshold is not defined (defaults to 0)', () => {
      const noThresholdRule: ClinicalRule = {
        rule_id: 'r_nothresh',
        condition_code: 'TEST',
        version_id: 'v1',
        logic: 'WEIGHTED',
        // weighted_threshold omitted — defaults to 0
        conditions: [{ variable_name: 'weight_gain', operator: 'gte', value: 3, weight: 0.4 }],
      };
      const vars = { weight_gain: makeVar(5, 0.9) };
      // condition fires: weightedSum=0.4 >= effectiveThreshold=0 → FIRES
      expect(evaluateRule(noThresholdRule, vars, false)).toEqual({
        outcome: 'FIRES',
        fired_variables: ['weight_gain'],
      });
    });

    it('clamps adjusted threshold to 0 when VERY_HIGH risk would make it negative', () => {
      // threshold=0.02 - 0.05 = -0.03, clamped to 0; sum=0 >= 0 → FIRES
      const zeroThresholdRule: ClinicalRule = {
        ...rule,
        weighted_threshold: 0.02,
        conditions: [
          { variable_name: 'weight_gain', operator: 'gte', value: 999, weight: 0.4 }, // won't fire
          { variable_name: 'edema', operator: 'eq', value: true, weight: 0.4 },       // won't fire
        ],
      };
      const vars = {
        weight_gain: makeVar(1, 0.9),   // 1 < 999, doesn't fire
        edema: makeVar(false, 0.9),     // false != true, doesn't fire
      };
      // sum=0, effectiveThreshold=max(0, 0.02-0.05)=0; 0>=0 → FIRES
      expect(evaluateRule(zeroThresholdRule, vars, true)).toEqual({
        outcome: 'FIRES',
        fired_variables: [],
      });
    });
  });

  describe('INCOMPLETE detection', () => {
    const rule: ClinicalRule = {
      rule_id: 'r5',
      condition_code: 'CHF',
      version_id: 'v1',
      logic: 'AND',
      conditions: [{ variable_name: 'weight_gain', operator: 'gte', value: 3 }],
    };

    it('returns INCOMPLETE when variable is missing from variables map', () => {
      expect(evaluateRule(rule, {}, false)).toEqual({ outcome: 'INCOMPLETE' });
    });

    it('returns INCOMPLETE when variable confidence is below 0.50', () => {
      const vars = { weight_gain: makeVar(5, 0.49) };
      expect(evaluateRule(rule, vars, false)).toEqual({ outcome: 'INCOMPLETE' });
    });

    it('does NOT return INCOMPLETE when confidence is exactly 0.50', () => {
      const vars = { weight_gain: makeVar(5, 0.5) };
      expect(evaluateRule(rule, vars, false)).toEqual({
        outcome: 'FIRES',
        fired_variables: ['weight_gain'],
      });
    });
  });
});
