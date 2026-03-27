import { mapToPatientProfile } from '../profile-mapper';
import { FhirValidationError } from '../errors';
import type { Patient, Condition } from '@medplum/fhirtypes';

const EXT_BASE = 'https://aegis.health/fhir/extensions/';

function makeFullPatient(): Patient {
  return {
    resourceType: 'Patient',
    id: 'p-test-001',
    name: [{ text: 'Jane Doe' }],
    telecom: [{ system: 'phone', value: '555-1234' }],
    extension: [
      { url: `${EXT_BASE}discharge-date`, valueString: '2026-03-01' },
      { url: `${EXT_BASE}lace-score`, valueInteger: 8 },
      { url: `${EXT_BASE}hospital-score`, valueInteger: 5 },
      { url: `${EXT_BASE}composite-risk-score`, valueDecimal: 62.5 },
      { url: `${EXT_BASE}risk-level`, valueString: 'MODERATE' },
    ],
  };
}

function makeCondition(code: string, system: string): Condition {
  return {
    resourceType: 'Condition',
    subject: { reference: 'Patient/p-test-001' },
    code: { coding: [{ system, code }] },
  };
}

describe('mapToPatientProfile', () => {
  describe('successful mapping', () => {
    it('maps all fields correctly from a full patient with text name', () => {
      const patient = makeFullPatient();
      const conditions = [makeCondition('I50.9', 'http://hl7.org/fhir/sid/icd-10-cm')];
      const result = mapToPatientProfile(patient, conditions);
      expect(result).toEqual({
        patient_id: 'p-test-001',
        name: 'Jane Doe',
        phone: '555-1234',
        discharge_date: '2026-03-01',
        conditions: ['I50.9'],
        lace_score: 8,
        hospital_score: 5,
        composite_risk_score: 62.5,
        risk_level: 'MODERATE',
      });
    });

    it('assembles name from given and family when text is absent', () => {
      const patient = makeFullPatient();
      patient.name = [{ given: ['John', 'A'], family: 'Smith' }];
      const result = mapToPatientProfile(patient, []);
      expect(result.name).toBe('John A Smith');
    });

    it('uses only family when given array is absent', () => {
      const patient = makeFullPatient();
      patient.name = [{ family: 'Smith' }];
      const result = mapToPatientProfile(patient, []);
      expect(result.name).toBe('Smith');
    });

    it('uses only given when family is absent', () => {
      const patient = makeFullPatient();
      patient.name = [{ given: ['John'] }];
      const result = mapToPatientProfile(patient, []);
      expect(result.name).toBe('John');
    });

    it('filters out non-ICD-10 condition codings', () => {
      const patient = makeFullPatient();
      const conditions = [
        makeCondition('I50.9', 'http://hl7.org/fhir/sid/icd-10-cm'),
        makeCondition('SNOMED-001', 'http://snomed.info/sct'),
      ];
      const result = mapToPatientProfile(patient, conditions);
      expect(result.conditions).toEqual(['I50.9']);
    });

    it('returns empty conditions when no ICD-10 codings present', () => {
      const patient = makeFullPatient();
      const conditions = [makeCondition('SNOMED-001', 'http://snomed.info/sct')];
      const result = mapToPatientProfile(patient, conditions);
      expect(result.conditions).toEqual([]);
    });

    it('returns empty conditions when conditions array is empty', () => {
      const patient = makeFullPatient();
      const result = mapToPatientProfile(patient, []);
      expect(result.conditions).toEqual([]);
    });

    it('extracts phone from telecom with system=phone when mixed entries present', () => {
      const patient = makeFullPatient();
      patient.telecom = [
        { system: 'email', value: 'test@example.com' },
        { system: 'phone', value: '555-9999' },
      ];
      const result = mapToPatientProfile(patient, []);
      expect(result.phone).toBe('555-9999');
    });

    it('maps multiple ICD-10 codes from multiple conditions', () => {
      const patient = makeFullPatient();
      const conditions = [
        makeCondition('I50.9', 'http://hl7.org/fhir/sid/icd-10-cm'),
        makeCondition('E11.9', 'http://hl7.org/fhir/sid/icd-10-cm'),
      ];
      const result = mapToPatientProfile(patient, conditions);
      expect(result.conditions).toEqual(['I50.9', 'E11.9']);
    });

    it('maps risk_level HIGH correctly', () => {
      const patient = makeFullPatient();
      patient.extension = patient.extension!.map((e) =>
        e.url === `${EXT_BASE}risk-level` ? { ...e, valueString: 'HIGH' } : e,
      );
      const result = mapToPatientProfile(patient, []);
      expect(result.risk_level).toBe('HIGH');
    });

    it('maps risk_level VERY_HIGH correctly', () => {
      const patient = makeFullPatient();
      patient.extension = patient.extension!.map((e) =>
        e.url === `${EXT_BASE}risk-level` ? { ...e, valueString: 'VERY_HIGH' } : e,
      );
      const result = mapToPatientProfile(patient, []);
      expect(result.risk_level).toBe('VERY_HIGH');
    });

    it('maps risk_level LOW correctly', () => {
      const patient = makeFullPatient();
      patient.extension = patient.extension!.map((e) =>
        e.url === `${EXT_BASE}risk-level` ? { ...e, valueString: 'LOW' } : e,
      );
      const result = mapToPatientProfile(patient, []);
      expect(result.risk_level).toBe('LOW');
    });

    it('defaults numeric scores to 0 and risk_level to LOW when numeric/risk extensions absent', () => {
      const patient = makeFullPatient();
      // Keep discharge-date extension but remove score extensions
      patient.extension = [{ url: `${EXT_BASE}discharge-date`, valueString: '2026-03-01' }];
      const result = mapToPatientProfile(patient, []);
      expect(result.lace_score).toBe(0);
      expect(result.hospital_score).toBe(0);
      expect(result.composite_risk_score).toBe(0);
      expect(result.risk_level).toBe('LOW');
    });

    it('handles condition with no code.coding array (empty)', () => {
      const patient = makeFullPatient();
      const condition: Condition = {
        resourceType: 'Condition',
        subject: { reference: 'Patient/p-test-001' },
        code: { coding: [] },
      };
      const result = mapToPatientProfile(patient, [condition]);
      expect(result.conditions).toEqual([]);
    });
  });

  describe('FhirValidationError on schema failure', () => {
    it('throws FhirValidationError when patient_id is missing', () => {
      const patient = makeFullPatient();
      delete patient.id;
      expect(() => mapToPatientProfile(patient, [])).toThrow(FhirValidationError);
    });

    it('throws FhirValidationError when name resolves to empty string', () => {
      const patient = makeFullPatient();
      patient.name = [];
      expect(() => mapToPatientProfile(patient, [])).toThrow(FhirValidationError);
    });

    it('throws FhirValidationError when phone telecom is absent', () => {
      const patient = makeFullPatient();
      patient.telecom = [];
      expect(() => mapToPatientProfile(patient, [])).toThrow(FhirValidationError);
    });

    it('throws FhirValidationError when risk_level extension has invalid value', () => {
      const patient = makeFullPatient();
      patient.extension = patient.extension!.map((e) =>
        e.url === `${EXT_BASE}risk-level` ? { ...e, valueString: 'EXTREME' } : e,
      );
      expect(() => mapToPatientProfile(patient, [])).toThrow(FhirValidationError);
    });

    it('throws FhirValidationError when lace_score exceeds 19', () => {
      const patient = makeFullPatient();
      patient.extension = patient.extension!.map((e) =>
        e.url === `${EXT_BASE}lace-score` ? { ...e, valueInteger: 25 } : e,
      );
      expect(() => mapToPatientProfile(patient, [])).toThrow(FhirValidationError);
    });

    it('throws FhirValidationError when hospital_score exceeds 13', () => {
      const patient = makeFullPatient();
      patient.extension = patient.extension!.map((e) =>
        e.url === `${EXT_BASE}hospital-score` ? { ...e, valueInteger: 20 } : e,
      );
      expect(() => mapToPatientProfile(patient, [])).toThrow(FhirValidationError);
    });

    it('throws FhirValidationError when discharge_date extension is absent (empty string)', () => {
      const patient = makeFullPatient();
      patient.extension = patient.extension!.filter(
        (e) => e.url !== `${EXT_BASE}discharge-date`,
      );
      expect(() => mapToPatientProfile(patient, [])).toThrow(FhirValidationError);
    });
  });
});
