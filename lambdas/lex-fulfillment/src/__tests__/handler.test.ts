import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { handleLexEvent, _clearCachesForTest } from '../handler';
import type { LexFulfillmentDeps } from '../handler';
import { extractVariables } from '@aegis/bedrock-client';
import { PRAPARE_QUESTIONS, mapResponsesToZCodes } from '@aegis/sdoh';
import { auditLog } from '@aegis/audit';
import type { LexV2Event, LexV2Result } from 'aws-lambda';

jest.mock('@aegis/bedrock-client', () => ({
  extractVariables: jest.fn(),
}));

jest.mock('@aegis/sdoh', () => ({
  PRAPARE_QUESTIONS: [
    {
      id: 'medication_cost_barrier',
      text: 'Have you been unable to get medications due to cost?',
      zCode: 'Z59.7',
      zCodeDescription: 'Insufficient social insurance',
    },
    {
      id: 'transportation_barrier',
      text: 'Has lack of transportation kept you from appointments?',
      zCode: 'Z59.8',
      zCodeDescription: 'Other housing problems',
    },
  ],
  mapResponsesToZCodes: jest.fn(),
}));

jest.mock('@aegis/audit', () => ({
  auditLog: jest.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validPatientProfile = {
  patient_id: 'patient-abc',
  name: 'Jane Smith',
  phone: '+15551234567',
  discharge_date: '2026-03-25',
  conditions: ['COPD'],
  lace_score: 10,
  hospital_score: 6,
  composite_risk_score: 50,
  risk_level: 'MODERATE' as const,
};

const validProtocol = {
  protocol_id: 'proto-001',
  patient_id: 'patient-abc',
  questions: [
    {
      question_id: 'q1',
      text: 'Are you experiencing chest pain?',
      variable_name: 'chest_pain',
      required: true,
      order: 0,
    },
    {
      question_id: 'q2',
      text: 'Are you taking your medications as prescribed?',
      variable_name: 'medication_adherence',
      required: true,
      order: 1,
    },
  ],
  conditions: [{ condition_code: 'COPD', description: 'Chronic obstructive pulmonary disease' }],
  confidence_score: 0.9,
  created_at: '2026-03-25T00:00:00.000Z',
};

const baseSessionAttrs = {
  callId: 'CALL-abc123',
  patientId: 'patient-abc',
  protocolId: 'proto-001',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** LexV2Message is a union — narrow to the PlainText variant for assertions. */
function getMsgContent(result: LexV2Result): string {
  const msg = result.messages?.[0] as { content?: string } | undefined;
  return msg?.content ?? '';
}

function makeTurn0Event(): LexV2Event {
  return {
    messageVersion: '1.0',
    invocationSource: 'DialogCodeHook',
    inputMode: 'Speech',
    responseContentType: 'text/plain; charset=utf-8',
    sessionId: 'session-1',
    inputTranscript: '',
    bot: {
      id: 'bot-1',
      name: 'TriageBot',
      aliasId: 'alias-1',
      aliasName: 'prod',
      localeId: 'en_US',
      version: '1',
    },
    interpretations: [],
    proposedNextState: {
      dialogAction: { type: 'Delegate' },
      intent: { confirmationState: 'None', name: 'TriageIntent', slots: {}, state: 'InProgress' },
    },
    sessionState: {
      sessionAttributes: { ...baseSessionAttrs },
      dialogAction: { type: 'Delegate' },
      intent: { confirmationState: 'None', name: 'TriageIntent', slots: {}, state: 'InProgress' },
      originatingRequestId: 'req-1',
    },
    transcriptions: [],
  } as unknown as LexV2Event;
}

function makeTurnNEvent(transcript: string, attrs: Record<string, string>): LexV2Event {
  return {
    ...makeTurn0Event(),
    inputTranscript: transcript,
    sessionState: {
      sessionAttributes: attrs,
      dialogAction: { type: 'Delegate' },
      intent: { confirmationState: 'None', name: 'TriageIntent', slots: {}, state: 'InProgress' },
      originatingRequestId: 'req-2',
    },
  } as unknown as LexV2Event;
}

function makeDeps(
  dynamoSend: jest.Mock,
  lambdaSend: jest.Mock = jest.fn().mockResolvedValue({}),
): LexFulfillmentDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    bedrock: {} as unknown as BedrockRuntimeClient,
    lambdaClient: { send: lambdaSend } as unknown as LambdaClient,
    patientsTable: 'PatientProfiles',
    protocolsTable: 'TriageProtocols',
    resultsTable: 'CallResults',
    triageEngineFunctionName: 'TriageEngineFunction',
    summarizerFunctionName: 'SummarizerFunction',
  };
}

function mockExtract(
  variableName: string,
  value: string | number | boolean,
  confidence: number,
) {
  (extractVariables as jest.Mock).mockResolvedValueOnce({
    [variableName]: { value, confidence, raw_transcript: String(value) },
  });
}

function mockSdohMapping() {
  (mapResponsesToZCodes as jest.Mock).mockReturnValue({
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  });
}

/** Run Turn 0 to populate the protocol/patient caches. */
async function seedCache(dynamo?: jest.Mock): Promise<void> {
  const d =
    dynamo ??
    jest
      .fn()
      .mockResolvedValueOnce({ Item: validPatientProfile })
      .mockResolvedValueOnce({ Item: validProtocol });
  await handleLexEvent(makeTurn0Event(), makeDeps(d));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleLexEvent', () => {
  let dynamoSend: jest.Mock;
  let lambdaSend: jest.Mock;
  let deps: LexFulfillmentDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    _clearCachesForTest();
    dynamoSend = jest.fn();
    lambdaSend = jest.fn().mockResolvedValue({});
    deps = makeDeps(dynamoSend, lambdaSend);
  });

  // =========================================================================
  // TURN 0 — Happy path
  // =========================================================================

  describe('Turn 0 (empty inputTranscript)', () => {
    function setupTurn0DynaMock() {
      dynamoSend
        .mockResolvedValueOnce({ Item: validPatientProfile })
        .mockResolvedValueOnce({ Item: validProtocol });
    }

    it('returns ElicitSlot with Q1 on happy path', async () => {
      setupTurn0DynaMock();
      const result = await handleLexEvent(makeTurn0Event(), deps);

      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
      expect(getMsgContent(result)).toContain('Are you experiencing chest pain?');
    });

    it('sets phase=clinical and clinicalIndex=0 in session attrs', async () => {
      setupTurn0DynaMock();
      const result = await handleLexEvent(makeTurn0Event(), deps);

      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(attrs['phase']).toBe('clinical');
      expect(attrs['clinicalIndex']).toBe('0');
    });

    it('sets variablesJson and sdohResponsesJson to empty objects', async () => {
      setupTurn0DynaMock();
      const result = await handleLexEvent(makeTurn0Event(), deps);

      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(JSON.parse(attrs['variablesJson'] ?? '{}')).toEqual({});
      expect(JSON.parse(attrs['sdohResponsesJson'] ?? '{}')).toEqual({});
    });

    it('greeting includes first clinical question text', async () => {
      setupTurn0DynaMock();
      const result = await handleLexEvent(makeTurn0Event(), deps);

      expect(getMsgContent(result)).toContain('Are you experiencing chest pain?');
    });

    it('emits lex_turn_zero audit log', async () => {
      setupTurn0DynaMock();
      await handleLexEvent(makeTurn0Event(), deps);

      expect(auditLog).toHaveBeenCalledTimes(1);
      expect(auditLog).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'lex_turn_zero',
          actor: 'lex-fulfillment',
          callId: 'CALL-abc123',
        }),
      );
    });

    it('audit log detail contains no PHI (no patient name or phone)', async () => {
      setupTurn0DynaMock();
      await handleLexEvent(makeTurn0Event(), deps);

      const calls = (auditLog as jest.Mock).mock.calls as [{ detail?: string }][];
      for (const [ctx] of calls) {
        expect(ctx.detail).not.toContain('Jane Smith');
        expect(ctx.detail).not.toContain('+15551234567');
        expect(ctx.detail).not.toContain('patient-abc');
      }
    });

    it('throws when sessionAttributes is undefined entirely', async () => {
      const event = makeTurn0Event();
      (event.sessionState as { sessionAttributes: undefined }).sessionAttributes = undefined;

      await expect(handleLexEvent(event, deps)).rejects.toThrow(
        'Missing required session attribute: callId',
      );
      expect(dynamoSend).not.toHaveBeenCalled();
    });

    it('throws when callId is missing from session attributes', async () => {
      const event = makeTurn0Event();
      (event.sessionState.sessionAttributes as Record<string, string>)['callId'] = '';

      await expect(handleLexEvent(event, deps)).rejects.toThrow(
        'Missing required session attribute: callId',
      );
      expect(dynamoSend).not.toHaveBeenCalled();
    });

    it('throws when patientId is missing', async () => {
      const event = makeTurn0Event();
      const attrs = event.sessionState.sessionAttributes as Record<string, string>;
      delete attrs['patientId'];

      await expect(handleLexEvent(event, deps)).rejects.toThrow(
        'Missing required session attribute: patientId',
      );
    });

    it('throws when protocolId is missing', async () => {
      const event = makeTurn0Event();
      const attrs = event.sessionState.sessionAttributes as Record<string, string>;
      delete attrs['protocolId'];

      await expect(handleLexEvent(event, deps)).rejects.toThrow(
        'Missing required session attribute: protocolId',
      );
    });

    it('throws PatientProfile not found when DynamoDB returns no Item', async () => {
      dynamoSend.mockResolvedValueOnce({ Item: undefined });

      await expect(handleLexEvent(makeTurn0Event(), deps)).rejects.toThrow(
        'PatientProfile not found: patient-abc',
      );
    });

    it('throws TriageProtocol not found when second DynamoDB call returns no Item', async () => {
      dynamoSend
        .mockResolvedValueOnce({ Item: validPatientProfile })
        .mockResolvedValueOnce({ Item: undefined });

      await expect(handleLexEvent(makeTurn0Event(), deps)).rejects.toThrow(
        'TriageProtocol not found: proto-001',
      );
    });

    it('throws when protocol belongs to a different patient', async () => {
      const wrongProtocol = { ...validProtocol, patient_id: 'patient-other' };
      dynamoSend
        .mockResolvedValueOnce({ Item: validPatientProfile })
        .mockResolvedValueOnce({ Item: wrongProtocol });

      await expect(handleLexEvent(makeTurn0Event(), deps)).rejects.toThrow(
        'Protocol proto-001 does not belong to patient patient-abc',
      );
    });

    it('sorts questions by order field — Q1 (order=0) asked first even if stored reversed', async () => {
      const reversedProtocol = {
        ...validProtocol,
        questions: [...validProtocol.questions].reverse(),
      };
      dynamoSend
        .mockResolvedValueOnce({ Item: validPatientProfile })
        .mockResolvedValueOnce({ Item: reversedProtocol });

      const result = await handleLexEvent(makeTurn0Event(), deps);
      expect(getMsgContent(result)).toContain('Are you experiencing chest pain?');
    });
  });

  // =========================================================================
  // TURN N — Clinical phase
  // =========================================================================

  describe('Turn N — clinical phase', () => {
    const clinicalAttrs: Record<string, string> = {
      ...baseSessionAttrs,
      phase: 'clinical',
      clinicalIndex: '0',
      variablesJson: '{}',
      sdohResponsesJson: '{}',
    };

    beforeEach(() => seedCache());

    it('no DynamoDB calls on Turn N — uses protocol cache', async () => {
      mockExtract('chest_pain', 'yes', 0.9);
      const freshDynamo = jest.fn();
      await handleLexEvent(makeTurnNEvent('yes I have chest pain', clinicalAttrs), makeDeps(freshDynamo));

      expect(freshDynamo).not.toHaveBeenCalled();
    });

    it('advances to next clinical question when confidence >= 0.5', async () => {
      mockExtract('chest_pain', 'yes', 0.9);
      const result = await handleLexEvent(
        makeTurnNEvent('yes I have chest pain', clinicalAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
      expect(getMsgContent(result)).toContain('Are you taking your medications');
      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(attrs['clinicalIndex']).toBe('1');
    });

    it('repeats same question when confidence < 0.5', async () => {
      mockExtract('chest_pain', 'maybe', 0.3);
      const result = await handleLexEvent(
        makeTurnNEvent('maybe', clinicalAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
      expect(getMsgContent(result)).toContain('Are you experiencing chest pain?');
      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(attrs['clinicalIndex']).toBe('0');
    });

    it('filler phrase present in response message when advancing', async () => {
      mockExtract('chest_pain', 'yes', 0.8);
      const result = await handleLexEvent(
        makeTurnNEvent('yes', clinicalAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      const msg = getMsgContent(result);
      const fillerPhrases = ['I understand', 'Thank you', 'Got it', 'I see'];
      expect(fillerPhrases.some((p) => msg.includes(p))).toBe(true);
    });

    it('stores extracted variable in variablesJson session attr', async () => {
      mockExtract('chest_pain', 'yes', 0.9);
      const result = await handleLexEvent(
        makeTurnNEvent('yes', clinicalAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      const attrs = result.sessionState.sessionAttributes ?? {};
      const vars = JSON.parse(attrs['variablesJson'] ?? '{}') as Record<string, unknown>;
      expect(vars['chest_pain']).toBeDefined();
      expect((vars['chest_pain'] as { confidence: number }).confidence).toBe(0.9);
    });

    it('transitions to sdoh phase after last clinical question', async () => {
      const lastClinicalAttrs: Record<string, string> = {
        ...clinicalAttrs,
        clinicalIndex: '1',
        variablesJson: JSON.stringify({
          chest_pain: { value: 'yes', confidence: 0.9, raw_transcript: 'yes' },
        }),
      };
      mockExtract('medication_adherence', 'yes', 0.9);

      const result = await handleLexEvent(
        makeTurnNEvent('yes I take my meds', lastClinicalAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(attrs['phase']).toBe('sdoh');
      expect(attrs['sdohIndex']).toBe('0');
      expect(getMsgContent(result)).toContain('medications due to cost');
    });

    it('throws on protocol cache miss when Turn 0 was skipped', async () => {
      _clearCachesForTest();
      await expect(
        handleLexEvent(makeTurnNEvent('yes', clinicalAttrs), makeDeps(jest.fn())),
      ).rejects.toThrow('Protocol cache miss for callId: CALL-abc123');
    });

    it('defaults phase to clinical and clinicalIndex to 0 when session attrs omit them', async () => {
      // Minimal attrs — no phase/clinicalIndex/variablesJson/sdohResponsesJson
      const minimalAttrs: Record<string, string> = { ...baseSessionAttrs };
      mockExtract('chest_pain', 'yes', 0.9);
      const result = await handleLexEvent(
        makeTurnNEvent('yes', minimalAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      // Defaults: phase='clinical', clinicalIndex=0 → should ask Q2
      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
      expect(getMsgContent(result)).toContain('Are you taking your medications');
    });

    it('handles malformed variablesJson gracefully — treats as empty object', async () => {
      const badAttrs: Record<string, string> = {
        ...clinicalAttrs,
        variablesJson: 'NOT_VALID_JSON',
      };
      mockExtract('chest_pain', 'yes', 0.9);
      const result = await handleLexEvent(
        makeTurnNEvent('yes', badAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      // Advances to Q2 as normal — empty variables map is valid
      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
    });

    it('handles malformed sdohResponsesJson gracefully — treats as empty object', async () => {
      // Reach SDOH phase with malformed sdohResponsesJson
      const badSdohAttrs: Record<string, string> = {
        ...baseSessionAttrs,
        phase: 'sdoh',
        clinicalIndex: '1',
        sdohIndex: '0',
        variablesJson: JSON.stringify({
          chest_pain: { value: 'no', confidence: 0.95, raw_transcript: 'no' },
          medication_adherence: { value: 'yes', confidence: 0.9, raw_transcript: 'yes' },
        }),
        sdohResponsesJson: 'NOT_VALID_JSON',
      };
      mockExtract('medication_cost_barrier', 'yes', 0.9);
      const result = await handleLexEvent(
        makeTurnNEvent('yes', badSdohAttrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      // Advances to SDOH Q2 normally
      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(attrs['sdohIndex']).toBe('1');
    });
  });

  // =========================================================================
  // TURN N — SDOH phase
  // =========================================================================

  describe('Turn N — SDOH phase', () => {
    const sdohQ1Attrs: Record<string, string> = {
      ...baseSessionAttrs,
      phase: 'sdoh',
      clinicalIndex: '1',
      sdohIndex: '0',
      variablesJson: JSON.stringify({
        chest_pain: { value: 'no', confidence: 0.95, raw_transcript: 'no' },
        medication_adherence: { value: 'yes', confidence: 0.9, raw_transcript: 'yes' },
      }),
      sdohResponsesJson: '{}',
    };

    beforeEach(() => seedCache());

    it('advances to SDOH Q2 when Q1 confidence >= 0.5', async () => {
      mockExtract('medication_cost_barrier', 'yes', 0.85);
      const result = await handleLexEvent(
        makeTurnNEvent('yes I struggle with cost', sdohQ1Attrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
      expect(getMsgContent(result)).toContain('transportation');
      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(attrs['sdohIndex']).toBe('1');
    });

    it('repeats SDOH Q1 when confidence < 0.5', async () => {
      mockExtract('medication_cost_barrier', 'maybe', 0.2);
      const result = await handleLexEvent(
        makeTurnNEvent('maybe', sdohQ1Attrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      expect(result.sessionState.dialogAction.type).toBe('ElicitSlot');
      expect(getMsgContent(result)).toContain('medications due to cost');
      const attrs = result.sessionState.sessionAttributes ?? {};
      expect(attrs['sdohIndex']).toBe('0');
    });

    it("maps 'yes' string answer to medication_cost_barrier: true in sdohResponsesJson", async () => {
      mockExtract('medication_cost_barrier', 'yes', 0.9);
      const result = await handleLexEvent(
        makeTurnNEvent('yes', sdohQ1Attrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      const attrs = result.sessionState.sessionAttributes ?? {};
      const sdoh = JSON.parse(attrs['sdohResponsesJson'] ?? '{}') as Record<string, boolean>;
      expect(sdoh['medication_cost_barrier']).toBe(true);
    });

    it('maps boolean true answer correctly to sdoh response', async () => {
      mockExtract('medication_cost_barrier', true, 0.95);
      const result = await handleLexEvent(
        makeTurnNEvent('yes', sdohQ1Attrs),
        makeDeps(jest.fn(), lambdaSend),
      );

      const attrs = result.sessionState.sessionAttributes ?? {};
      const sdoh = JSON.parse(attrs['sdohResponsesJson'] ?? '{}') as Record<string, boolean>;
      expect(sdoh['medication_cost_barrier']).toBe(true);
    });

    it("maps 'no' string answer to transportation_barrier: false in final turn", async () => {
      const sdohQ2Attrs: Record<string, string> = {
        ...sdohQ1Attrs,
        sdohIndex: '1',
        sdohResponsesJson: JSON.stringify({ medication_cost_barrier: true }),
      };
      mockExtract('transportation_barrier', 'no', 0.88);
      mockSdohMapping();
      dynamoSend.mockResolvedValue({});

      const result = await handleLexEvent(
        makeTurnNEvent('no I have a car', sdohQ2Attrs),
        makeDeps(dynamoSend, lambdaSend),
      );

      expect(result.sessionState.dialogAction.type).toBe('Close');
      expect(mapResponsesToZCodes).toHaveBeenCalledWith(
        expect.objectContaining({ transportation_barrier: false }),
      );
    });
  });

  // =========================================================================
  // Final turn
  // =========================================================================

  describe('Final turn (SDOH Q2 answered)', () => {
    const finalAttrs: Record<string, string> = {
      ...baseSessionAttrs,
      phase: 'sdoh',
      clinicalIndex: '1',
      sdohIndex: '1',
      variablesJson: JSON.stringify({
        chest_pain: { value: 'no', confidence: 0.95, raw_transcript: 'no' },
        medication_adherence: { value: 'yes', confidence: 0.9, raw_transcript: 'yes' },
      }),
      sdohResponsesJson: JSON.stringify({ medication_cost_barrier: false }),
    };

    beforeEach(() => seedCache());

    function setupFinalTurn() {
      mockExtract('transportation_barrier', 'no', 0.9);
      mockSdohMapping();
      dynamoSend.mockResolvedValue({});
    }

    it('returns Close dialog action with Fulfilled intent state', async () => {
      setupFinalTurn();
      const result = await handleLexEvent(
        makeTurnNEvent('no I have transport', finalAttrs),
        makeDeps(dynamoSend, lambdaSend),
      );

      expect(result.sessionState.dialogAction.type).toBe('Close');
      expect(result.sessionState.intent?.state).toBe('Fulfilled');
    });

    it('UpdateCommand targets correct call_id key', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const updateArg = dynamoSend.mock.calls[0][0];
      expect(updateArg.input.Key).toEqual({ call_id: 'CALL-abc123' });
    });

    it('UpdateCommand sets call_status=COMPLETE and sms_protocol_id=protocolId', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const exprVals = dynamoSend.mock.calls[0][0].input.ExpressionAttributeValues as Record<
        string,
        unknown
      >;
      expect(exprVals[':status']).toBe('COMPLETE');
      expect(exprVals[':pid']).toBe('proto-001');
    });

    it('UpdateCommand includes ConditionExpression attribute_exists(call_id)', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const updateArg = dynamoSend.mock.calls[0][0];
      expect(updateArg.input.ConditionExpression).toBe('attribute_exists(call_id)');
    });

    it('throws CallResult not found when ConditionalCheckFailedException', async () => {
      mockExtract('transportation_barrier', 'no', 0.9);
      mockSdohMapping();
      const err = Object.assign(new Error('Condition failed'), {
        name: 'ConditionalCheckFailedException',
      });
      dynamoSend.mockRejectedValueOnce(err);

      await expect(
        handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend)),
      ).rejects.toThrow('CallResult not found for callId: CALL-abc123');
    });

    it('rethrows non-ConditionalCheckFailedException DynamoDB errors as-is', async () => {
      mockExtract('transportation_barrier', 'no', 0.9);
      mockSdohMapping();
      const networkErr = new Error('Network error');
      dynamoSend.mockRejectedValueOnce(networkErr);

      await expect(
        handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend)),
      ).rejects.toThrow('Network error');
    });

    it('triage-engine invoked with InvocationType RequestResponse', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const triageCall = lambdaSend.mock.calls[0][0];
      expect(triageCall.input.InvocationType).toBe('RequestResponse');
      expect(triageCall.input.FunctionName).toBe('TriageEngineFunction');
    });

    it('triage-engine payload is { call_id } in snake_case', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const triageCall = lambdaSend.mock.calls[0][0];
      const payload = JSON.parse(
        Buffer.from(triageCall.input.Payload as Buffer).toString(),
      ) as unknown;
      expect(payload).toEqual({ call_id: 'CALL-abc123' });
    });

    it('summarizer invoked with InvocationType Event (fire-and-forget)', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const summarizerCall = lambdaSend.mock.calls[1][0];
      expect(summarizerCall.input.InvocationType).toBe('Event');
      expect(summarizerCall.input.FunctionName).toBe('SummarizerFunction');
    });

    it('summarizer payload is { call_id, protocol_id } in snake_case', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const summarizerCall = lambdaSend.mock.calls[1][0];
      const payload = JSON.parse(
        Buffer.from(summarizerCall.input.Payload as Buffer).toString(),
      ) as unknown;
      expect(payload).toEqual({ call_id: 'CALL-abc123', protocol_id: 'proto-001' });
    });

    it('emits lex_call_complete audit log on final turn', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const calls = (auditLog as jest.Mock).mock.calls as [{ action: string; detail?: string }][];
      // beforeEach seedCache emits lex_turn_zero; this turn emits lex_call_complete
      const finalLog = calls.find(([ctx]) => ctx.action === 'lex_call_complete');
      expect(finalLog).toBeDefined();
      expect(finalLog?.[0]).toMatchObject({
        actor: 'lex-fulfillment',
        resource: 'CallResult',
        callId: 'CALL-abc123',
      });
    });

    it('defaults medication_cost_barrier and transportation_barrier to false when sdohResponsesJson is empty', async () => {
      // sdohResponsesJson is empty — both fields should default to false
      const attrsNoSdoh: Record<string, string> = {
        ...baseSessionAttrs,
        phase: 'sdoh',
        clinicalIndex: '1',
        sdohIndex: '1',
        variablesJson: JSON.stringify({
          chest_pain: { value: 'no', confidence: 0.95, raw_transcript: 'no' },
          medication_adherence: { value: 'yes', confidence: 0.9, raw_transcript: 'yes' },
        }),
        sdohResponsesJson: '{}', // no medication_cost_barrier, no transportation_barrier
      };
      mockExtract('transportation_barrier', 'no', 0.9);
      (mapResponsesToZCodes as jest.Mock).mockReturnValue({
        medication_cost_barrier: false,
        transportation_barrier: false,
        z_codes: [],
      });
      dynamoSend.mockResolvedValue({});

      await handleLexEvent(
        makeTurnNEvent('no', attrsNoSdoh),
        makeDeps(dynamoSend, lambdaSend),
      );

      expect(mapResponsesToZCodes).toHaveBeenCalledWith({
        medication_cost_barrier: false,
        transportation_barrier: false,
      });
    });

    it('lex_call_complete audit log detail contains no PHI', async () => {
      setupFinalTurn();
      await handleLexEvent(makeTurnNEvent('no', finalAttrs), makeDeps(dynamoSend, lambdaSend));

      const calls = (auditLog as jest.Mock).mock.calls as [{ action: string; detail?: string }][];
      const finalLog = calls.find(([ctx]) => ctx.action === 'lex_call_complete');
      expect(finalLog?.[0]?.detail).not.toContain('Jane Smith');
      expect(finalLog?.[0]?.detail).not.toContain('+15551234567');
      expect(finalLog?.[0]?.detail).not.toContain('patient-abc');
    });
  });
});
