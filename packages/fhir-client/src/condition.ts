import type { MedplumClient } from '@medplum/core';
import type { Condition } from '@medplum/fhirtypes';

export async function getPatientConditions(
  client: MedplumClient,
  patientId: string,
): Promise<Condition[]> {
  const results = await client.searchResources('Condition', {
    patient: patientId,
    'clinical-status': 'active',
  });
  return Array.from(results);
}

export async function createCondition(
  client: MedplumClient,
  resource: Condition,
): Promise<Condition> {
  return client.createResource(resource);
}
