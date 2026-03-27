import { MedplumClient } from '@medplum/core';
import type { Patient, Condition } from '@medplum/fhirtypes';
import { createMedplumClient, authenticateWithPassword } from '../client';
import { createPatient } from '../patient';
import { getPatientConditions, createCondition } from '../condition';

jest.setTimeout(30000);

const BASE_URL = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
const ADMIN_EMAIL = process.env['MEDPLUM_ADMIN_EMAIL'] ?? 'admin2@example.com';
const ADMIN_PASSWORD = process.env['MEDPLUM_ADMIN_PASSWORD'] ?? 'medplum12';

let client: MedplumClient;
let patientId: string;

beforeAll(async () => {
  client = createMedplumClient(BASE_URL);
  await authenticateWithPassword(client, ADMIN_EMAIL, ADMIN_PASSWORD);

  const patient: Patient = {
    resourceType: 'Patient',
    name: [{ text: 'Condition Test Patient' }],
  };
  const created = await createPatient(client, patient);
  patientId = created.id as string;
});

afterAll(async () => {
  if (patientId) {
    await client.deleteResource('Patient', patientId);
  }
});

describe('getPatientConditions', () => {
  it('returns empty array when patient has no conditions', async () => {
    const result = await getPatientConditions(client, patientId);
    expect(result).toEqual([]);
  });
});

describe('createCondition', () => {
  it('creates a Condition linked to a patient and returns it with an id', async () => {
    const resource: Condition = {
      resourceType: 'Condition',
      subject: { reference: `Patient/${patientId}` },
      clinicalStatus: {
        coding: [
          {
            system: 'http://terminology.hl7.org/CodeSystem/condition-clinical',
            code: 'active',
          },
        ],
      },
      code: {
        coding: [{ system: 'http://hl7.org/fhir/sid/icd-10-cm', code: 'I50.9' }],
      },
    };
    const result = await createCondition(client, resource);
    expect(result.id).toBeDefined();
    expect(result.resourceType).toBe('Condition');
  });
});

describe('getPatientConditions after creating condition', () => {
  it('returns the active condition for the patient', async () => {
    const results = await getPatientConditions(client, patientId);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.resourceType).toBe('Condition');
  });
});
