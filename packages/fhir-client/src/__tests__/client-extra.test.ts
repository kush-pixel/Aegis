import { MedplumClient } from '@medplum/core';
import { createMedplumClient, authenticateClient, authenticateWithPassword, makeNodeStorage } from '../client';

jest.setTimeout(30000);

const BASE_URL = process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
const ADMIN_EMAIL = process.env['MEDPLUM_ADMIN_EMAIL'] ?? 'admin2@example.com';
const ADMIN_PASSWORD = process.env['MEDPLUM_ADMIN_PASSWORD'] ?? 'medplum12';

describe('authenticateClient', () => {
  it('throws when given invalid client credentials', async () => {
    const client = createMedplumClient(BASE_URL);
    await expect(
      authenticateClient(client, 'invalid-client-id', 'invalid-client-secret'),
    ).rejects.toThrow();
  });
});

describe('storage.clear via client.clear()', () => {
  it('covers storage.clear — getActiveLogin returns undefined after clear', async () => {
    const client = createMedplumClient(BASE_URL);
    await authenticateWithPassword(client, ADMIN_EMAIL, ADMIN_PASSWORD);
    expect(client.getActiveLogin()).toBeDefined();
    client.clear();
    expect(client.getActiveLogin()).toBeUndefined();
  });
});

describe('authenticateWithPassword — missing code branch', () => {
  it('calls processCode with empty string when response has no code', async () => {
    const mockClient = {
      startLogin: jest.fn().mockResolvedValue({}),
      processCode: jest.fn().mockResolvedValue(undefined),
    } as unknown as MedplumClient;
    await authenticateWithPassword(mockClient, 'test@example.com', 'testpass123');
    expect(mockClient.processCode).toHaveBeenCalledWith('');
  });
});

describe('makeNodeStorage unit', () => {
  it('getString returns undefined for missing key', () => {
    const storage = makeNodeStorage();
    expect(storage.getString('nonexistent')).toBeUndefined();
  });

  it('getString returns the string after setString', () => {
    const storage = makeNodeStorage();
    storage.setString('key', 'value');
    expect(storage.getString('key')).toBe('value');
  });

  it('setString with undefined deletes the key', () => {
    const storage = makeNodeStorage();
    storage.setString('key', 'value');
    storage.setString('key', undefined);
    expect(storage.getString('key')).toBeUndefined();
  });

  it('getObject returns undefined for missing key', () => {
    const storage = makeNodeStorage();
    expect(storage.getObject('missing')).toBeUndefined();
  });

  it('clear removes all stored data', () => {
    const storage = makeNodeStorage();
    storage.setString('k1', 'v1');
    storage.setObject('k2', { x: 1 });
    storage.clear();
    expect(storage.getString('k1')).toBeUndefined();
    expect(storage.getObject('k2')).toBeUndefined();
  });
});
