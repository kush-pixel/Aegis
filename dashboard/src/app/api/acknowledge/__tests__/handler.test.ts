import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { acknowledgeHandler } from '../handler';
import type { AcknowledgeHandlerDeps } from '../handler';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const dynamoSend = jest.fn();
const verifyJwt  = jest.fn().mockResolvedValue({ sub: 'nurse-001' });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(): AcknowledgeHandlerDeps {
  return {
    dynamo:       { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    resultsTable: 'CallResults',
    verifyJwt,
  };
}

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/acknowledge', {
    method:  'POST',
    headers: {
      Authorization:  'Bearer valid.jwt.token',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('acknowledgeHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyJwt.mockResolvedValue({ sub: 'nurse-001' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const request = new Request('http://localhost/api/acknowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call_id: 'CALL-001' }),
      });
      const res = await acknowledgeHandler(request, makeDeps());
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('Authorization');
    });

    it('returns 401 when verifyJwt throws', async () => {
      verifyJwt.mockRejectedValueOnce(new Error('Token expired'));
      const res = await acknowledgeHandler(makeRequest({ call_id: 'CALL-001' }), makeDeps());
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('input validation', () => {
    it('returns 400 when call_id is missing from body', async () => {
      const res = await acknowledgeHandler(makeRequest({}), makeDeps());
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('call_id');
    });

    it('returns 400 when call_id is an empty string', async () => {
      const res = await acknowledgeHandler(makeRequest({ call_id: '' }), makeDeps());
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is not valid JSON', async () => {
      const request = new Request('http://localhost/api/acknowledge', {
        method:  'POST',
        headers: { Authorization: 'Bearer valid.jwt.token', 'Content-Type': 'application/json' },
        body:    'not-json',
      });
      const res = await acknowledgeHandler(request, makeDeps());
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 with { data: { call_id, nurse_acknowledged: true } }', async () => {
      dynamoSend.mockResolvedValueOnce({});

      const res = await acknowledgeHandler(makeRequest({ call_id: 'CALL-001' }), makeDeps());
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { call_id: string; nurse_acknowledged: boolean } };
      expect(body.data.call_id).toBe('CALL-001');
      expect(body.data.nurse_acknowledged).toBe(true);
    });

    it('UpdateCommand sets nurse_acknowledged = true', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await acknowledgeHandler(makeRequest({ call_id: 'CALL-001' }), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const values = arg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':ack']).toBe(true);
    });

    it('UpdateCommand sets nurse_acknowledged_at as ISO string', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await acknowledgeHandler(makeRequest({ call_id: 'CALL-001' }), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const values = arg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      const at = values[':at'] as string;
      expect(typeof at).toBe('string');
      expect(new Date(at).toISOString()).toBe(at);
    });

    it('UpdateCommand targets the correct table and key', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await acknowledgeHandler(makeRequest({ call_id: 'CALL-001' }), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['TableName']).toBe('CallResults');
      expect(arg.input['Key']).toEqual({ call_id: 'CALL-001' });
    });

    it('UpdateCommand includes ConditionExpression attribute_exists(call_id)', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await acknowledgeHandler(makeRequest({ call_id: 'CALL-001' }), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['ConditionExpression']).toBe('attribute_exists(call_id)');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns 404 when DynamoDB throws ConditionalCheckFailedException', async () => {
      const err = new Error('Conditional check failed');
      err.name = 'ConditionalCheckFailedException';
      dynamoSend.mockRejectedValueOnce(err);

      const res = await acknowledgeHandler(makeRequest({ call_id: 'CALL-999' }), makeDeps());
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('CALL-999');
    });

    it('returns 500 on generic DynamoDB error', async () => {
      dynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const res = await acknowledgeHandler(makeRequest({ call_id: 'CALL-001' }), makeDeps());
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Internal server error');
    });
  });
});
