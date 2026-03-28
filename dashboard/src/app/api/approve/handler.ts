import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { extractBearerToken } from '@/lib/auth';
import type { JwtVerifier } from '@/lib/auth';

const ApproveBodySchema = z.object({
  review_id: z.string().min(1),
});

export interface ApproveHandlerDeps {
  dynamo:         DynamoDBDocumentClient;
  reviewsTable:   string;
  protocolsTable: string;
  verifyJwt:      JwtVerifier;
}

export async function approveHandler(
  request: Request,
  deps: ApproveHandlerDeps,
): Promise<Response> {
  const token = extractBearerToken(request);
  if (!token) {
    return Response.json(
      { error: 'Missing or invalid Authorization header' },
      { status: 401 },
    );
  }
  try {
    await deps.verifyJwt(token);
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: z.infer<typeof ApproveBodySchema>;
  try {
    const raw = await request.json() as unknown;
    body = ApproveBodySchema.parse(raw);
  } catch {
    return Response.json(
      { error: 'Invalid request body: review_id is required' },
      { status: 400 },
    );
  }

  // Step 1: Read the review to get protocol_id
  let protocolId: string;
  try {
    const reviewResult = await deps.dynamo.send(
      new GetCommand({
        TableName: deps.reviewsTable,
        Key:       { review_id: body.review_id },
      }),
    );
    const item = reviewResult.Item;
    if (!item) {
      return Response.json(
        { error: `ProtocolReview not found: ${body.review_id}` },
        { status: 404 },
      );
    }
    protocolId = item['protocol_id'] as string;
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Step 2: Update ProtocolReview → APPROVED
  try {
    await deps.dynamo.send(
      new UpdateCommand({
        TableName:        deps.reviewsTable,
        Key:              { review_id: body.review_id },
        UpdateExpression: 'SET #s = :approved, approved_at = :at',
        ExpressionAttributeNames:  { '#s': 'status' },
        ExpressionAttributeValues: {
          ':approved': 'APPROVED',
          ':at':       new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(review_id)',
      }),
    );
  } catch (err) {
    const isConditionalFail =
      err instanceof Error && err.name === 'ConditionalCheckFailedException';
    if (isConditionalFail) {
      return Response.json(
        { error: `ProtocolReview not found: ${body.review_id}` },
        { status: 404 },
      );
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  // Step 3: Update TriageProtocols — non-fatal if it fails
  try {
    await deps.dynamo.send(
      new UpdateCommand({
        TableName:        deps.protocolsTable,
        Key:              { protocol_id: protocolId },
        UpdateExpression: 'SET nurse_approved = :t, nurse_approved_at = :at',
        ExpressionAttributeValues: {
          ':t':  true,
          ':at': new Date().toISOString(),
        },
      }),
    );
  } catch {
    return Response.json({
      data: { review_id: body.review_id, status: 'APPROVED', protocol_updated: false },
    });
  }

  return Response.json({
    data: { review_id: body.review_id, status: 'APPROVED', protocol_updated: true },
  });
}
