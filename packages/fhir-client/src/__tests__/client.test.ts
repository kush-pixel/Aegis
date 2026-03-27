import { createMedplumClient, authenticateWithPassword } from '../client';
import { MedplumClient } from '@medplum/core';

jest.setTimeout(30000);

const BASE_URL = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
const ADMIN_EMAIL = process.env['MEDPLUM_ADMIN_EMAIL'] ?? 'admin2@example.com';
const ADMIN_PASSWORD = process.env['MEDPLUM_ADMIN_PASSWORD'] ?? 'medplum12';

describe('createMedplumClient', () => {
  it('returns a MedplumClient instance', () => {
    const client = createMedplumClient(BASE_URL);
    expect(client).toBeInstanceOf(MedplumClient);
  });

  it('returns a MedplumClient when no baseUrl arg is provided', () => {
    const client = createMedplumClient();
    expect(client).toBeInstanceOf(MedplumClient);
  });

  it('normalizes baseUrl without trailing slash', () => {
    const client = createMedplumClient('http://localhost:8103');
    expect(client).toBeInstanceOf(MedplumClient);
  });
});

describe('authenticateWithPassword', () => {
  it('authenticates successfully with valid admin credentials', async () => {
    const client = createMedplumClient(BASE_URL);
    await expect(
      authenticateWithPassword(client, ADMIN_EMAIL, ADMIN_PASSWORD),
    ).resolves.toBeUndefined();
  });

  it('throws when given invalid credentials', async () => {
    const client = createMedplumClient(BASE_URL);
    await expect(
      authenticateWithPassword(client, 'bad@example.com', 'wrongpassword'),
    ).rejects.toThrow();
  });
});
