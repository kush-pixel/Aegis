import { evaluateCondition } from '../condition-evaluator';
import type { RuleCondition, ExtractionResult } from '@aegis/schemas';

const makeVar = (value: string | number | boolean, confidence = 0.9): ExtractionResult => ({
  value,
  confidence,
  raw_transcript: 'test transcript',
});

const makeCond = (
  operator: RuleCondition['operator'],
  value: string | number | boolean,
  weight?: number,
): RuleCondition => ({ variable_name: 'v', operator, value, weight });

describe('evaluateCondition', () => {
  describe('eq operator', () => {
    it('returns true when varValue === condValue (boolean)', () => {
      expect(evaluateCondition(makeCond('eq', true), makeVar(true))).toBe(true);
    });

    it('returns false when varValue !== condValue (boolean)', () => {
      expect(evaluateCondition(makeCond('eq', false), makeVar(true))).toBe(false);
    });
  });

  describe('gt operator', () => {
    it('returns true when varValue > condValue', () => {
      expect(evaluateCondition(makeCond('gt', 3), makeVar(4))).toBe(true);
    });

    it('returns false when varValue === condValue (not strictly greater)', () => {
      expect(evaluateCondition(makeCond('gt', 3), makeVar(3))).toBe(false);
    });
  });

  describe('lt operator', () => {
    it('returns true when varValue < condValue', () => {
      expect(evaluateCondition(makeCond('lt', 5), makeVar(4))).toBe(true);
    });

    it('returns false when varValue equals condValue (not strictly less)', () => {
      expect(evaluateCondition(makeCond('lt', 4), makeVar(4))).toBe(false);
    });
  });

  describe('gte operator', () => {
    it('returns true when varValue === condValue (boundary: >=)', () => {
      expect(evaluateCondition(makeCond('gte', 3), makeVar(3))).toBe(true);
    });

    it('returns false when varValue < condValue', () => {
      expect(evaluateCondition(makeCond('gte', 5), makeVar(3))).toBe(false);
    });
  });

  describe('lte operator', () => {
    it('returns true when varValue === condValue (boundary: <=)', () => {
      expect(evaluateCondition(makeCond('lte', 5), makeVar(5))).toBe(true);
    });

    it('returns false when varValue > condValue', () => {
      expect(evaluateCondition(makeCond('lte', 3), makeVar(5))).toBe(false);
    });
  });

  describe('contains operator', () => {
    it('returns true when varValue contains condValue as a substring', () => {
      expect(evaluateCondition(makeCond('contains', 'yes'), makeVar('yes I do'))).toBe(true);
    });

    it('returns false when varValue does not contain condValue', () => {
      expect(evaluateCondition(makeCond('contains', 'no'), makeVar('absolutely yes'))).toBe(false);
    });
  });

  describe('type mismatch guards', () => {
    it('returns false for gt operator when varValue is not a number', () => {
      expect(evaluateCondition(makeCond('gt', 3), makeVar('five'))).toBe(false);
    });

    it('returns false for lt operator when condValue is not a number', () => {
      expect(evaluateCondition(makeCond('lt', 'high'), makeVar(3))).toBe(false);
    });

    it('returns false for gte operator when varValue is not a number', () => {
      expect(evaluateCondition(makeCond('gte', 3), makeVar('many'))).toBe(false);
    });

    it('returns false for lte operator when varValue is not a number', () => {
      expect(evaluateCondition(makeCond('lte', 5), makeVar('few'))).toBe(false);
    });

    it('returns false for contains operator when varValue is not a string', () => {
      expect(evaluateCondition(makeCond('contains', 'yes'), makeVar(true))).toBe(false);
    });

    it('returns false for contains operator when condValue is not a string', () => {
      expect(evaluateCondition(makeCond('contains', true), makeVar('yes indeed'))).toBe(false);
    });
  });
});
