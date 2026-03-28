import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { readBackHandler } from '../handler';
import type { ReadBackHandlerDeps } from '../handler';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const dynamoSend = jest.fn();
const verifyJwt  = jest.fn().mockResolvedValue({ sub: 'nurse-001' });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(): ReadBackHandlerDeps {
  return {
    dynamo:       { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    resultsTable: 'CallResults',
    verifyJwt,
  };
}

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/readback', {
    method:  'POST',
    headers: {
      Authorization:  'Bearer valid.jwt.token',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const validBody = { call_id: 'CALL-001', read_back: 'Patient confirmed all instructions and follow-up plan.' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('readBackHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyJwt.mockResolvedValue({ sub: 'nurse-001' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const request = new Request('http://localhost/api/readback', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(validBody),
      });
      const res = await readBackHandler(request, makeDeps());
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('Authorization');
    });

    it('returns 401 when verifyJwt throws', async () => {
      verifyJwt.mockRejectedValueOnce(new Error('Token expired'));
      const res = await readBackHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('input validation', () => {
    it('returns 400 when call_id is missing', async () => {
      const res = await readBackHandler(
        makeRequest({ read_back: 'Patient confirmed all instructions.' }),
        makeDeps(),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('call_id');
    });

    it('returns 400 when read_back is missing', async () => {
      const res = await readBackHandler(
        makeRequest({ call_id: 'CALL-001' }),
        makeDeps(),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('read_back');
    });

    it('returns 400 when read_back is fewer than 10 characters', async () => {
      const res = await readBackHandler(
        makeRequest({ call_id: 'CALL-001', read_back: 'Short' }),
        makeDeps(),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when call_id is an empty string', async () => {
      const res = await readBackHandler(
        makeRequest({ call_id: '', read_back: 'Patient confirmed all instructions.' }),
        makeDeps(),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when body is not valid JSON', async () => {
      const request = new Request('http://localhost/api/readback', {
        method:  'POST',
        headers: { Authorization: 'Bearer valid.jwt.token', 'Content-Type': 'application/json' },
        body:    'not-json',
      });
      const res = await readBackHandler(request, makeDeps());
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 with { data: { call_id, read_back_documented_at } }', async () => {
      dynamoSend.mockResolvedValueOnce({});

      const res = await readBackHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { call_id: string; read_back_documented_at: string } };
      expect(body.data.call_id).toBe('CALL-001');
      expect(typeof body.data.read_back_documented_at).toBe('string');
    });

    it('read_back_documented_at is a valid ISO string', async () => {
      dynamoSend.mockResolvedValueOnce({});

      const res = await readBackHandler(makeRequest(validBody), makeDeps());
      const body = await res.json() as { data: { read_back_documented_at: string } };
      const ts = body.data.read_back_documented_at;
      expect(new Date(ts).toISOString()).toBe(ts);
    });

    it('UpdateCommand sets read_back to the submitted value', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await readBackHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const values = arg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':rb']).toBe(validBody.read_back);
    });

    it('UpdateCommand sets read_back_documented_at as ISO string', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await readBackHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const values = arg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      const at = values[':at'] as string;
      expect(typeof at).toBe('string');
      expect(new Date(at).toISOString()).toBe(at);
    });

    it('UpdateCommand targets the correct table and key', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await readBackHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['TableName']).toBe('CallResults');
      expect(arg.input['Key']).toEqual({ call_id: 'CALL-001' });
    });

    it('UpdateCommand ConditionExpression requires attribute_exists(call_id) AND nurse_acknowledged = :true', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await readBackHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['ConditionExpression']).toBe(
        'attribute_exists(call_id) AND nurse_acknowledged = :true',
      );
    });

    it('ExpressionAttributeValues includes :true = true', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await readBackHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const values = arg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':true']).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns 409 with acknowledgement message when DynamoDB throws ConditionalCheckFailedException', async () => {
      const err = new Error('Conditional check failed');
      err.name = 'ConditionalCheckFailedException';
      dynamoSend.mockRejectedValueOnce(err);

      const res = await readBackHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(409);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Call must be acknowledged before documenting read-back');
    });

    it('returns 500 on generic DynamoDB error', async () => {
      dynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const res = await readBackHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Internal server error');
    });
  });
});
