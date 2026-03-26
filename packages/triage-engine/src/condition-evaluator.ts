import type { RuleCondition, ExtractionResult } from '@aegis/schemas';

export function evaluateCondition(
  condition: RuleCondition,
  variable: ExtractionResult,
): boolean {
  const varValue = variable.value;
  const condValue = condition.value;

  switch (condition.operator) {
    case 'eq':
      return varValue === condValue;

    case 'gt':
      return typeof varValue === 'number' && typeof condValue === 'number'
        ? varValue > condValue
        : false;

    case 'lt':
      return typeof varValue === 'number' && typeof condValue === 'number'
        ? varValue < condValue
        : false;

    case 'gte':
      return typeof varValue === 'number' && typeof condValue === 'number'
        ? varValue >= condValue
        : false;

    case 'lte':
      return typeof varValue === 'number' && typeof condValue === 'number'
        ? varValue <= condValue
        : false;

    case 'contains':
      return typeof varValue === 'string' && typeof condValue === 'string'
        ? varValue.includes(condValue)
        : false;
  }
}
