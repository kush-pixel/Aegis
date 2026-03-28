import type { DynamoDBStreamEvent, DynamoDBRecord } from 'aws-lambda';
import { publishUpdates } from '../handler';
import type { AppSyncPublisherDeps } from '../handler';
import { auditLog } from '@aegis/audit';

jest.mock('@aegis/audit', () => ({
  auditLog: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers to build DynamoDB stream records
// ---------------------------------------------------------------------------

/**
 * Converts a plain JS object to DynamoDB-wire format (AttributeValue map).
 * Only handles the types used in CallResult: S, BOOL, N, M, NULL.
 */
function toDynamo(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === null || v === undefined) {
      result[k] = { NULL: true };
    } else if (typeof v === 'string') {
      result[k] = { S: v };
    } else if (typeof v === 'boolean') {
      result[k] = { BOOL: v };
    } else if (typeof v === 'number') {
      result[k] = { N: String(v) };
    } else if (typeof v === 'object' && !Array.isArray(v)) {
      result[k] = { M: toDynamo(v as Record<string, unknown>) };
    } else if (Array.isArray(v)) {
      result[k] = { L: v.map((item) => (typeof item === 'string' ? { S: item } : { N: String(item) })) };
    }
  }
  return result;
}

function makeRecord(
  eventName: 'INSERT' | 'MODIFY' | 'REMOVE',
  newItem?: Record<string, unknown>,
  oldItem?: Record<string, unknown>,
): DynamoDBRecord {
  return {
    eventName,
    dynamodb: {
      SequenceNumber: '1',
      NewImage: newItem ? toDynamo(newItem) : undefined,
      OldImage: oldItem ? toDynamo(oldItem) : undefined,
    },
  } as unknown as DynamoDBRecord;
}

function makeEvent(records: DynamoDBRecord[]): DynamoDBStreamEvent {
  return { Records: records };
}

// ---------------------------------------------------------------------------
// Base CallResult items
// ---------------------------------------------------------------------------

const BASE_ITEM = {
  call_id: 'CALL-abc123',
  patient_id: 'patient-xyz',
  triage_status: 'INCOMPLETE',
  created_at: '2026-03-27T00:00:00.000Z',
};

const ISBARR = {
  identify: 'Dr Smith',
  situation: 'Patient reported chest pain',
  background: 'Recent MI',
  assessment: 'High risk',
  recommendation: 'Transfer to ED',
  read_back: 'Confirmed',
};

// ---------------------------------------------------------------------------
// Deps factory
// ---------------------------------------------------------------------------

function makeDeps(fetchMock: jest.Mock): AppSyncPublisherDeps {
  return {
    appsyncEndpoint: 'https://appsync.example.com/graphql',
    appsyncApiKey: 'test-api-key',
    fetchFn: fetchMock,
  };
}

function okResponse(): Response {
  return { ok: true, status: 200 } as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('publishUpdates', () => {
  let fetchMock: jest.Mock;
  let deps: AppSyncPublisherDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    fetchMock = jest.fn().mockResolvedValue(okResponse());
    deps = makeDeps(fetchMock);
  });

  // -------------------------------------------------------------------------
  // Skip conditions
  // -------------------------------------------------------------------------

  it('skips REMOVE events — fetch not called', async () => {
    const event = makeEvent([makeRecord('REMOVE', undefined, BASE_ITEM)]);
    const result = await publishUpdates(event, deps);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.batchItemFailures).toEqual([]);
  });

  it('skips MODIFY where only SMS fields changed — triage_status stays INCOMPLETE', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, sms_sent: true, sms_sent_at: '2026-03-27T01:00:00.000Z' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips MODIFY where triage_status is unchanged RED (already published)', async () => {
    const oldItem = { ...BASE_ITEM, triage_status: 'RED' };
    const newItem = { ...BASE_ITEM, triage_status: 'RED', sms_sent: true };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips MODIFY where isbarr_summary was already present in OldImage', async () => {
    const oldItem = { ...BASE_ITEM, triage_status: 'RED', isbarr_summary: ISBARR };
    const newItem = { ...BASE_ITEM, triage_status: 'RED', isbarr_summary: ISBARR, call_status: 'COMPLETE' };
    // call_status going to COMPLETE IS meaningful — let's test isbarr-only skip separately
    const oldItemNoCallStatus = { ...BASE_ITEM, triage_status: 'RED', isbarr_summary: ISBARR };
    const newItemNoCallStatus = { ...BASE_ITEM, triage_status: 'RED', isbarr_summary: ISBARR };
    const event = makeEvent([makeRecord('MODIFY', newItemNoCallStatus, oldItemNoCallStatus)]);

    await publishUpdates(event, deps);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips INSERT where triage_status is INCOMPLETE and no call_status or isbarr_summary', async () => {
    const event = makeEvent([makeRecord('INSERT', BASE_ITEM)]);

    await publishUpdates(event, deps);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  // -------------------------------------------------------------------------
  // Triggers — MODIFY
  // -------------------------------------------------------------------------

  it('publishes when call_status changes to COMPLETE', async () => {
    const oldItem = { ...BASE_ITEM, triage_status: 'RED' };
    const newItem = { ...BASE_ITEM, triage_status: 'RED', call_status: 'COMPLETE' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('publishes when triage_status changes to RED', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'RED' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('publishes when triage_status changes to YELLOW', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'YELLOW' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('publishes when triage_status changes to GREEN', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'GREEN' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('publishes when isbarr_summary is written for the first time', async () => {
    const oldItem = { ...BASE_ITEM, triage_status: 'RED' };
    const newItem = { ...BASE_ITEM, triage_status: 'RED', isbarr_summary: ISBARR };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Triggers — INSERT
  // -------------------------------------------------------------------------

  it('publishes on INSERT when call_status is COMPLETE', async () => {
    const newItem = { ...BASE_ITEM, call_status: 'COMPLETE' };
    const event = makeEvent([makeRecord('INSERT', newItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  // -------------------------------------------------------------------------
  // Correct mutation payload
  // -------------------------------------------------------------------------

  it('sends correct mutation payload to AppSync', async () => {
    const newItem = { ...BASE_ITEM, triage_status: 'RED', isbarr_summary: ISBARR };
    const oldItem = { ...BASE_ITEM };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(url).toBe('https://appsync.example.com/graphql');
    expect((init.headers as Record<string, string>)['x-api-key']).toBe('test-api-key');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const body = JSON.parse(init.body as string) as {
      query: string;
      variables: {
        callId: string;
        patientId: string;
        triageStatus: string;
        callStatus: string | null;
        isbarrSummary: string | null;
        updatedAt: string;
      };
    };
    expect(body.query).toContain('publishTriageUpdate');
    expect(body.variables.callId).toBe('CALL-abc123');
    expect(body.variables.patientId).toBe('patient-xyz');
    expect(body.variables.triageStatus).toBe('RED');
    expect(body.variables.callStatus).toBeNull();
    expect(typeof body.variables.isbarrSummary).toBe('string');
    const parsedIsbarr = JSON.parse(body.variables.isbarrSummary as string) as typeof ISBARR;
    expect(parsedIsbarr.identify).toBe('Dr Smith');
    expect(typeof body.variables.updatedAt).toBe('string');
  });

  it('sends null for isbarrSummary when not present', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'GREEN' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      variables: { isbarrSummary: null };
    };
    expect(body.variables.isbarrSummary).toBeNull();
  });

  it('sends null for callStatus when not present', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'RED' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    const body = JSON.parse((fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string) as {
      variables: { callStatus: null };
    };
    expect(body.variables.callStatus).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Audit logging
  // -------------------------------------------------------------------------

  it('emits appsync_update_published audit log on success', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'RED' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'appsync_update_published',
        callId: 'CALL-abc123',
      }),
    );
  });

  it('audit logs contain no PHI — no patient_id in detail', async () => {
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'RED' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    await publishUpdates(event, deps);

    const calls = (auditLog as jest.Mock).mock.calls as [{ detail?: string }][];
    for (const [ctx] of calls) {
      expect(ctx.detail).not.toContain('patient-xyz');
    }
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------

  it('emits appsync_publish_failed and does not throw when AppSync returns non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 } as Response);
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'RED' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    const result = await publishUpdates(event, deps);

    expect(result.batchItemFailures).toEqual([]);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'appsync_publish_failed',
        callId: 'CALL-abc123',
      }),
    );
  });

  it('emits appsync_publish_failed and does not throw when fetch throws a network error', async () => {
    fetchMock.mockRejectedValue(new Error('Network unreachable'));
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'YELLOW' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    const result = await publishUpdates(event, deps);

    expect(result.batchItemFailures).toEqual([]);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'appsync_publish_failed',
        detail: expect.stringContaining('Network unreachable'),
      }),
    );
  });

  // -------------------------------------------------------------------------
  // Batch processing
  // -------------------------------------------------------------------------

  it('processes batch of 3 records — only 2 meaningful, fetch called exactly twice', async () => {
    const records = [
      // meaningful: triage_status → RED
      makeRecord('MODIFY', { ...BASE_ITEM, triage_status: 'RED' }, BASE_ITEM),
      // not meaningful: only sms_sent changed
      makeRecord('MODIFY', { ...BASE_ITEM, sms_sent: true }, BASE_ITEM),
      // meaningful: isbarr_summary written
      makeRecord('MODIFY', { ...BASE_ITEM, triage_status: 'RED', isbarr_summary: ISBARR }, { ...BASE_ITEM, triage_status: 'RED' }),
    ];
    const event = makeEvent(records);

    const result = await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.batchItemFailures).toEqual([]);
  });

  it('always returns empty batchItemFailures regardless of errors', async () => {
    fetchMock.mockRejectedValue(new Error('hard fail'));
    const records = [
      makeRecord('MODIFY', { ...BASE_ITEM, triage_status: 'RED' }, BASE_ITEM),
      makeRecord('MODIFY', { ...BASE_ITEM, triage_status: 'YELLOW' }, BASE_ITEM),
    ];
    const event = makeEvent(records);

    const result = await publishUpdates(event, deps);

    expect(result.batchItemFailures).toEqual([]);
    expect(auditLog).toHaveBeenCalledTimes(2);
  });

  it('uses INCOMPLETE fallback when triage_status is absent but call_status is COMPLETE', async () => {
    // Record has no triage_status field — exercises the ?? fallback branches
    const newItem = {
      call_id: 'CALL-abc123',
      patient_id: 'patient-xyz',
      created_at: '2026-03-27T00:00:00.000Z',
      call_status: 'COMPLETE',
    };
    const event = makeEvent([makeRecord('INSERT', newItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { variables: { triageStatus: string } };
    expect(body.variables.triageStatus).toBe('INCOMPLETE');
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'appsync_update_published' }),
    );
  });

  it('publishes via isbarr_summary when triage_status is absent — covers ?? fallback on triage check', async () => {
    // No triage_status, no call_status → first two checks fail; isbarr_summary triggers publish
    const newItem = {
      call_id: 'CALL-abc123',
      patient_id: 'patient-xyz',
      created_at: '2026-03-27T00:00:00.000Z',
      isbarr_summary: ISBARR,
    };
    const event = makeEvent([makeRecord('INSERT', newItem)]);

    await publishUpdates(event, deps);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('handles non-Error thrown by fetch — detail uses String(err)', async () => {
    fetchMock.mockRejectedValue('connection refused');
    const oldItem = { ...BASE_ITEM };
    const newItem = { ...BASE_ITEM, triage_status: 'RED' };
    const event = makeEvent([makeRecord('MODIFY', newItem, oldItem)]);

    const result = await publishUpdates(event, deps);

    expect(result.batchItemFailures).toEqual([]);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'appsync_publish_failed',
        detail: expect.stringContaining('connection refused'),
      }),
    );
  });
});
