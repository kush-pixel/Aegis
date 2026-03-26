import { z } from 'zod';

export const RuleOperatorSchema = z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'contains']);

export const RuleLogicSchema = z.enum(['AND', 'OR', 'WEIGHTED']);

export const RuleConditionSchema = z.object({
  variable_name: z.string().min(1),
  operator: RuleOperatorSchema,
  value: z.union([z.string(), z.number(), z.boolean()]),
  weight: z.number().optional(),
});

export const ClinicalRuleSchema = z.object({
  rule_id: z.string().min(1),
  condition_code: z.string().min(1),
  version_id: z.string().min(1),
  logic: RuleLogicSchema,
  conditions: z.array(RuleConditionSchema).min(1),
  weighted_threshold: z.number().min(0).max(1).optional(),
});

export type RuleOperator = z.infer<typeof RuleOperatorSchema>;
export type RuleLogic = z.infer<typeof RuleLogicSchema>;
export type RuleCondition = z.infer<typeof RuleConditionSchema>;
export type ClinicalRule = z.infer<typeof ClinicalRuleSchema>;
