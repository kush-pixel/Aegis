import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { extractBearerToken } from '@/lib/auth';
import type { JwtVerifier } from '@/lib/auth';

const RejectBodySchema = z.object({
  review_id:        z.string().min(1),
  rejection_reason: z.string().min(1),
});

export interface RejectHandlerDeps {
  dynamo:       DynamoDBDocumentClient;
  reviewsTable: string;
  verifyJwt:    JwtVerifier;
}

export async function rejectHandler(
  request: Request,
  deps: RejectHandlerDeps,
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

  let body: z.infer<typeof RejectBodySchema>;
  try {
    const raw = await request.json() as unknown;
    body = RejectBodySchema.parse(raw);
  } catch {
    return Response.json(
      { error: 'Invalid request body: review_id and rejection_reason are required' },
      { status: 400 },
    );
  }

  try {
    await deps.dynamo.send(
      new UpdateCommand({
        TableName:        deps.reviewsTable,
        Key:              { review_id: body.review_id },
        UpdateExpression: 'SET #s = :rejected, rejection_reason = :reason, rejected_at = :at',
        ExpressionAttributeNames:  { '#s': 'status' },
        ExpressionAttributeValues: {
          ':rejected': 'REJECTED',
          ':reason':   body.rejection_reason,
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

  return Response.json({
    data: { review_id: body.review_id, status: 'REJECTED' },
  });
}
