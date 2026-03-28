import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { triageHandler } from '../handler';
import type { TriageHandlerDeps } from '../handler';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

const dynamoSend = jest.fn();
const verifyJwt  = jest.fn().mockResolvedValue({ sub: 'nurse-001' });

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(): TriageHandlerDeps {
  return {
    dynamo:       { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    resultsTable: 'CallResults',
    verifyJwt,
  };
}

const validCallResult = {
  call_id:       'CALL-001',
  patient_id:    'PAT-001',
  variables:     {},
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier:  false,
    z_codes:                 [],
  },
  triage_status: 'RED' as const,
  created_at:    '2026-03-27T10:00:00.000Z',
  call_status:   'COMPLETE' as const,
};

function makeRequest(url: string, init?: RequestInit): Request {
  return new Request(url, {
    headers: { Authorization: 'Bearer valid.jwt.token' },
    ...init,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('triageHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    verifyJwt.mockResolvedValue({ sub: 'nurse-001' });
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  describe('auth', () => {
    it('returns 401 when Authorization header is missing', async () => {
      const request = new Request('http://localhost/api/triage');
      const res = await triageHandler(request, makeDeps());
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toContain('Authorization');
    });

    it('returns 401 when verifyJwt throws', async () => {
      verifyJwt.mockRejectedValueOnce(new Error('Token expired'));
      const res = await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );
      expect(res.status).toBe(401);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Unauthorized');
    });
  });

  // -------------------------------------------------------------------------
  // Path A — patient_id provided
  // -------------------------------------------------------------------------

  describe('Path A — patient_id query param present', () => {
    it('returns 200 with data array when patient_id is provided', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('uses patient_id-call_timestamp-index GSI when patient_id is provided', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['IndexName']).toBe('patient_id-call_timestamp-index');
      expect(arg.input['KeyConditionExpression']).toContain('patient_id');
    });

    it('does not use ScanCommand for Path A', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      const arg = dynamoSend.mock.calls[0]?.[0] as { constructor: { name: string } };
      expect(arg.constructor.name).toBe('QueryCommand');
    });

    it('returns 500 when DynamoDB throws in Path A', async () => {
      dynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Internal server error');
    });

    it('returns empty data array when GSI returns no items in Path A', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [] });

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('handles undefined Items from Path A DynamoDB response', async () => {
      dynamoSend.mockResolvedValueOnce({});

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('treats empty-string patient_id as Path B (falls through to all-completed query)', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id='),
        makeDeps(),
      );

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['IndexName']).toBe('call_status-triage_completed_at-index');
    });
  });

  // -------------------------------------------------------------------------
  // Path B — no patient_id (all completed calls)
  // -------------------------------------------------------------------------

  describe('Path B — no patient_id (all patients view)', () => {
    it('returns 200 with data array when no patient_id is provided', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(1);
    });

    it('uses call_status-triage_completed_at-index GSI when no patient_id is provided', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['IndexName']).toBe('call_status-triage_completed_at-index');
      const exprValues = arg.input['ExpressionAttributeValues'] as Record<string, string>;
      expect(exprValues[':complete']).toBe('COMPLETE');
    });

    it('does not use ScanCommand for Path B', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      const arg = dynamoSend.mock.calls[0]?.[0] as { constructor: { name: string } };
      expect(arg.constructor.name).toBe('QueryCommand');
    });

    it('returns 500 when DynamoDB throws in Path B', async () => {
      dynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      expect(res.status).toBe(500);
      const body = await res.json() as { error: string };
      expect(body.error).toBe('Internal server error');
    });

    it('returns empty data array when GSI returns no items in Path B', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [] });

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });

    it('handles undefined Items from Path B DynamoDB response', async () => {
      dynamoSend.mockResolvedValueOnce({});

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Response shape
  // -------------------------------------------------------------------------

  describe('response shape', () => {
    it('response body follows { data: T } envelope', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [validCallResult] });

      const res = await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('data');
      expect(Array.isArray(body['data'])).toBe(true);
    });

    it('ScanIndexForward is false (newest first) for Path A', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [] });

      await triageHandler(
        makeRequest('http://localhost/api/triage?patient_id=PAT-001'),
        makeDeps(),
      );

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['ScanIndexForward']).toBe(false);
    });

    it('ScanIndexForward is false (newest first) for Path B', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [] });

      await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      const arg = dynamoSend.mock.calls[0]?.[0] as { input: Record<string, unknown> };
      expect(arg.input['ScanIndexForward']).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // AUTH_BYPASS early-return (line 29–31)
  // -------------------------------------------------------------------------

  describe('AUTH_BYPASS early-return', () => {
    const origDynamo = process.env['DYNAMO_ENDPOINT'];

    beforeEach(() => {
      delete process.env['DYNAMO_ENDPOINT'];
      process.env['AUTH_BYPASS'] = 'true';
    });

    afterEach(() => {
      delete process.env['AUTH_BYPASS'];
      if (origDynamo !== undefined) {
        process.env['DYNAMO_ENDPOINT'] = origDynamo;
      }
    });

    it('returns { data: [] } without querying DynamoDB when AUTH_BYPASS is true and DYNAMO_ENDPOINT is unset', async () => {
      const res = await triageHandler(
        makeRequest('http://localhost/api/triage'),
        makeDeps(),
      );

      expect(res.status).toBe(200);
      const body = await res.json() as { data: unknown[] };
      expect(body.data).toEqual([]);
      expect(dynamoSend).not.toHaveBeenCalled();
    });
  });
});
