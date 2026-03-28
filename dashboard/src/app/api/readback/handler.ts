import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { z } from 'zod';
import { extractBearerToken } from '@/lib/auth';
import type { JwtVerifier } from '@/lib/auth';

const ReadBackBodySchema = z.object({
  call_id:   z.string().min(1),
  read_back: z.string().min(10),
});

export interface ReadBackHandlerDeps {
  dynamo:       DynamoDBDocumentClient;
  resultsTable: string;
  verifyJwt:    JwtVerifier;
}

export async function readBackHandler(
  request: Request,
  deps: ReadBackHandlerDeps,
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

  let body: z.infer<typeof ReadBackBodySchema>;
  try {
    const raw = await request.json() as unknown;
    body = ReadBackBodySchema.parse(raw);
  } catch {
    return Response.json(
      { error: 'Invalid request body: call_id and read_back (min 10 characters) are required' },
      { status: 400 },
    );
  }

  const documentedAt = new Date().toISOString();

  try {
    await deps.dynamo.send(
      new UpdateCommand({
        TableName:        deps.resultsTable,
        Key:              { call_id: body.call_id },
        UpdateExpression: 'SET read_back = :rb, read_back_documented_at = :at',
        ExpressionAttributeValues: {
          ':rb':   body.read_back,
          ':at':   documentedAt,
          ':true': true,
        },
        ConditionExpression: 'attribute_exists(call_id) AND nurse_acknowledged = :true',
      }),
    );
  } catch (err) {
    const isConditionalFail =
      err instanceof Error && err.name === 'ConditionalCheckFailedException';
    if (isConditionalFail) {
      return Response.json(
        { error: 'Call must be acknowledged before documenting read-back' },
        { status: 409 },
      );
    }
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  return Response.json({
    data: { call_id: body.call_id, read_back_documented_at: documentedAt },
  });
}
