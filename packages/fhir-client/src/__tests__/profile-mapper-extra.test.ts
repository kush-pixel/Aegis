import type { Patient, Condition } from '@medplum/fhirtypes';
import { mapToPatientProfile } from '../profile-mapper';

const EXT_BASE = 'https://aegis.health/fhir/extensions/';

const basePatient: Patient = {
  resourceType: 'Patient',
  id: 'p-extra-001',
  name: [{ text: 'Extra Test Patient' }],
  telecom: [{ system: 'phone', value: '555-9999' }],
  extension: [
    { url: `${EXT_BASE}discharge-date`, valueString: '2024-01-15' },
    { url: `${EXT_BASE}risk-level`, valueString: 'LOW' },
  ],
};

describe('extractIcd10Codes — missing code branch', () => {
  it('skips conditions that have no code property', () => {
    const conditionWithoutCode: Condition = {
      resourceType: 'Condition',
      subject: { reference: 'Patient/p-extra-001' },
    };
    const profile = mapToPatientProfile(basePatient, [conditionWithoutCode]);
    expect(profile.conditions).toEqual([]);
  });

  it('skips coding entries with a different system', () => {
    const conditionOtherSystem: Condition = {
      resourceType: 'Condition',
      subject: { reference: 'Patient/p-extra-001' },
      code: {
        coding: [{ system: 'http://snomed.info/sct', code: '84114007' }],
      },
    };
    const profile = mapToPatientProfile(basePatient, [conditionOtherSystem]);
    expect(profile.conditions).toEqual([]);
  });
});
