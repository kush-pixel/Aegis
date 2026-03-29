import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import type { LexV2Event, LexV2Result } from 'aws-lambda';
import { extractVariables } from '@aegis/bedrock-client';
import { PRAPARE_QUESTIONS, mapResponsesToZCodes } from '@aegis/sdoh';
import type { SdohResponses } from '@aegis/sdoh';
import { TriageProtocolSchema, PatientProfileSchema } from '@aegis/schemas';
import type { TriageProtocol, ExtractionResult } from '@aegis/schemas';
import { auditLog } from '@aegis/audit';

// ---------------------------------------------------------------------------
// Module-level protocol cache (Lambda warm state, per CLAUDE.md spec)
// NEVER re-read from DynamoDB after Turn 0 — use these caches instead.
// ---------------------------------------------------------------------------
const protocolCache = new Map<string, TriageProtocol>();
const patientNameCache = new Map<string, string>();

/** Exposed only for unit tests — do not call from production code. */
export function _clearCachesForTest(): void {
  protocolCache.clear();
  patientNameCache.clear();
}

// ---------------------------------------------------------------------------
// Filler phrases cycled by clinical question index
// ---------------------------------------------------------------------------
const FILLER_PHRASES = [
  'I understand. ',
  'Thank you. ',
  'Got it. ',
  'I see. ',
  'Thank you for sharing that. ',
];

const CONFIDENCE_THRESHOLD = 0.5;

