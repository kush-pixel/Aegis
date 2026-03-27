import type { MedplumClient } from '@medplum/core';
import { OperationOutcomeError } from '@medplum/core';
import { getPatient } from '../patient';

describe('getPatient re-throw branch', () => {
  it('re-throws a generic Error that is not OperationOutcomeError', async () => {
    const networkError = new Error('network error');
    const client = {
      readResource: jest.fn().mockRejectedValue(networkError),
    } as unknown as MedplumClient;

    await expect(getPatient(client, 'some-id')).rejects.toBe(networkError);
  });

  it('re-throws OperationOutcomeError when issue code is not not-found', async () => {
    const opError = new OperationOutcomeError({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'error', code: 'invalid', diagnostics: 'bad request' }],
    });
    const client = {
      readResource: jest.fn().mockRejectedValue(opError),
    } as unknown as MedplumClient;

    await expect(getPatient(client, 'some-id')).rejects.toBe(opError);
  });
});
