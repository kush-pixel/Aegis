import type { ClinicalRule, ExtractionResult, CompositeRisk } from '@aegis/schemas';
import { evaluateRule } from './rule-engine';

export type TriageStatus = 'RED' | 'YELLOW' | 'GREEN' | 'INCOMPLETE' | 'UNKNOWN_CONDITION';

export interface TriageResult {
  status: TriageStatus;
  broken_rules: string[];
}

export interface TriageInput {
  variables: Record<string, ExtractionResult>;
  rules: ClinicalRule[];
  compositeRisk: CompositeRisk;
}

export function runTriage(input: TriageInput): TriageResult {
  const { variables, rules, compositeRisk } = input;
  const isVeryHighRisk = compositeRisk.risk_level === 'VERY_HIGH';

  if (rules.length === 0) {
    return { status: 'UNKNOWN_CONDITION', broken_rules: [] };
  }

  const firedVariables = new Set<string>();

  for (const rule of rules) {
    const result = evaluateRule(rule, variables, isVeryHighRisk);

    if (result.outcome === 'INCOMPLETE') {
      return { status: 'INCOMPLETE', broken_rules: [] };
    }

    if (result.outcome === 'FIRES') {
      for (const v of result.fired_variables) {
        firedVariables.add(v);
      }
    }
  }

  if (firedVariables.size === 0) {
    return { status: 'GREEN', broken_rules: [] };
  }

  const broken_rules = Array.from(firedVariables);
  const isHighOrAbove =
    compositeRisk.risk_level === 'HIGH' || compositeRisk.risk_level === 'VERY_HIGH';

  return {
    status: isHighOrAbove ? 'RED' : 'YELLOW',
    broken_rules,
  };
}
