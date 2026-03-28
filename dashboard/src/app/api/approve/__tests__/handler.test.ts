import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { approveHandler } from '../handler';
import type { ApproveHandlerDeps } from '../handler';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const dynamoSend = jest.fn();
const verifyJwt  = jest.fn().mockResolvedValue({ sub: 'nurse-001' });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(): ApproveHandlerDeps {
  return {
    dynamo:         { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    reviewsTable:   'ProtocolReview',
    protocolsTable: 'TriageProtocols',
    verifyJwt,
  };
}

const validReviewItem = {
  review_id:        'REV-001',
  patient_id:       'PAT-001',
  protocol_id:      'PROTO-001',
  status:           'PENDING',
  confidence_score: 0.65,
  created_at:       '2026-03-27T10:00:00.000Z',
};

function makeRequest(body?: unknown): Request {
  return new Request('http://localhost/api/approve', {
    method:  'POST',
    headers: {
      Authorization:  'Bearer valid.jwt.token',
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function setupHappyPath(): void {
  dynamoSend
    .mockResolvedValueOnce({ Item: validReviewItem }) // GetCommand
    .mockResolvedValueOnce({})                        // UpdateCommand — ProtocolReview
    .mockResolvedValueOnce({});                       // UpdateCommand — TriageProtocols
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('approveHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyJwt.mockResolvedValue({ sub: 'nurse-001' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const request = new Request('http://localhost/api/approve', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ review_id: 'REV-001' }),
      });
      const res = await approveHandler(request, makeDeps());
      expect(res.status).toBe(401);
    });

    it('returns 401 when verifyJwt throws', async () => {
      verifyJwt.mockRejectedValueOnce(new Error('Token expired'));
      const res = await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());
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
      const res = await approveHandler(makeRequest({}), makeDeps());
      expect(res.status).toBe(400);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('review_id');
    });

    it('returns 400 when review_id is empty string', async () => {
      const res = await approveHandler(makeRequest({ review_id: '' }), makeDeps());
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns 200 with { data: { review_id, status: APPROVED, protocol_updated: true } }', async () => {
      setupHappyPath();

      const res = await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { review_id: string; status: string; protocol_updated: boolean } };
      expect(body.data.review_id).toBe('REV-001');
      expect(body.data.status).toBe('APPROVED');
      expect(body.data.protocol_updated).toBe(true);
    });

    it('GetCommand uses review_id as the key', async () => {
      setupHappyPath();

      await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());

      const getArg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(getArg.input['TableName']).toBe('ProtocolReview');
      expect(getArg.input['Key']).toEqual({ review_id: 'REV-001' });
    });

    it('UpdateCommand on ProtocolReview uses ExpressionAttributeNames #s = status', async () => {
      setupHappyPath();

      await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());

      const updateArg = dynamoSend.mock.calls[1]?.[0] as { input: Record<string, unknown> };
      const names = updateArg.input['ExpressionAttributeNames'] as Record<string, string>;
      expect(names['#s']).toBe('status');
    });

    it('UpdateCommand on ProtocolReview sets status to APPROVED', async () => {
      setupHappyPath();

      await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());

      const updateArg = dynamoSend.mock.calls[1]?.[0] as { input: Record<string, unknown> };
      const values = updateArg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':approved']).toBe('APPROVED');
    });

    it('UpdateCommand on TriageProtocols uses protocol_id as Key', async () => {
      setupHappyPath();

      await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());

      const protoArg = dynamoSend.mock.calls[2]?.[0] as { input: Record<string, unknown> };
      expect(protoArg.input['TableName']).toBe('TriageProtocols');
      expect(protoArg.input['Key']).toEqual({ protocol_id: 'PROTO-001' });
    });

    it('UpdateCommand on TriageProtocols sets nurse_approved = true', async () => {
      setupHappyPath();

      await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());

      const protoArg = dynamoSend.mock.calls[2]?.[0] as { input: Record<string, unknown> };
      const values = protoArg.input['ExpressionAttributeValues'] as Record<string, unknown>;
      expect(values[':t']).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Partial success — TriageProtocols update fails
  // -------------------------------------------------------------------------

  describe('partial success', () => {
    it('returns 200 with protocol_updated: false when TriageProtocols update fails', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validReviewItem }) // GetCommand
        .mockResolvedValueOnce({})                        // UpdateCommand — ProtocolReview
        .mockRejectedValueOnce(new Error('Protocol table error'));

      const res = await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());
      expect(res.status).toBe(200);
      const body = await res.json() as { data: { protocol_updated: boolean } };
      expect(body.data.protocol_updated).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns 404 when GetCommand returns no Item', async () => {
      dynamoSend.mockResolvedValueOnce({ Item: undefined });

      const res = await approveHandler(makeRequest({ review_id: 'REV-999' }), makeDeps());
      expect(res.status).toBe(404);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('REV-999');
    });

    it('returns 500 when GetCommand throws', async () => {
      dynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const res = await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());
      expect(res.status).toBe(500);
    });

    it('returns 404 when UpdateCommand on review throws ConditionalCheckFailedException', async () => {
      const err = new Error('Conditional check failed');
      err.name = 'ConditionalCheckFailedException';
      dynamoSend
        .mockResolvedValueOnce({ Item: validReviewItem })
        .mockRejectedValueOnce(err);

      const res = await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());
      expect(res.status).toBe(404);
    });

    it('returns 500 when UpdateCommand on review throws generic error', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validReviewItem })
        .mockRejectedValueOnce(new Error('Write failed'));

      const res = await approveHandler(makeRequest({ review_id: 'REV-001' }), makeDeps());
      expect(res.status).toBe(500);
    });
  });
});
