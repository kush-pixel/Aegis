import { MedplumClient } from '@medplum/core';
import type { Patient, Observation } from '@medplum/fhirtypes';
import { createMedplumClient, authenticateWithPassword } from '../client';
import { createPatient } from '../patient';
import { getPatientObservations, createObservation } from '../observation';

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
    name: [{ text: 'Observation Test Patient' }],
  };
  const created = await createPatient(client, patient);
  patientId = created.id as string;
});

afterAll(async () => {
  if (patientId) {
    await client.deleteResource('Patient', patientId);
  }
});

describe('getPatientObservations', () => {
  it('returns empty array when patient has no observations', async () => {
    const result = await getPatientObservations(client, patientId);
    expect(result).toEqual([]);
  });

  it('returns empty array when filtering by code with no matching observations', async () => {
    const result = await getPatientObservations(client, patientId, '29463-7');
    expect(result).toEqual([]);
  });
});

describe('createObservation', () => {
  it('creates an Observation linked to a patient and returns it with an id', async () => {
    const resource: Observation = {
      resourceType: 'Observation',
      status: 'final',
      subject: { reference: `Patient/${patientId}` },
      code: {
        coding: [{ system: 'http://loinc.org', code: '29463-7', display: 'Body weight' }],
      },
      valueQuantity: { value: 70, unit: 'kg' },
    };
    const result = await createObservation(client, resource);
    expect(result.id).toBeDefined();
    expect(result.resourceType).toBe('Observation');
  });
});

describe('getPatientObservations after creating observation', () => {
  it('returns all observations for the patient', async () => {
    const results = await getPatientObservations(client, patientId);
    expect(results.length).toBeGreaterThan(0);
  });

  it('returns observations filtered by LOINC code', async () => {
    const results = await getPatientObservations(client, patientId, '29463-7');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.code?.coding?.[0]?.code).toBe('29463-7');
  });

  it('returns empty array when filtering by a different code', async () => {
    const results = await getPatientObservations(client, patientId, '8302-2');
    expect(results).toEqual([]);
  });
});
