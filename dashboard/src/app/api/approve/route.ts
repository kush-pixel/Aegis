import type { NextRequest } from 'next/server';
import { createDynamoClient } from '@/lib/dynamo';
import { createJwtVerifier } from '@/lib/auth';
import { approveHandler } from './handler';

const dynamo         = createDynamoClient();
const verifyJwt      = createJwtVerifier();
const reviewsTable   = process.env['DYNAMO_TABLE_REVIEWS']   ?? 'ProtocolReview';
const protocolsTable = process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols';

export async function POST(request: NextRequest): Promise<Response> {
  return approveHandler(request, { dynamo, reviewsTable, protocolsTable, verifyJwt });
}
