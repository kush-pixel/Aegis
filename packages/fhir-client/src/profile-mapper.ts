import type { Patient, Condition, Extension } from '@medplum/fhirtypes';
import { PatientProfileSchema } from '@aegis/schemas';
import type { PatientProfile } from '@aegis/schemas';
import { FhirValidationError } from './errors';

const EXT_BASE = 'https://aegis.health/fhir/extensions/';

function findExtension(extensions: Extension[] | undefined, name: string): Extension | undefined {
  return extensions?.find((e) => e.url === `${EXT_BASE}${name}`);
}

function extractName(patient: Patient): string {
  const nameEntry = patient.name?.[0];
  if (!nameEntry) return '';
  if (nameEntry.text) return nameEntry.text;
  const given = (nameEntry.given ?? []).join(' ');
  const family = nameEntry.family ?? '';
  return `${given} ${family}`.trim();
}

function extractPhone(patient: Patient): string {
  return patient.telecom?.find((t) => t.system === 'phone')?.value ?? '';
}

function extractIcd10Codes(conditions: Condition[]): string[] {
  const codes: string[] = [];
  for (const condition of conditions) {
    for (const coding of condition.code?.coding ?? []) {
      if (coding.system === 'http://hl7.org/fhir/sid/icd-10-cm' && coding.code) {
        codes.push(coding.code);
      }
    }
  }
  return codes;
}

export function mapToPatientProfile(patient: Patient, conditions: Condition[]): PatientProfile {
  const exts = patient.extension;

  const raw = {
    patient_id: patient.id ?? '',
    name: extractName(patient),
    phone: extractPhone(patient),
    discharge_date: findExtension(exts, 'discharge-date')?.valueString ?? '',
    conditions: extractIcd10Codes(conditions),
    lace_score: findExtension(exts, 'lace-score')?.valueInteger ?? 0,
    hospital_score: findExtension(exts, 'hospital-score')?.valueInteger ?? 0,
    composite_risk_score: findExtension(exts, 'composite-risk-score')?.valueDecimal ?? 0,
    risk_level: findExtension(exts, 'risk-level')?.valueString ?? 'LOW',
  };

  const result = PatientProfileSchema.safeParse(raw);
  if (!result.success) {
    throw new FhirValidationError(result.error.message);
  }
  return result.data;
}
