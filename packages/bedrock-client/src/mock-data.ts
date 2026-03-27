import type { TriageProtocol, ExtractionResult, Isbarr } from '@aegis/schemas';
import { TriageProtocolSchema, ExtractionResultSchema, IsbarrSchema } from '@aegis/schemas';
import { KBResultSchema } from './types';
import type { KBResult } from './types';

export function isMockMode(): boolean {
  return process.env['USE_BEDROCK_MOCK'] === 'true';
}

export function getMockProtocol(patientId: string): TriageProtocol {
  return TriageProtocolSchema.parse({
    protocol_id: `mock-protocol-${patientId}`,
    patient_id: patientId,
    questions: [
      {
        question_id: 'q1',
        text: 'Are you experiencing any chest pain or discomfort?',
        variable_name: 'chest_pain',
        required: true,
        order: 0,
      },
      {
        question_id: 'q2',
        text: 'Have you been taking your medications as prescribed?',
        variable_name: 'medication_adherence',
        required: true,
        order: 1,
      },
      {
        question_id: 'q3',
        text: 'Do you have a follow-up appointment scheduled?',
        variable_name: 'followup_scheduled',
        required: false,
        order: 2,
      },
    ],
    conditions: [
      { condition_code: 'I50.9', description: 'Heart failure, unspecified' },
    ],
    confidence_score: 0.85,
    created_at: new Date().toISOString(),
  });
}

export function getMockExtractionResults(
  variableNames: string[],
): Record<string, ExtractionResult> {
  const results: Record<string, ExtractionResult> = {};
  for (const name of variableNames) {
    results[name] = ExtractionResultSchema.parse({
      value: 'yes',
      confidence: 0.9,
      raw_transcript: `Mock transcript for ${name}`,
    });
  }
  return results;
}

export function getMockSummary(patientName: string): Isbarr {
  return IsbarrSchema.parse({
    identify: `Patient: ${patientName}`,
    situation: 'Post-discharge follow-up triage call completed.',
    background: 'Patient was recently discharged and screened via automated voice triage.',
    assessment: 'No urgent concerns identified during screening.',
    recommendation: 'Continue current care plan. Schedule routine follow-up.',
    read_back: 'Summary reviewed and confirmed.',
  });
}

export function getMockKBResults(): KBResult[] {
  return [
    KBResultSchema.parse({
      content: 'Heart failure patients should be monitored for weight gain, shortness of breath, and medication adherence.',
      score: 0.92,
      source_uri: 'guidelines/heart-failure-discharge.pdf',
    }),
    KBResultSchema.parse({
      content: 'Post-discharge follow-up within 7 days reduces readmission rates by 30%.',
      score: 0.87,
      source_uri: 'guidelines/readmission-prevention.pdf',
    }),
  ];
}
