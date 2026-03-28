import type { NextRequest } from 'next/server';
import { createDynamoClient } from '@/lib/dynamo';
import { createJwtVerifier } from '@/lib/auth';
import { triageHandler } from './handler';

const dynamo       = createDynamoClient();
const verifyJwt    = createJwtVerifier();
const resultsTable = process.env['DYNAMO_TABLE_RESULTS'] ?? 'CallResults';

export async function GET(request: NextRequest): Promise<Response> {
  return triageHandler(request, { dynamo, resultsTable, verifyJwt });
}