// ---------------------------------------------------------------------------
// Deps
// ---------------------------------------------------------------------------
export interface LexFulfillmentDeps {
  dynamo: DynamoDBDocumentClient;
  bedrock: BedrockRuntimeClient;
  lambdaClient: LambdaClient;
  patientsTable: string;
  protocolsTable: string;
  resultsTable: string;
  triageEngineFunctionName: string;
  summarizerFunctionName: string;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------
export async function handleLexEvent(
  event: LexV2Event,
  deps: LexFulfillmentDeps,
): Promise<LexV2Result> {
  const sessionAttrs = event.sessionState.sessionAttributes ?? {};

  const callId = sessionAttrs['callId'] ?? '';
  const patientId = sessionAttrs['patientId'] ?? '';
  const protocolId = sessionAttrs['protocolId'] ?? '';

  if (!callId) throw new Error('Missing required session attribute: callId');
  if (!patientId) throw new Error('Missing required session attribute: patientId');
  if (!protocolId) throw new Error('Missing required session attribute: protocolId');

  if (event.inputTranscript === '') {
    return handleTurnZero(callId, patientId, protocolId, sessionAttrs, deps);
  }

  return handleTurnN(event, callId, patientId, protocolId, sessionAttrs, deps);
}

// ---------------------------------------------------------------------------
// Turn 0 — load protocol + patient, cache, greet, ask Q1
// ---------------------------------------------------------------------------
async function handleTurnZero(
  callId: string,
  patientId: string,
  protocolId: string,
  sessionAttrs: Record<string, string>,
  deps: LexFulfillmentDeps,
): Promise<LexV2Result> {
  // Load PatientProfile from DynamoDB
  const patientResult = await deps.dynamo.send(
    new GetCommand({
      TableName: deps.patientsTable,
      Key: { patient_id: patientId },
    }),
  );

  if (!patientResult.Item) {
    throw new Error(`PatientProfile not found: ${patientId}`);
  }

  const profile = PatientProfileSchema.parse(patientResult.Item);

  // Load TriageProtocol from DynamoDB
  const protocolResult = await deps.dynamo.send(
    new GetCommand({
      TableName: deps.protocolsTable,
      Key: { protocol_id: protocolId },
    }),
  );

  if (!protocolResult.Item) {
    throw new Error(`TriageProtocol not found: ${protocolId}`);
  }

  const protocol = TriageProtocolSchema.parse(protocolResult.Item);

  if (protocol.patient_id !== patientId) {
    throw new Error(`Protocol ${protocolId} does not belong to patient ${patientId}`);
  }

  // Cache for subsequent turns — never re-read DynamoDB
  protocolCache.set(callId, protocol);
  patientNameCache.set(callId, profile.name);

  const sortedQuestions = sortQuestions(protocol);

  auditLog({
    action: 'lex_turn_zero',
    actor: 'lex-fulfillment',
    resource: 'TriageProtocol',
    callId,
    detail: `Protocol loaded. Questions: ${sortedQuestions.length}`,
  });

  const firstQuestion = sortedQuestions[0];
  const greeting = `Hello. I'm calling to check on how you're doing since your recent discharge. ${firstQuestion.text}`;

  return buildElicitSlot(greeting, {
    ...sessionAttrs,
    callId,
    patientId,
    protocolId,
    phase: 'clinical',
    clinicalIndex: '0',
    variablesJson: '{}',
    sdohResponsesJson: '{}',
  });
}

// ---------------------------------------------------------------------------
// Turn N — extract answer, advance state machine
// ---------------------------------------------------------------------------
async function handleTurnN(
  event: LexV2Event,
  callId: string,
  patientId: string,
  protocolId: string,
  sessionAttrs: Record<string, string>,
  deps: LexFulfillmentDeps,
): Promise<LexV2Result> {
  const protocol = protocolCache.get(callId);
  if (!protocol) {
    throw new Error(
      `Protocol cache miss for callId: ${callId}. Turn 0 must execute in the same Lambda container.`,
    );
  }

  const phase = sessionAttrs['phase'] ?? 'clinical';
  const clinicalIndex = parseInt(sessionAttrs['clinicalIndex'] ?? '0', 10);
  const sdohIndex = parseInt(sessionAttrs['sdohIndex'] ?? '0', 10);
  const variables = parseVariablesJson(sessionAttrs['variablesJson'] ?? '{}');
  const sdohPartial = parseSdohJson(sessionAttrs['sdohResponsesJson'] ?? '{}');

  const sortedQuestions = sortQuestions(protocol);

  if (phase === 'clinical') {
    return handleClinicalTurn(
      event.inputTranscript,
      callId,
      patientId,
      protocolId,
      clinicalIndex,
      variables,
      sdohPartial,
      sortedQuestions,
      sessionAttrs,
      deps,
    );
  }

  return handleSdohTurn(
    event.inputTranscript,
    callId,
    patientId,
    protocolId,
    clinicalIndex,
    sdohIndex,
    variables,
    sdohPartial,
    sessionAttrs,
    deps,
  );
}

// ---------------------------------------------------------------------------
// Clinical question turn
// ---------------------------------------------------------------------------
async function handleClinicalTurn(
  transcript: string,
  callId: string,
  patientId: string,
  protocolId: string,
  clinicalIndex: number,
  variables: Record<string, ExtractionResult>,
  sdohPartial: Partial<SdohResponses>,
  sortedQuestions: ReturnType<typeof sortQuestions>,
  sessionAttrs: Record<string, string>,
  deps: LexFulfillmentDeps,
): Promise<LexV2Result> {
  const currentQuestion = sortedQuestions[clinicalIndex];
  const fillerPhrase = FILLER_PHRASES[clinicalIndex % FILLER_PHRASES.length];

  const extracted = await extractVariables(deps.bedrock, {
    transcript,
    question_context: currentQuestion.text,
    variable_names: [currentQuestion.variable_name],
  });

  const result = extracted[currentQuestion.variable_name];
  const confident = result !== undefined && result.confidence >= CONFIDENCE_THRESHOLD;

  if (!confident) {
    const retryCountMap = JSON.parse(sessionAttrs['retryCountJson'] ?? '{}') as Record<string, number>;
    const currentRetryCount = retryCountMap[currentQuestion.variable_name] ?? 0;
    const MAX_RETRIES = 3;
    const newCount = currentRetryCount + 1;
    const updatedRetryMap = { ...retryCountMap, [currentQuestion.variable_name]: newCount };

    if (newCount >= MAX_RETRIES) {
      // Exhausted retries — accept empty-string answer and advance.
      // Empty string signals "no valid answer obtained" to the triage engine.
      const exhaustedResult: ExtractionResult = {
        value:          '',
        confidence:     0.0,
        raw_transcript: transcript,
      };
      const updatedVariables: Record<string, ExtractionResult> = {
        ...variables,
        [currentQuestion.variable_name]: exhaustedResult,
      };
      const nextClinicalIndex = clinicalIndex + 1;

      if (nextClinicalIndex < sortedQuestions.length) {
        const nextQuestion = sortedQuestions[nextClinicalIndex];
        return buildElicitSlot(`${fillerPhrase}${nextQuestion.text}`, {
          ...sessionAttrs,
          clinicalIndex:  String(nextClinicalIndex),
          variablesJson:  JSON.stringify(updatedVariables),
          retryCountJson: JSON.stringify(updatedRetryMap),
        });
      }

      // Transition to SDOH phase
      const firstSdohQuestion = PRAPARE_QUESTIONS[0];
      return buildElicitSlot(
        `${fillerPhrase}I have just a couple more brief questions. ${firstSdohQuestion.text}`,
        {
          ...sessionAttrs,
          phase:              'sdoh',
          clinicalIndex:      String(clinicalIndex),
          sdohIndex:          '0',
          variablesJson:      JSON.stringify(updatedVariables),
          sdohResponsesJson:  JSON.stringify(sdohPartial),
          retryCountJson:     JSON.stringify(updatedRetryMap),
        },
      );
    }

    // Under retry limit — repeat question with incremented count
    return buildElicitSlot(
      `${fillerPhrase}I didn't quite catch that. ${currentQuestion.text}`,
      { ...sessionAttrs, retryCountJson: JSON.stringify(updatedRetryMap) },
    );
  }

  // Store extracted answer
  const updatedVariables: Record<string, ExtractionResult> = {
    ...variables,
    [currentQuestion.variable_name]: result,
  };
  const nextVariablesJson = JSON.stringify(updatedVariables);
  const nextClinicalIndex = clinicalIndex + 1;

  if (nextClinicalIndex < sortedQuestions.length) {
    // Ask next clinical question
    const nextQuestion = sortedQuestions[nextClinicalIndex];
    return buildElicitSlot(`${fillerPhrase}${nextQuestion.text}`, {
      ...sessionAttrs,
      clinicalIndex: String(nextClinicalIndex),
      variablesJson: nextVariablesJson,
    });
  }

  // All clinical questions done — transition to SDOH
  const firstSdohQuestion = PRAPARE_QUESTIONS[0];
  return buildElicitSlot(
    `${fillerPhrase}I have just a couple more brief questions. ${firstSdohQuestion.text}`,
    {
      ...sessionAttrs,
      phase: 'sdoh',
      clinicalIndex: String(clinicalIndex),
      sdohIndex: '0',
      variablesJson: nextVariablesJson,
      sdohResponsesJson: JSON.stringify(sdohPartial),
    },
  );
}

// ---------------------------------------------------------------------------
// SDOH question turn
// ---------------------------------------------------------------------------
async function handleSdohTurn(
  transcript: string,
  callId: string,
  patientId: string,
  protocolId: string,
  clinicalIndex: number,
  sdohIndex: number,
  variables: Record<string, ExtractionResult>,
  sdohPartial: Partial<SdohResponses>,
  sessionAttrs: Record<string, string>,
  deps: LexFulfillmentDeps,
): Promise<LexV2Result> {
  const currentSdohQuestion = PRAPARE_QUESTIONS[sdohIndex];

  const extracted = await extractVariables(deps.bedrock, {
    transcript,
    question_context: currentSdohQuestion.text,
    variable_names: [currentSdohQuestion.id],
  });

  const result = extracted[currentSdohQuestion.id];
  const confident = result !== undefined && result.confidence >= CONFIDENCE_THRESHOLD;

  if (!confident) {
    // Repeat same SDOH question — session attrs unchanged
    return buildElicitSlot(
      `I didn't quite catch that. ${currentSdohQuestion.text}`,
      { ...sessionAttrs },
    );
  }

  // Map extracted value to boolean
  const answerBool = result.value === true || result.value === 'yes';
  const updatedSdoh: Partial<SdohResponses> = {
    ...sdohPartial,
    [currentSdohQuestion.id]: answerBool,
  };

  const nextSdohIndex = sdohIndex + 1;

  if (nextSdohIndex < PRAPARE_QUESTIONS.length) {
    // Ask next SDOH question
    const nextSdohQuestion = PRAPARE_QUESTIONS[nextSdohIndex];
    return buildElicitSlot(nextSdohQuestion.text, {
      ...sessionAttrs,
      sdohIndex: String(nextSdohIndex),
      sdohResponsesJson: JSON.stringify(updatedSdoh),
    });
  }

  // All SDOH questions answered — final turn
  return handleFinalTurn(
    callId,
    patientId,
    protocolId,
    variables,
    updatedSdoh,
    sessionAttrs,
    deps,
  );
}

// ---------------------------------------------------------------------------
// Final turn — write CallResult, invoke triage-engine + summarizer
// ---------------------------------------------------------------------------
async function handleFinalTurn(
  callId: string,
  patientId: string,
  protocolId: string,
  variables: Record<string, ExtractionResult>,
  sdohPartial: Partial<SdohResponses>,
  sessionAttrs: Record<string, string>,
  deps: LexFulfillmentDeps,
): Promise<LexV2Result> {
  const sdohResponses: SdohResponses = {
    medication_cost_barrier: Boolean(sdohPartial.medication_cost_barrier),
    transportation_barrier: Boolean(sdohPartial.transportation_barrier),
  };

  const sdohScreening = mapResponsesToZCodes(sdohResponses);

  // Update the CallResult created by call-initiator with collected data.
  // ConditionExpression prevents phantom record creation if record is missing.
  try {
    await deps.dynamo.send(
      new UpdateCommand({
        TableName: deps.resultsTable,
        Key: { call_id: callId },
        UpdateExpression:
          'SET #vars = :vars, sdoh_responses = :sdoh, call_status = :status, sms_protocol_id = :pid',
        ConditionExpression: 'attribute_exists(call_id)',
        ExpressionAttributeNames: { '#vars': 'variables' },
        ExpressionAttributeValues: {
          ':vars': variables,
          ':sdoh': sdohScreening,
          ':status': 'COMPLETE',
          ':pid': protocolId,
        },
      }),
    );
  } catch (err: unknown) {
    if (isConditionalCheckFailed(err)) {
      throw new Error(`CallResult not found for callId: ${callId}`);
    }
    throw err;
  }

  // Invoke triage-engine synchronously (RequestResponse)
  await deps.lambdaClient.send(
    new InvokeCommand({
      FunctionName: deps.triageEngineFunctionName,
      InvocationType: 'RequestResponse',
      Payload: Buffer.from(JSON.stringify({ call_id: callId })),
    }),
  );

  // Invoke summarizer asynchronously (fire-and-forget)
  await deps.lambdaClient.send(
    new InvokeCommand({
      FunctionName: deps.summarizerFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ call_id: callId, protocol_id: protocolId })),
    }),
  );

  auditLog({
    action: 'lex_call_complete',
    actor: 'lex-fulfillment',
    resource: 'CallResult',
    callId,
    detail: `Variables collected: ${Object.keys(variables).length}, SDOH complete`,
  });

  return buildClose(
    'Thank you for your time. A nurse will review your information and contact you if needed. Goodbye.',
    sessionAttrs,
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sortQuestions(protocol: TriageProtocol) {
  return [...protocol.questions].sort((a, b) => a.order - b.order);
}

function parseVariablesJson(json: string): Record<string, ExtractionResult> {
  try {
    return JSON.parse(json) as Record<string, ExtractionResult>;
  } catch {
    return {};
  }
}

function parseSdohJson(json: string): Partial<SdohResponses> {
  try {
    return JSON.parse(json) as Partial<SdohResponses>;
  } catch {
    return {};
  }
}

function isConditionalCheckFailed(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'name' in err &&
    (err as { name: string }).name === 'ConditionalCheckFailedException'
  );
}

function buildElicitSlot(
  message: string,
  sessionAttributes: Record<string, string>,
): LexV2Result {
  return {
    sessionState: {
      sessionAttributes,
      dialogAction: { type: 'ElicitSlot', slotToElicit: 'Response' },
      intent: {
        name: 'TriageIntent',
        state: 'InProgress',
        slots: {},
      },
    },
    messages: [{ contentType: 'PlainText', content: message }],
  };
}

function buildClose(message: string, sessionAttributes: Record<string, string>): LexV2Result {
  return {
    sessionState: {
      sessionAttributes,
      dialogAction: { type: 'Close' },
      intent: {
        name: 'TriageIntent',
        state: 'Fulfilled',
        slots: {},
      },
    },
    messages: [{ contentType: 'PlainText', content: message }],
  };
}
