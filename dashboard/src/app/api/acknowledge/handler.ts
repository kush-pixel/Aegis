import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { extractBearerToken } from '@/lib/auth';
import type { JwtVerifier } from '@/lib/auth';

const AcknowledgeBodySchema = z.object({
  call_id: z.string().min(1),
});

export interface AcknowledgeHandlerDeps {
  dynamo:       DynamoDBDocumentClient;
  resultsTable: string;
  verifyJwt:    JwtVerifier;
}

export async function acknowledgeHandler(
  request: Request,
  deps: AcknowledgeHandlerDeps,
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

  let body: z.infer<typeof AcknowledgeBodySchema>;
  try {
    const raw = await request.json() as unknown;
    body = AcknowledgeBodySchema.parse(raw);
  } catch {
    return Response.json(
      { error: 'Invalid request body: call_id is required' },
      { status: 400 },
    );
  }

  try {
    await deps.dynamo.send(
      new UpdateCommand({
        TableName:        deps.resultsTable,
        Key:              { call_id: body.call_id },
        UpdateExpression: 'SET nurse_acknowledged = :ack, nurse_acknowledged_at = :at',
        ExpressionAttributeValues: {
          ':ack': true,
          ':at':  new Date().toISOString(),
        },
        ConditionExpression: 'attribute_exists(call_id)',
      }),
    );
  } catch (err) {
    const isConditionalFail =
      err instanceof Error && err.name === 'ConditionalCheckFailedException';
    if (isConditionalFail) {
      return Response.json(
        { error: `CallResult not found: ${body.call_id}` },
        { status: 404 },
      );
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  return Response.json({
    data: { call_id: body.call_id, nurse_acknowledged: true },
  });
}
