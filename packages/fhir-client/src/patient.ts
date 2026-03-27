import { MedplumClient, OperationOutcomeError } from '@medplum/core';
import type { Patient } from '@medplum/fhirtypes';
import { FhirNotFoundError } from './errors';

export async function getPatient(client: MedplumClient, patientId: string): Promise<Patient> {
  try {
    return await client.readResource('Patient', patientId);
  } catch (err) {
    if (
      err instanceof OperationOutcomeError &&
      err.outcome.issue?.[0]?.code === 'not-found'
    ) {
      throw new FhirNotFoundError('Patient', patientId);
    }
    throw err;
  }
}

export async function createPatient(client: MedplumClient, resource: Patient): Promise<Patient> {
  return client.createResource(resource);
}

export async function updatePatient(client: MedplumClient, patient: Patient): Promise<Patient> {
  return client.updateResource(patient);
}
