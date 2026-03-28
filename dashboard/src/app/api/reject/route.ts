import type { NextRequest } from 'next/server';
import { createDynamoClient } from '@/lib/dynamo';
import { createJwtVerifier } from '@/lib/auth';
import { rejectHandler } from './handler';

const dynamo       = createDynamoClient();
const verifyJwt    = createJwtVerifier();
const reviewsTable = process.env['DYNAMO_TABLE_REVIEWS'] ?? 'ProtocolReview';

export async function POST(request: NextRequest): Promise<Response> {
  return rejectHandler(request, { dynamo, reviewsTable, verifyJwt });
}
