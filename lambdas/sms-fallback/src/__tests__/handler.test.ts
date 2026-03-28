import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import { sendSmsFallback } from '../handler';
import type { SmsFallbackDeps } from '../handler';
import { auditLog } from '@aegis/audit';

// ---------------------------------------------------------------------------
// Module-level mocks — AWS SDK mocked at module level, never per-test
// ---------------------------------------------------------------------------

jest.mock('@aegis/audit', () => ({ auditLog: jest.fn() }));

const dynamoSend = jest.fn();
const connectSend = jest.fn();

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeDeps(): SmsFallbackDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    connect: { send: connectSend } as unknown as ConnectClient,
    resultsTable: 'CallResults',
    protocolsTable: 'TriageProtocols',
    connectInstanceId: 'test-instance',
    connectContactFlowId: 'test-flow',
    connectSourcePhoneNumber: '+15550000000',
  };
}

const validProtocol = {
  protocol_id: 'proto-001',
  patient_id: 'PAT-001',
  questions: [
    {
      question_id: 'q1',
      text: 'Have you gained 3 or more pounds since discharge?',
      variable_name: 'weight_gain',
      required: true,
      order: 0,
    },
    {
      question_id: 'q2',
      text: 'Do you have swollen ankles?',
      variable_name: 'edema',
      required: true,
      order: 1,
    },
  ],
  conditions: [{ condition_code: 'CHF', description: 'Congestive Heart Failure' }],
  confidence_score: 0.92,
  created_at: '2026-03-20T10:00:00.000Z',
};

const validCallRecord = {
  call_id: 'CALL-abc123',
  patient_id: 'PAT-001',
  patient_phone: '+15551234567',
  variables: {},
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  },
  triage_status: 'INCOMPLETE',
  call_status: 'INCOMPLETE',
  created_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(), // 40 min ago
};

const scheduledEvent = { source: 'aws.events', 'detail-type': 'Scheduled Event' };

// ---------------------------------------------------------------------------
// Helpers — set up the full happy-path mock sequence for a single record.
// validCallRecord has no sms_protocol_id, so the handler uses the
// patient_id-index QueryCommand path for protocol lookup.
// ---------------------------------------------------------------------------

