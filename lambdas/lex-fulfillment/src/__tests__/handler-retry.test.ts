import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { handleLexEvent, _clearCachesForTest } from '../handler';
import type { LexFulfillmentDeps } from '../handler';
import { extractVariables } from '@aegis/bedrock-client';
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

const validProtocol = {
  protocol_id:      'proto-retry',
  patient_id:       'patient-abc',
  questions: [
    {
      question_id:    'q1',
      text:           'Are you experiencing chest pain?',
      variable_name:  'chest_pain',
      required:       true,
      order:          0,
    },
    {
      question_id:    'q2',
      text:           'Are you taking your medications?',
      variable_name:  'medication_adherence',
      required:       true,
      order:          1,
    },
  ],
  conditions:       [{ condition_code: 'COPD', description: 'COPD' }],
  confidence_score: 0.9,
  created_at:       '2026-03-25T00:00:00.000Z',
};

const validPatientProfile = {
  patient_id:           'patient-abc',
  name:                 'Jane Smith',
  phone:                '+15551234567',
  discharge_date:       '2026-03-25',
  conditions:           ['COPD'],
  lace_score:           10,
  hospital_score:       6,
  composite_risk_score: 50,
  risk_level:           'MODERATE' as const,
};

const baseSessionAttrs = {
  callId:     'CALL-retry123',
  patientId:  'patient-abc',
  protocolId: 'proto-retry',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    sessionId: 'session-retry',
    inputTranscript: '',
    bot: { id: 'bot-1', name: 'TriageBot', aliasId: 'alias-1', aliasName: 'prod', localeId: 'en_US', version: '1' },
    interpretations: [],
    proposedNextState: {
      dialogAction: { type: 'Delegate' },
      intent: { confirmationState: 'None', name: 'TriageIntent', slots: {}, state: 'InProgress' },
    },
    sessionState: {
      sessionAttributes: { ...baseSessionAttrs },
      dialogAction: { type: 'Delegate' },
      intent: { confirmationState: 'None', name: 'TriageIntent', slots: {}, state: 'InProgress' },
      originatingRequestId: 'req-0',
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
      originatingRequestId: 'req-n',
    },
  } as unknown as LexV2Event;
}

