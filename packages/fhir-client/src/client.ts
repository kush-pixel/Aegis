import { MedplumClient } from '@medplum/core';
import type { IClientStorage } from '@medplum/core';

export function makeNodeStorage(): IClientStorage {
  const data = new Map<string, string>();
  return {
    clear: (): void => { data.clear(); },
    getString: (key: string): string | undefined => data.get(key),
    setString: (key: string, value: string | undefined): void => {
      if (value === undefined) { data.delete(key); } else { data.set(key, value); }
    },
    getObject: <T>(key: string): T | undefined => {
      const s = data.get(key);
      return s !== undefined ? (JSON.parse(s) as T) : undefined;
    },
    setObject: <T>(key: string, value: T): void => {
      data.set(key, JSON.stringify(value));
    },
  };
}

export function createMedplumClient(baseUrl?: string): MedplumClient {
  const url = baseUrl ?? process.env['MEDPLUM_BASE_URL'] ?? 'http://localhost:8103/';
  const normalizedUrl = url.endsWith('/') ? url : `${url}/`;
  return new MedplumClient({ baseUrl: normalizedUrl, storage: makeNodeStorage() });
}

export async function authenticateClient(
  client: MedplumClient,
  clientId: string,
  clientSecret: string,
): Promise<void> {
  await client.startClientLogin(clientId, clientSecret);
}

export async function authenticateWithPassword(
  client: MedplumClient,
  email: string,
  password: string,
): Promise<void> {
  const response = await client.startLogin({ email, password });
  await client.processCode(response.code ?? '');
}
