import type { MedplumClient } from '@medplum/core';
import type { Observation } from '@medplum/fhirtypes';

export async function getPatientObservations(
  client: MedplumClient,
  patientId: string,
  code?: string,
): Promise<Observation[]> {
  const params: Record<string, string> = { patient: patientId };
  if (code !== undefined) {
    params['code'] = code;
  }
  const results = await client.searchResources('Observation', params);
  return Array.from(results);
}

export async function createObservation(
  client: MedplumClient,
  resource: Observation,
): Promise<Observation> {
  return client.createResource(resource);
}
