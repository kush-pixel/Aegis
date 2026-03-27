import { MedplumClient } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { createMedplumClient, authenticateWithPassword } from '../client';
import { getPatient, createPatient, updatePatient } from '../patient';
import { FhirNotFoundError } from '../errors';

jest.setTimeout(30000);

const BASE_URL = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
const ADMIN_EMAIL = process.env['MEDPLUM_ADMIN_EMAIL'] ?? 'admin2@example.com';
const ADMIN_PASSWORD = process.env['MEDPLUM_ADMIN_PASSWORD'] ?? 'medplum12';

let client: MedplumClient;
let createdPatientId: string;

beforeAll(async () => {
  client = createMedplumClient(BASE_URL);
  await authenticateWithPassword(client, ADMIN_EMAIL, ADMIN_PASSWORD);
});

afterAll(async () => {
  if (createdPatientId) {
    await client.deleteResource('Patient', createdPatientId);
  }
});

describe('createPatient', () => {
  it('creates a Patient and returns it with an assigned id', async () => {
    const resource: Patient = {
      resourceType: 'Patient',
      name: [{ text: 'Test Patient Fhir' }],
      telecom: [{ system: 'phone', value: '555-0100' }],
    };
    const result = await createPatient(client, resource);
    expect(result.id).toBeDefined();
    expect(result.resourceType).toBe('Patient');
    createdPatientId = result.id as string;
  });
});

describe('getPatient', () => {
  it('retrieves an existing Patient by id', async () => {
    const result = await getPatient(client, createdPatientId);
    expect(result.id).toBe(createdPatientId);
    expect(result.resourceType).toBe('Patient');
  });

  it('throws FhirNotFoundError for a non-existent id', async () => {
    await expect(getPatient(client, 'non-existent-id-00000')).rejects.toBeInstanceOf(
      FhirNotFoundError,
    );
  });
});

describe('updatePatient', () => {
  it('updates a Patient and returns the updated resource', async () => {
    const existing = await getPatient(client, createdPatientId);
    const updated: Patient = { ...existing, name: [{ text: 'Updated Patient Name' }] };
    const result = await updatePatient(client, updated);
    expect(result.name?.[0]?.text).toBe('Updated Patient Name');
  });
});