function setupHappyPath(): void {
  dynamoSend
    .mockResolvedValueOnce({ Items: [validCallRecord] })   // GSI QueryCommand
    .mockResolvedValueOnce({ Items: [validProtocol] })     // patient_id-index QueryCommand
    .mockResolvedValueOnce({});                            // UpdateCommand
  connectSend.mockResolvedValue({ ContactId: 'contact-xyz', $metadata: {} });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sendSmsFallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Happy path
  // -------------------------------------------------------------------------

  describe('happy path', () => {
    it('returns { processed: 1, errors: 0 } when one eligible record exists', async () => {
      setupHappyPath();

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 1, errors: 0 });
    });

    it('calls StartOutboundChatContactCommand with correct DestinationEndpoint address and SourceEndpoint', async () => {
      setupHappyPath();

      await sendSmsFallback(scheduledEvent, makeDeps());

      const connectArg = connectSend.mock.calls[0][0];
      expect(connectArg.input.DestinationEndpoint).toEqual({
        Type: 'TELEPHONE_NUMBER',
        Address: '+15551234567',
      });
      expect(connectArg.input.SourceEndpoint).toEqual({
        Type: 'TELEPHONE_NUMBER',
        Address: '+15550000000',
      });
    });

    it('SMS body contains both Q1 and Q2 text', async () => {
      setupHappyPath();

      await sendSmsFallback(scheduledEvent, makeDeps());

      const connectArg = connectSend.mock.calls[0][0];
      const body: string = connectArg.input.InitialSystemMessage.Content;
      expect(body).toContain('Have you gained 3 or more pounds since discharge?');
      expect(body).toContain('Do you have swollen ankles?');
    });

    it('UpdateCommand sets sms_sent=true, sms_sent_at (ISO string), sms_question_index=0, sms_protocol_id, call_status=INCOMPLETE', async () => {
      setupHappyPath();

      await sendSmsFallback(scheduledEvent, makeDeps());

      const updateArg = dynamoSend.mock.calls[2][0];
      const values = updateArg.input.ExpressionAttributeValues;
      expect(values[':t']).toBe(true);
      expect(typeof values[':now']).toBe('string');
      expect(new Date(values[':now'] as string).toISOString()).toBe(values[':now']);
      expect(values[':zero']).toBe(0);
      expect(values[':pid']).toBe('proto-001');
      expect(values[':incomplete']).toBe('INCOMPLETE');
      expect(updateArg.input.Key).toEqual({ call_id: 'CALL-abc123' });
      expect(updateArg.input.TableName).toBe('CallResults');
    });

    it('emits sms_fallback_sent audit log with callId', async () => {
      setupHappyPath();

      await sendSmsFallback(scheduledEvent, makeDeps());

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sms_fallback_sent',
          callId: 'CALL-abc123',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Empty results
  // -------------------------------------------------------------------------

  describe('empty GSI results', () => {
    it('returns { processed: 0, errors: 0 } when GSI returns no items', async () => {
      dynamoSend.mockResolvedValueOnce({ Items: [] });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 0 });
      expect(connectSend).not.toHaveBeenCalled();
    });

    it('returns { processed: 0, errors: 0 } when GSI returns undefined Items', async () => {
      dynamoSend.mockResolvedValueOnce({});

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 0 });
      expect(connectSend).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Client-side filtering
  // -------------------------------------------------------------------------

  describe('client-side filtering', () => {
    it('skips record with sms_sent: true — returns { processed: 0, errors: 0 }', async () => {
      const alreadySent = { ...validCallRecord, sms_sent: true };
      dynamoSend.mockResolvedValueOnce({ Items: [alreadySent] });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 0 });
      expect(connectSend).not.toHaveBeenCalled();
    });

    it('skips record where created_at is only 10 minutes ago — returns { processed: 0, errors: 0 }', async () => {
      const tooRecent = {
        ...validCallRecord,
        created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      };
      dynamoSend.mockResolvedValueOnce({ Items: [tooRecent] });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 0 });
      expect(connectSend).not.toHaveBeenCalled();
    });

    it('processes record that is exactly older than 30 minutes', async () => {
      // 31 minutes to be safely past the cutoff (ISO string comparison is lexicographic)
      const justOldEnough = {
        ...validCallRecord,
        created_at: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      };
      dynamoSend
        .mockResolvedValueOnce({ Items: [justOldEnough] })
        .mockResolvedValueOnce({ Items: [validProtocol] })
        .mockResolvedValueOnce({});
      connectSend.mockResolvedValue({ ContactId: 'contact-xyz', $metadata: {} });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 1, errors: 0 });
    });
  });

  // -------------------------------------------------------------------------
  // Protocol lookup paths
  // -------------------------------------------------------------------------

  describe('protocol lookup paths', () => {
    it('uses GetCommand when sms_protocol_id is present on the record', async () => {
      const recordWithProtoId = { ...validCallRecord, sms_protocol_id: 'proto-001' };
      dynamoSend
        .mockResolvedValueOnce({ Items: [recordWithProtoId] })  // GSI QueryCommand
        .mockResolvedValueOnce({ Item: validProtocol })         // GetCommand via sms_protocol_id
        .mockResolvedValueOnce({});                             // UpdateCommand
      connectSend.mockResolvedValue({ ContactId: 'contact-xyz', $metadata: {} });

      await sendSmsFallback(scheduledEvent, makeDeps());

      // Call index 1 is the protocol lookup — it should be a GetCommand (has Key, no IndexName)
      const getArg = dynamoSend.mock.calls[1][0];
      expect(getArg.input.Key).toEqual({ protocol_id: 'proto-001' });
      expect(getArg.input.TableName).toBe('TriageProtocols');
      expect(getArg.input.KeyConditionExpression).toBeUndefined();
    });

    it('uses QueryCommand on patient_id-index when sms_protocol_id is absent from the record', async () => {
      // validCallRecord has no sms_protocol_id
      dynamoSend
        .mockResolvedValueOnce({ Items: [validCallRecord] })   // GSI QueryCommand
        .mockResolvedValueOnce({ Items: [validProtocol] })     // patient_id-index QueryCommand
        .mockResolvedValueOnce({});                            // UpdateCommand
      connectSend.mockResolvedValue({ ContactId: 'contact-xyz', $metadata: {} });

      await sendSmsFallback(scheduledEvent, makeDeps());

      const queryArg = dynamoSend.mock.calls[1][0];
      expect(queryArg.input.IndexName).toBe('patient_id-index');
      expect(queryArg.input.TableName).toBe('TriageProtocols');
      expect(queryArg.input.ExpressionAttributeValues[':pid']).toBe('PAT-001');
    });
  });

  // -------------------------------------------------------------------------
  // Single-question protocol
  // -------------------------------------------------------------------------

  describe('single-question protocol', () => {
    it('SMS body contains only Q1 text when protocol has 1 question', async () => {
      const singleQuestionProtocol = {
        ...validProtocol,
        questions: [
          {
            question_id: 'q1',
            text: 'Have you gained 3 or more pounds since discharge?',
            variable_name: 'weight_gain',
            required: true,
            order: 0,
          },
        ],
      };
      dynamoSend
        .mockResolvedValueOnce({ Items: [validCallRecord] })
        .mockResolvedValueOnce({ Items: [singleQuestionProtocol] })
        .mockResolvedValueOnce({});
      connectSend.mockResolvedValue({ ContactId: 'contact-xyz', $metadata: {} });

      await sendSmsFallback(scheduledEvent, makeDeps());

      const connectArg = connectSend.mock.calls[0][0];
      const body: string = connectArg.input.InitialSystemMessage.Content;
      expect(body).toContain('Have you gained 3 or more pounds since discharge?');
      expect(body).not.toContain('Q2:');
      expect(body).toContain('Reply with your answer.');
    });
  });

  // -------------------------------------------------------------------------
  // Error handling — per-record errors do not abort the loop
  // -------------------------------------------------------------------------

  describe('error handling — per-record errors, continues processing', () => {
    it('counts error and continues when GetCommand returns no Item', async () => {
      const recordWithProtoId = { ...validCallRecord, sms_protocol_id: 'proto-001' };
      dynamoSend
        .mockResolvedValueOnce({ Items: [recordWithProtoId] })
        .mockResolvedValueOnce({ Item: undefined }); // GetCommand finds nothing

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 1 });
      expect(connectSend).not.toHaveBeenCalled();
    });

    it('counts error and continues when protocol has 0 questions', async () => {
      const emptyQuestionsProtocol = { ...validProtocol, questions: [] };
      dynamoSend
        .mockResolvedValueOnce({ Items: [validCallRecord] })
        .mockResolvedValueOnce({ Items: [emptyQuestionsProtocol] });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 1 });
      expect(connectSend).not.toHaveBeenCalled();
    });

    it('counts error and continues when patient_phone is missing from record', async () => {
      const noPhoneRecord = { ...validCallRecord, patient_phone: undefined };
      dynamoSend
        .mockResolvedValueOnce({ Items: [noPhoneRecord] })
        .mockResolvedValueOnce({ Items: [validProtocol] });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 1 });
      expect(connectSend).not.toHaveBeenCalled();
    });

    it('counts error and continues when Connect send throws', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Items: [validCallRecord] })
        .mockResolvedValueOnce({ Items: [validProtocol] });
      connectSend.mockRejectedValueOnce(new Error('Connect unavailable'));

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 1 });
    });

    it('counts error and continues when UpdateCommand throws', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Items: [validCallRecord] })
        .mockResolvedValueOnce({ Items: [validProtocol] })
        .mockRejectedValueOnce(new Error('DynamoDB write failed'));
      connectSend.mockResolvedValueOnce({ ContactId: 'contact-xyz', $metadata: {} });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 0, errors: 1 });
    });

    it('emits sms_fallback_error audit log when a per-record error occurs', async () => {
      const recordWithProtoId = { ...validCallRecord, sms_protocol_id: 'proto-001' };
      dynamoSend
        .mockResolvedValueOnce({ Items: [recordWithProtoId] })
        .mockResolvedValueOnce({ Item: undefined }); // triggers "No protocol found"

      await sendSmsFallback(scheduledEvent, makeDeps());

      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'sms_fallback_error',
          callId: 'CALL-abc123',
        }),
      );
    });

    it('returns { processed: 1, errors: 1 } when 2 records exist and one succeeds and one fails', async () => {
      const failingRecord = {
        ...validCallRecord,
        call_id: 'CALL-failing',
        patient_phone: undefined, // missing phone causes per-record error
      };
      dynamoSend
        .mockResolvedValueOnce({ Items: [validCallRecord, failingRecord] }) // GSI query
        .mockResolvedValueOnce({ Items: [validProtocol] })                  // protocol for record 1
        .mockResolvedValueOnce({})                                          // UpdateCommand for record 1
        .mockResolvedValueOnce({ Items: [validProtocol] });                 // protocol for record 2 (phone missing → error after this)
      connectSend.mockResolvedValueOnce({ ContactId: 'contact-xyz', $metadata: {} });

      const result = await sendSmsFallback(scheduledEvent, makeDeps());

      expect(result).toEqual({ processed: 1, errors: 1 });
    });
  });

  // -------------------------------------------------------------------------
  // Initial QueryCommand failure — propagates (not caught inside loop)
  // -------------------------------------------------------------------------

  describe('initial QueryCommand failure', () => {
    it('propagates error when the initial GSI QueryCommand throws', async () => {
      dynamoSend.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      await expect(
        sendSmsFallback(scheduledEvent, makeDeps()),
      ).rejects.toThrow('DynamoDB unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // Sorting
  // -------------------------------------------------------------------------

  describe('question sorting', () => {
    it('sorts questions by order field — uses order=0 as Q1 and order=1 as Q2 regardless of array order', async () => {
      const reversedProtocol = {
        ...validProtocol,
        questions: [
          {
            question_id: 'q2',
            text: 'Do you have swollen ankles?',
            variable_name: 'edema',
            required: true,
            order: 1,
          },
          {
            question_id: 'q1',
            text: 'Have you gained 3 or more pounds since discharge?',
            variable_name: 'weight_gain',
            required: true,
            order: 0,
          },
        ],
      };
      dynamoSend
        .mockResolvedValueOnce({ Items: [validCallRecord] })
        .mockResolvedValueOnce({ Items: [reversedProtocol] })
        .mockResolvedValueOnce({});
      connectSend.mockResolvedValueOnce({ ContactId: 'contact-xyz', $metadata: {} });

      await sendSmsFallback(scheduledEvent, makeDeps());

      const connectArg = connectSend.mock.calls[0][0];
      const body: string = connectArg.input.InitialSystemMessage.Content;
      const q1Index = body.indexOf('Have you gained 3 or more pounds since discharge?');
      const q2Index = body.indexOf('Do you have swollen ankles?');
      expect(q1Index).toBeGreaterThan(-1);
      expect(q2Index).toBeGreaterThan(-1);
      // weight_gain (order=0) must appear before edema (order=1)
      expect(q1Index).toBeLessThan(q2Index);
    });
  });

  // -------------------------------------------------------------------------
  // PHI safety in audit logs
  // -------------------------------------------------------------------------

  describe('PHI safety in audit logs', () => {
    it('no phone number appears in any audit log detail', async () => {
      setupHappyPath();

      await sendSmsFallback(scheduledEvent, makeDeps());

      const calls = (auditLog as jest.Mock).mock.calls as [{ detail?: string }][];
      for (const [ctx] of calls) {
        expect(ctx.detail).not.toContain('+15551234567');
        expect(ctx.detail).not.toContain('+15550000000');
      }
    });

    it('no patient name appears in any audit log detail', async () => {
      setupHappyPath();

      await sendSmsFallback(scheduledEvent, makeDeps());

      const calls = (auditLog as jest.Mock).mock.calls as [{ detail?: string }][];
      for (const [ctx] of calls) {
        expect(ctx.detail).not.toMatch(/patient name/i);
      }
    });
  });
});
