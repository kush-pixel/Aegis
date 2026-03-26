import type { ClinicalRule, ExtractionResult } from '@aegis/schemas';
import { evaluateCondition } from './condition-evaluator';

export type RuleResult =
  | { outcome: 'FIRES'; fired_variables: string[] }
  | { outcome: 'SILENT' }
  | { outcome: 'INCOMPLETE' };

const CONFIDENCE_THRESHOLD = 0.5;
const VERY_HIGH_THRESHOLD_ADJUSTMENT = 0.05;

export function evaluateRule(
  rule: ClinicalRule,
  variables: Record<string, ExtractionResult>,
  isVeryHighRisk: boolean,
): RuleResult {
  // INCOMPLETE check: any referenced variable is missing or has low confidence
  for (const condition of rule.conditions) {
    const variable = variables[condition.variable_name];
    if (variable === undefined || variable.confidence < CONFIDENCE_THRESHOLD) {
      return { outcome: 'INCOMPLETE' };
    }
  }

  if (rule.logic === 'AND') {
    const firedConditions = rule.conditions.filter((cond) =>
      evaluateCondition(cond, variables[cond.variable_name]!),
    );
    if (firedConditions.length === rule.conditions.length) {
      return { outcome: 'FIRES', fired_variables: firedConditions.map((c) => c.variable_name) };
    }
    return { outcome: 'SILENT' };
  }

  if (rule.logic === 'OR') {
    const firedConditions = rule.conditions.filter((cond) =>
      evaluateCondition(cond, variables[cond.variable_name]!),
    );
    if (firedConditions.length > 0) {
      return { outcome: 'FIRES', fired_variables: firedConditions.map((c) => c.variable_name) };
    }
    return { outcome: 'SILENT' };
  }

  // WEIGHTED
  const rawThreshold = rule.weighted_threshold ?? 0;
  const effectiveThreshold = isVeryHighRisk
    ? Math.max(0, rawThreshold - VERY_HIGH_THRESHOLD_ADJUSTMENT)
    : rawThreshold;

  const firedConditions = rule.conditions.filter((cond) =>
    evaluateCondition(cond, variables[cond.variable_name]!),
  );

  const weightedSum = firedConditions.reduce((sum, cond) => sum + (cond.weight ?? 0), 0);

  if (weightedSum >= effectiveThreshold) {
    return { outcome: 'FIRES', fired_variables: firedConditions.map((c) => c.variable_name) };
  }
  return { outcome: 'SILENT' };
}
