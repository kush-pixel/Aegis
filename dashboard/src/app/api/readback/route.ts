import type { NextRequest } from 'next/server';
import { createDynamoClient } from '@/lib/dynamo';
import { createJwtVerifier } from '@/lib/auth';
import { readBackHandler } from './handler';

const dynamo       = createDynamoClient();
const verifyJwt    = createJwtVerifier();
const resultsTable = process.env['DYNAMO_TABLE_RESULTS'] ?? 'CallResults';

export async function POST(request: NextRequest): Promise<Response> {
  return readBackHandler(request, { dynamo, resultsTable, verifyJwt });
}
