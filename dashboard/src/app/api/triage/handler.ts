import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { CallResultSchema } from '@aegis/schemas';
import { extractBearerToken } from '@/lib/auth';
import type { JwtVerifier } from '@/lib/auth';

export interface TriageHandlerDeps {
  dynamo:       DynamoDBDocumentClient;
  resultsTable: string;
  verifyJwt:    JwtVerifier;
}

export async function triageHandler(
  request: Request,
  deps: TriageHandlerDeps,
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

  const url       = new URL(request.url);
  const patientId = url.searchParams.get('patient_id');

  let items: unknown[];
  try {
    if (patientId !== null && patientId.trim().length > 0) {
      // Path A: query by patient_id
      const result = await deps.dynamo.send(
        new QueryCommand({
          TableName:                 deps.resultsTable,
          IndexName:                 'patient_id-call_timestamp-index',
          KeyConditionExpression:    'patient_id = :pid',
          ExpressionAttributeValues: { ':pid': patientId },
          ScanIndexForward:          false,
        }),
      );
      items = result.Items ?? [];
    } else {
      // Path B: all completed calls for the nurse dashboard
      const result = await deps.dynamo.send(
        new QueryCommand({
          TableName:                 deps.resultsTable,
          IndexName:                 'call_status-triage_completed_at-index',
          KeyConditionExpression:    'call_status = :complete',
          ExpressionAttributeValues: { ':complete': 'COMPLETE' },
          ScanIndexForward:          false,
        }),
      );
      items = result.Items ?? [];
    }
  } catch {
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }

  const data = items.map((item) => CallResultSchema.parse(item));
  return Response.json({ data });
}