function makeDeps(dynamoSend: jest.Mock): LexFulfillmentDeps {
  return {
    dynamo:                   { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    bedrock:                  {} as unknown as BedrockRuntimeClient,
    lambdaClient:             { send: jest.fn().mockResolvedValue({}) } as unknown as LambdaClient,
    patientsTable:            'PatientProfiles',
    protocolsTable:           'TriageProtocols',
    resultsTable:             'CallResults',
    triageEngineFunctionName: 'TriageEngineFunction',
    summarizerFunctionName:   'SummarizerFunction',
  };
}

function mockLowConfidence(variableName: string) {
  (extractVariables as jest.Mock).mockResolvedValueOnce({
    [variableName]: { value: 'mumble', confidence: 0.1, raw_transcript: 'mumble' },
  });
}

function mockHighConfidence(variableName: string, value: string) {
  (extractVariables as jest.Mock).mockResolvedValueOnce({
    [variableName]: { value, confidence: 0.9, raw_transcript: value },
  });
}

// ---------------------------------------------------------------------------
// Setup: prime protocol cache via Turn 0 before each test
// ---------------------------------------------------------------------------

let dynamoSend: jest.Mock;
let deps: LexFulfillmentDeps;

async function primeCacheAndGetSessionAttrs(): Promise<Record<string, string>> {
  dynamoSend
    .mockResolvedValueOnce({ Item: validPatientProfile })
    .mockResolvedValueOnce({ Item: validProtocol });

  const t0Result = await handleLexEvent(makeTurn0Event(), deps);
  return (t0Result.sessionState.sessionAttributes ?? {}) as Record<string, string>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleLexEvent — retry cap', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _clearCachesForTest();
    dynamoSend = jest.fn();
    deps = makeDeps(dynamoSend);
  });

  it('1st low confidence — repeats the same question, retryCountJson count becomes 1', async () => {
    const sessionAttrs = await primeCacheAndGetSessionAttrs();

    mockLowConfidence('chest_pain');

    const result = await handleLexEvent(
      makeTurnNEvent('mumble', { ...sessionAttrs, phase: 'clinical', clinicalIndex: '0', variablesJson: '{}', sdohResponsesJson: '{}' }),
      deps,
    );

    const msg = getMsgContent(result);
    expect(msg).toContain('chest pain');

    const returnedAttrs = result.sessionState.sessionAttributes as Record<string, string>;
    const retryMap = JSON.parse(returnedAttrs['retryCountJson'] ?? '{}') as Record<string, number>;
    expect(retryMap['chest_pain']).toBe(1);
  });

  it('2nd low confidence — repeats the same question again, retryCountJson count becomes 2', async () => {
    const sessionAttrs = await primeCacheAndGetSessionAttrs();

    mockLowConfidence('chest_pain');

    const result = await handleLexEvent(
      makeTurnNEvent('mumble', {
        ...sessionAttrs,
        phase: 'clinical', clinicalIndex: '0',
        variablesJson: '{}', sdohResponsesJson: '{}',
        retryCountJson: JSON.stringify({ chest_pain: 1 }),
      }),
      deps,
    );

    const msg = getMsgContent(result);
    expect(msg).toContain('chest pain');

    const returnedAttrs = result.sessionState.sessionAttributes as Record<string, string>;
    const retryMap = JSON.parse(returnedAttrs['retryCountJson'] ?? '{}') as Record<string, number>;
    expect(retryMap['chest_pain']).toBe(2);
  });

  it('3rd low confidence — advances to next question with null/0.0 extraction, retryCountJson count becomes 3', async () => {
    const sessionAttrs = await primeCacheAndGetSessionAttrs();

    mockLowConfidence('chest_pain');

    const result = await handleLexEvent(
      makeTurnNEvent('mumble', {
        ...sessionAttrs,
        phase: 'clinical', clinicalIndex: '0',
        variablesJson: '{}', sdohResponsesJson: '{}',
        retryCountJson: JSON.stringify({ chest_pain: 2 }),
      }),
      deps,
    );

    // Should advance to the NEXT question (medication_adherence)
    const msg = getMsgContent(result);
    expect(msg).toContain('medications');

    const returnedAttrs = result.sessionState.sessionAttributes as Record<string, string>;

    // clinicalIndex should be 1 now
    expect(returnedAttrs['clinicalIndex']).toBe('1');

    // retryCountJson should reflect count=3
    const retryMap = JSON.parse(returnedAttrs['retryCountJson'] ?? '{}') as Record<string, number>;
    expect(retryMap['chest_pain']).toBe(3);

    // The exhausted variable should be stored with value='' and confidence=0.0
    const variables = JSON.parse(returnedAttrs['variablesJson'] ?? '{}') as Record<string, { value: unknown; confidence: number }>;
    expect(variables['chest_pain']).toBeDefined();
    expect(variables['chest_pain'].value).toBe('');
    expect(variables['chest_pain'].confidence).toBe(0.0);
  });

  it('3rd low confidence on the LAST clinical question — transitions to SDOH phase', async () => {
    const sessionAttrs = await primeCacheAndGetSessionAttrs();

    mockLowConfidence('medication_adherence'); // last question (index 1)

    const result = await handleLexEvent(
      makeTurnNEvent('mumble', {
        ...sessionAttrs,
        phase: 'clinical', clinicalIndex: '1',  // last clinical question
        variablesJson: JSON.stringify({ chest_pain: { value: 'yes', confidence: 0.9, raw_transcript: 'yes' } }),
        sdohResponsesJson: '{}',
        retryCountJson: JSON.stringify({ medication_adherence: 2 }),
      }),
      deps,
    );

    // Should transition to SDOH phase (first SDOH question)
    const msg = getMsgContent(result);
    expect(msg).toContain('medications due to cost');  // first PRAPARE question text

    const returnedAttrs = result.sessionState.sessionAttributes as Record<string, string>;
    expect(returnedAttrs['phase']).toBe('sdoh');
    expect(returnedAttrs['sdohIndex']).toBe('0');

    const retryMap = JSON.parse(returnedAttrs['retryCountJson'] ?? '{}') as Record<string, number>;
    expect(retryMap['medication_adherence']).toBe(3);

    const variables = JSON.parse(returnedAttrs['variablesJson'] ?? '{}') as Record<string, { value: unknown; confidence: number }>;
    expect(variables['medication_adherence'].value).toBe('');
    expect(variables['medication_adherence'].confidence).toBe(0.0);
  });

  it('high confidence on first attempt — no retryCountJson key set for that variable', async () => {
    const sessionAttrs = await primeCacheAndGetSessionAttrs();

    mockHighConfidence('chest_pain', 'yes');

    const result = await handleLexEvent(
      makeTurnNEvent('yes', {
        ...sessionAttrs,
        phase: 'clinical', clinicalIndex: '0',
        variablesJson: '{}', sdohResponsesJson: '{}',
      }),
      deps,
    );

    // Should advance to the next question
    const msg = getMsgContent(result);
    expect(msg).toContain('medications');

    const returnedAttrs = result.sessionState.sessionAttributes as Record<string, string>;

    // No retry count should be set for chest_pain (high confidence means no retry tracking)
    if (returnedAttrs['retryCountJson']) {
      const retryMap = JSON.parse(returnedAttrs['retryCountJson']) as Record<string, number>;
      expect(retryMap['chest_pain']).toBeUndefined();
    }
    // Successful extraction stored
    const variables = JSON.parse(returnedAttrs['variablesJson'] ?? '{}') as Record<string, { value: unknown; confidence: number }>;
    expect(variables['chest_pain'].value).toBe('yes');
  });
});
