import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { rejectHandler } from '../handler';
import type { RejectHandlerDeps } from '../handler';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const dynamoSend = jest.fn();
const verifyJwt  = jest.fn().mockResolvedValue({ sub: 'nurse-001' });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(): RejectHandlerDeps {
  return {
    dynamo:       { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    reviewsTable: 'ProtocolReview',
    verifyJwt,
  };
}

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/reject', {
    method:  'POST',
    headers: {
      Authorization:  'Bearer valid.jwt.token',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

const validBody = { review_id: 'REV-001', rejection_reason: 'Protocol questions are incorrect for this patient' };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rejectHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyJwt.mockResolvedValue({ sub: 'nurse-001' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const request = new Request('http://localhost/api/reject', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(validBody),
      });
      const res = await rejectHandler(request, makeDeps());
      expect(res.status).toBe(401);
    });

    it('returns 401 when verifyJwt throws', async () => {
      verifyJwt.mockRejectedValueOnce(new Error('Token expired'));
      const res = await rejectHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });
  });

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------

  describe('input validation', () => {
    it('returns 400 when review_id is missing', async () => {
      const res = await rejectHandler(
        makeRequest({ rejection_reason: 'bad protocol' }),
        makeDeps(),
      );
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('review_id');
    });

    it('returns 400 when rejection_reason is missing', async () => {
      const res = await rejectHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());
      expect(res.status).toBe(400);
    });

    it('returns 400 when rejection_reason is empty string (min(1) enforced)', async () => {
      const res = await rejectHandler(
        makeRequest({ review_id: 'REV-001', rejection_reason: '' }),
        makeDeps(),
      );
      expect(res.status).toBe(400);
    });

    it('returns 400 when review_id is empty string', async () => {
      const res = await rejectHandler(
        makeRequest({ review_id: '', rejection_reason: 'some reason' }),
        makeDeps(),
      );
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 with { data: { review_id, status: REJECTED } }', async () => {
      dynamoSend.mockResolvedValueOnce({});

      const res = await rejectHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { review_id: string; status: string } };
      expect(body.data.review_id).toBe('REV-001');
      expect(body.data.status).toBe('REJECTED');
    });

    it('UpdateCommand uses ExpressionAttributeNames #s = status', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await rejectHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const names = arg.input['ExpressionAttributeNames'] as Record<string, string>;
      expect(names['#s']).toBe('status');
    });

    it('UpdateCommand sets status to REJECTED', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await rejectHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const values = arg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':rejected']).toBe('REJECTED');
    });

    it('UpdateCommand stores the rejection_reason string', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await rejectHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      const values = arg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':reason']).toBe('Protocol questions are incorrect for this patient');
    });

    it('UpdateCommand targets ProtocolReview table with review_id key', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await rejectHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['TableName']).toBe('ProtocolReview');
      expect(arg.input['Key']).toEqual({ review_id: 'REV-001' });
    });

    it('UpdateCommand includes ConditionExpression attribute_exists(review_id)', async () => {
      dynamoSend.mockResolvedValueOnce({});

      await rejectHandler(makeRequest(validBody), makeDeps());

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['ConditionExpression']).toBe('attribute_exists(review_id)');
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

      const res = await rejectHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('REV-001');
    });

    it('returns 500 on generic DynamoDB error', async () => {
      dynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const res = await rejectHandler(makeRequest(validBody), makeDeps());
      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Internal server error');
    });
  });
});
