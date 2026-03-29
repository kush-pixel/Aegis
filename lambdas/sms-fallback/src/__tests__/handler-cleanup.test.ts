import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import { sendSmsFallback } from '../handler';
import type { SmsFallbackDeps } from '../handler';
import { auditLog } from '@aegis/audit';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

jest.mock('@aegis/audit', () => ({ auditLog: jest.fn() }));

const dynamoSend = jest.fn();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const scheduledEvent = { source: 'aws.events', 'detail-type': 'Scheduled Event' };

/** Minimal deps: no escalation fields so pass 2 is skipped entirely */
function makeDeps(overrides: Partial<SmsFallbackDeps> = {}): SmsFallbackDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    connect: { send: jest.fn() } as unknown as ConnectClient,
    resultsTable: 'CallResults',
    protocolsTable: 'TriageProtocols',
    connectInstanceId: 'test-instance',
    connectContactFlowId: 'test-flow',
    connectSourcePhoneNumber: '+15550000000',
    cleanupEnabled: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendSmsFallback — orphaned protocol cleanup stub (third pass)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // cleanupEnabled=true → stub emits orphaned_protocol_cleanup_skipped audit log
  // -------------------------------------------------------------------------

  it('emits orphaned_protocol_cleanup_skipped audit log when cleanupEnabled is true', async () => {
    dynamoSend
      // Pass 1: INCOMPLETE CallResults query — empty
      .mockResolvedValueOnce({ Items: [] });

    await sendSmsFallback(scheduledEvent, makeDeps({ cleanupEnabled: true }));

    // Only one dynamo call (pass 1) — stub makes no DynamoDB calls
    expect(dynamoSend).toHaveBeenCalledTimes(1);

    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'orphaned_protocol_cleanup_skipped',
        actor: 'sms-fallback',
        resource: 'TriageProtocol',
      }),
    );
  });

  // -------------------------------------------------------------------------
  // cleanupEnabled=false → stub returns immediately, no audit log
  // -------------------------------------------------------------------------

  it('skips cleanup entirely and emits no audit log when cleanupEnabled is false', async () => {
    dynamoSend
      // Pass 1: INCOMPLETE CallResults query — empty
      .mockResolvedValueOnce({ Items: [] });

    const result = await sendSmsFallback(scheduledEvent, makeDeps({ cleanupEnabled: false }));

    expect(result).toEqual({ processed: 0, errors: 0 });
    // Only the pass-1 query — no cleanup-related calls
    expect(dynamoSend).toHaveBeenCalledTimes(1);
    expect(auditLog).not.toHaveBeenCalled();
  });
});
