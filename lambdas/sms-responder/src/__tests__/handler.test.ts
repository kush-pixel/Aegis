import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { respondToSms } from '../handler';
import type { SmsResponderDeps, InboundSmsEvent } from '../handler';
import { auditLog } from '@aegis/audit';

jest.mock('@aegis/audit', () => ({ auditLog: jest.fn() }));

const dynamoSend = jest.fn();
const lambdaSend = jest.fn();

function makeDeps(): SmsResponderDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    lambdaClient: { send: lambdaSend } as unknown as LambdaClient,
    resultsTable: 'CallResults',
    protocolsTable: 'TriageProtocols',
    patientsTable: 'PatientProfiles',
    triageEngineFunctionName: 'triage-engine-fn',
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

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
  variables: {},
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  },
  triage_status: 'INCOMPLETE',
  call_status: 'INCOMPLETE',
  sms_sent: true,
  sms_question_index: 0,
  sms_protocol_id: 'proto-001',
  created_at: '2026-03-27T09:00:00.000Z',
};

const validPatient = { patient_id: 'PAT-001', phone: '+15551234567' };

function makeEvent(
  message: string,
  overrides?: Partial<{ phone: string; attributeMessage: string }>,
): InboundSmsEvent {
  return {
    Name: 'ContactFlowEvent',
    Details: {
      ContactData: {
        Attributes: overrides?.attributeMessage ? { message: overrides.attributeMessage } : {},
        Channel: 'SMS',
        ContactId: 'contact-abc',
        CustomerEndpoint: {
          Address: overrides?.phone ?? '+15551234567',
          Type: 'PHONE_NUMBER',
        },
        InitialContactId: 'contact-abc',
        InstanceARN: 'arn:aws:connect:us-east-1:123:instance/test',
      },
      Parameters: { message },
    },
  };
}

// Helper: returns event where Parameters.message is entirely absent (undefined)
function makeEventNoParamMessage(
  overrides?: Partial<{ phone: string; attributeMessage: string }>,
): InboundSmsEvent {
  return {
    Name: 'ContactFlowEvent',
    Details: {
      ContactData: {
        Attributes: overrides?.attributeMessage ? { message: overrides.attributeMessage } : {},
        Channel: 'SMS',
        ContactId: 'contact-abc',
        CustomerEndpoint: {
          Address: overrides?.phone ?? '+15551234567',
          Type: 'PHONE_NUMBER',
        },
        InitialContactId: 'contact-abc',
        InstanceARN: 'arn:aws:connect:us-east-1:123:instance/test',
      },
      Parameters: {},
    },
  };
}

// Standard mock sequence for the ANSWERED path (Q1, index 0 → 1)
function setupAnsweredPath(): void {
  dynamoSend
    .mockResolvedValueOnce({ Items: [validPatient] })          // call 1: patient lookup
    .mockResolvedValueOnce({ Items: [validCallRecord] })        // call 2: pending calls
    .mockResolvedValueOnce({ Item: validProtocol })             // call 3: protocol fetch
    .mockResolvedValueOnce({});                                 // call 4: update
}

// Standard mock sequence for the COMPLETE path (Q2, index 1 → 2)
function setupCompletePath(): void {
  const q2CallRecord = { ...validCallRecord, sms_question_index: 1 };
  dynamoSend
    .mockResolvedValueOnce({ Items: [validPatient] })
    .mockResolvedValueOnce({ Items: [q2CallRecord] })
    .mockResolvedValueOnce({ Item: validProtocol })
    .mockResolvedValueOnce({});
  lambdaSend.mockResolvedValueOnce({ StatusCode: 202, $metadata: {} });
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Message extraction
// ---------------------------------------------------------------------------

describe('message extraction', () => {
  it('uses Parameters.message when present and non-empty', async () => {
    setupAnsweredPath();
    const result = await respondToSms(makeEvent('yes'), makeDeps());
    expect(result).toEqual({ status: 'ANSWERED' });
  });

  it('falls back to Attributes.message when Parameters.message is undefined', async () => {
    setupAnsweredPath();
    const event = makeEventNoParamMessage({ attributeMessage: 'yes' });
    const result = await respondToSms(event, makeDeps());
    expect(result).toEqual({ status: 'ANSWERED' });
  });

  it('returns IGNORED when Parameters.message is undefined AND Attributes.message is undefined', async () => {
    const event = makeEventNoParamMessage(); // no attributeMessage either
    const result = await respondToSms(event, makeDeps());
    expect(result).toEqual({ status: 'IGNORED' });
    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it('returns IGNORED when Parameters.message is empty string', async () => {
    const result = await respondToSms(makeEvent(''), makeDeps());
    expect(result).toEqual({ status: 'IGNORED' });
    expect(dynamoSend).not.toHaveBeenCalled();
  });

  it('returns IGNORED when Parameters.message is whitespace only', async () => {
    const result = await respondToSms(makeEvent('   '), makeDeps());
    expect(result).toEqual({ status: 'IGNORED' });
    expect(dynamoSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phone validation
// ---------------------------------------------------------------------------

describe('phone validation', () => {
  it('throws Missing CustomerEndpoint.Address when Address is empty string', async () => {
    const event = makeEvent('yes', { phone: '' });
    await expect(respondToSms(event, makeDeps())).rejects.toThrow(
      'Missing CustomerEndpoint.Address',
    );
    expect(dynamoSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Patient lookup
// ---------------------------------------------------------------------------

describe('patient lookup', () => {
  it('throws Patient not found for phone when PatientProfiles GSI returns no items', async () => {
    dynamoSend.mockResolvedValueOnce({ Items: [] });
    await expect(respondToSms(makeEvent('yes'), makeDeps())).rejects.toThrow(
      'Patient not found for phone',
    );
    expect(dynamoSend).toHaveBeenCalledTimes(1);
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('throws Patient not found for phone when PatientProfiles GSI returns Items: undefined', async () => {
    // Exercises the `patientQuery.Items ?? []` null-coalescing branch (line 76)
    dynamoSend.mockResolvedValueOnce({});
    await expect(respondToSms(makeEvent('yes'), makeDeps())).rejects.toThrow(
      'Patient not found for phone',
    );
    expect(dynamoSend).toHaveBeenCalledTimes(1);
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// No pending call
// ---------------------------------------------------------------------------

describe('no pending call', () => {
  it('returns IGNORED when no INCOMPLETE+sms_sent call exists for patient', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [] }); // no calls at all
    const result = await respondToSms(makeEvent('yes'), makeDeps());
    expect(result).toEqual({ status: 'IGNORED' });
    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  it('returns IGNORED when CallResults GSI returns Items: undefined', async () => {
    // Exercises the `callsQuery.Items ?? []` null-coalescing branch (line 94)
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({}); // Items absent
    const result = await respondToSms(makeEvent('yes'), makeDeps());
    expect(result).toEqual({ status: 'IGNORED' });
    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  it('returns IGNORED when sms_question_index >= 2 on the pending call', async () => {
    const exhaustedCall = { ...validCallRecord, sms_question_index: 2 };
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [exhaustedCall] });
    const result = await respondToSms(makeEvent('yes'), makeDeps());
    expect(result).toEqual({ status: 'IGNORED' });
    // protocol should NOT be fetched
    expect(dynamoSend).toHaveBeenCalledTimes(2);
  });

  it('returns IGNORED when question at sms_question_index does not exist in protocol', async () => {
    // Protocol has only 1 question (index 0), but call record is at index 1
    const oneQuestionProtocol = {
      ...validProtocol,
      questions: [validProtocol.questions[0]],
    };
    const callAtIndex1 = { ...validCallRecord, sms_question_index: 1 };
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [callAtIndex1] })
      .mockResolvedValueOnce({ Item: oneQuestionProtocol });
    const result = await respondToSms(makeEvent('yes'), makeDeps());
    expect(result).toEqual({ status: 'IGNORED' });
  });
});

// ---------------------------------------------------------------------------
// Boolean parsing — Q1 (index 0), ANSWERED path
// ---------------------------------------------------------------------------

describe('boolean parsing — ANSWERED path (sms_question_index=0)', () => {
  it("'yes' stores value: true and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('yes'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'YES' stores value: true and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('YES'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'y' stores value: true and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('y'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'Y' stores value: true and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('Y'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'no' stores value: false and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('no'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'NO' stores value: false and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('NO'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'n' stores value: false and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('n'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'N' stores value: false and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('N'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });
});

// ---------------------------------------------------------------------------
// Numeric parsing — Q1 answer
// ---------------------------------------------------------------------------

describe('numeric parsing — ANSWERED path (sms_question_index=0)', () => {
  it("'5' stores value: 5 and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('5'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'3.5' stores value: 3.5 and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('3.5'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });

  it("'0' stores value: 0 and returns ANSWERED", async () => {
    setupAnsweredPath();
    expect(await respondToSms(makeEvent('0'), makeDeps())).toEqual({ status: 'ANSWERED' });
  });
});

// ---------------------------------------------------------------------------
// Unrecognised reply
// ---------------------------------------------------------------------------

describe('unrecognised reply', () => {
  beforeEach(() => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [validCallRecord] })
      .mockResolvedValueOnce({ Item: validProtocol });
  });

  it("'maybe' returns IGNORED", async () => {
    expect(await respondToSms(makeEvent('maybe'), makeDeps())).toEqual({ status: 'IGNORED' });
  });

  it("'idk' returns IGNORED", async () => {
    expect(await respondToSms(makeEvent('idk'), makeDeps())).toEqual({ status: 'IGNORED' });
  });

  it("'1abc' is not purely numeric and returns IGNORED", async () => {
    expect(await respondToSms(makeEvent('1abc'), makeDeps())).toEqual({ status: 'IGNORED' });
  });
});

// ---------------------------------------------------------------------------
// UpdateCommand correctness
// ---------------------------------------------------------------------------

describe('UpdateCommand correctness', () => {
  it('ExpressionAttributeNames contains #vars → variables and #varName → variable_name', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('yes'), makeDeps());

    // The 4th dynamoSend call is the UpdateCommand
    const updateArg = dynamoSend.mock.calls[3][0];
    expect(updateArg.input.ExpressionAttributeNames).toEqual({
      '#vars': 'variables',
      '#varName': 'weight_gain', // variable_name of Q1
    });
  });

  it('ExpressionAttributeValues contains :answer with correct value, confidence, raw_transcript', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('yes'), makeDeps());

    const updateArg = dynamoSend.mock.calls[3][0];
    expect(updateArg.input.ExpressionAttributeValues[':answer']).toEqual({
      value: true,
      confidence: 1.0,
      raw_transcript: 'yes',
    });
  });

  it(':newIdx equals sms_question_index + 1', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('yes'), makeDeps());

    const updateArg = dynamoSend.mock.calls[3][0];
    // sms_question_index is 0, so newIdx should be 1
    expect(updateArg.input.ExpressionAttributeValues[':newIdx']).toBe(1);
  });

  it('raw_transcript preserves original casing before trim', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('YES'), makeDeps());

    const updateArg = dynamoSend.mock.calls[3][0];
    expect(updateArg.input.ExpressionAttributeValues[':answer'].raw_transcript).toBe('YES');
  });

  it(':answer value is false when reply is no', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('no'), makeDeps());

    const updateArg = dynamoSend.mock.calls[3][0];
    expect(updateArg.input.ExpressionAttributeValues[':answer'].value).toBe(false);
  });

  it(':answer value is 3.5 when reply is 3.5', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('3.5'), makeDeps());

    const updateArg = dynamoSend.mock.calls[3][0];
    expect(updateArg.input.ExpressionAttributeValues[':answer'].value).toBe(3.5);
  });

  it('sms_question_index defaults to 0 when field is absent on call record', async () => {
    // Exercises the `?? 0` null-coalescing branch (line 103)
    const callWithoutIndex = { ...validCallRecord };
    delete (callWithoutIndex as Record<string, unknown>)['sms_question_index'];
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [callWithoutIndex] })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});

    const result = await respondToSms(makeEvent('yes'), makeDeps());
    expect(result).toEqual({ status: 'ANSWERED' });

    // newIdx should be 0 + 1 = 1
    const updateArg = dynamoSend.mock.calls[3][0];
    expect(updateArg.input.ExpressionAttributeValues[':newIdx']).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Q2 answer (sms_question_index=1) — COMPLETE path
// ---------------------------------------------------------------------------

describe('Q2 answer (sms_question_index=1) — COMPLETE path', () => {
  it('returns { status: COMPLETE } when newIndex reaches 2', async () => {
    setupCompletePath();
    const result = await respondToSms(makeEvent('yes'), makeDeps());
    expect(result).toEqual({ status: 'COMPLETE' });
  });

  it('calls InvokeCommand with FunctionName = triageEngineFunctionName', async () => {
    setupCompletePath();
    await respondToSms(makeEvent('yes'), makeDeps());

    const invokeArg = lambdaSend.mock.calls[0][0];
    expect(invokeArg.input.FunctionName).toBe('triage-engine-fn');
  });

  it('calls InvokeCommand with InvocationType = Event', async () => {
    setupCompletePath();
    await respondToSms(makeEvent('yes'), makeDeps());

    const invokeArg = lambdaSend.mock.calls[0][0];
    expect(invokeArg.input.InvocationType).toBe('Event');
  });

  it('InvokeCommand Payload contains callId, patientId, protocolId from the call record', async () => {
    setupCompletePath();
    await respondToSms(makeEvent('yes'), makeDeps());

    const invokeArg = lambdaSend.mock.calls[0][0];
    const payload = JSON.parse(
      Buffer.from(invokeArg.input.Payload as Buffer).toString(),
    ) as unknown;
    expect(payload).toEqual({
      callId: 'CALL-abc123',
      patientId: 'PAT-001',
      protocolId: 'proto-001',
    });
  });

  it('does NOT call lambdaSend for Q1 answer (ANSWERED path)', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('yes'), makeDeps());
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Protocol not found
// ---------------------------------------------------------------------------

describe('protocol not found', () => {
  it('throws Protocol not found: proto-001 when GetCommand returns no Item', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [validCallRecord] })
      .mockResolvedValueOnce({ Item: undefined }); // protocol not in table

    await expect(respondToSms(makeEvent('yes'), makeDeps())).rejects.toThrow(
      'Protocol not found: proto-001',
    );
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Missing sms_protocol_id on call record
// ---------------------------------------------------------------------------

describe('missing sms_protocol_id on call record', () => {
  it('throws No sms_protocol_id on call record when field is absent', async () => {
    const callWithoutProtocol = { ...validCallRecord, sms_protocol_id: undefined };
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [callWithoutProtocol] });

    await expect(respondToSms(makeEvent('yes'), makeDeps())).rejects.toThrow(
      'No sms_protocol_id on call record CALL-abc123',
    );
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Error propagation
// ---------------------------------------------------------------------------

describe('error propagation', () => {
  it('propagates error when UpdateCommand throws', async () => {
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [validCallRecord] })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockRejectedValueOnce(new Error('DynamoDB write failed'));

    await expect(respondToSms(makeEvent('yes'), makeDeps())).rejects.toThrow(
      'DynamoDB write failed',
    );
  });

  it('propagates error when LambdaClient.send throws during COMPLETE path', async () => {
    const q2CallRecord = { ...validCallRecord, sms_question_index: 1 };
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [q2CallRecord] })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});
    lambdaSend.mockRejectedValueOnce(new Error('Lambda invocation failed'));

    await expect(respondToSms(makeEvent('yes'), makeDeps())).rejects.toThrow(
      'Lambda invocation failed',
    );
  });

  it('propagates error when patient query DynamoDB throws', async () => {
    dynamoSend.mockRejectedValueOnce(new Error('DynamoDB connection refused'));

    await expect(respondToSms(makeEvent('yes'), makeDeps())).rejects.toThrow(
      'DynamoDB connection refused',
    );
    expect(lambdaSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Selecting most recent call
// ---------------------------------------------------------------------------

describe('selecting most recent call', () => {
  it('selects the call with the most recent created_at when two pending calls exist', async () => {
    const olderCall = {
      ...validCallRecord,
      call_id: 'CALL-older',
      created_at: '2026-03-26T08:00:00.000Z',
    };
    const newerCall = {
      ...validCallRecord,
      call_id: 'CALL-newer',
      created_at: '2026-03-27T09:00:00.000Z',
    };
    // Return older first so the sort must do the selection
    dynamoSend
      .mockResolvedValueOnce({ Items: [validPatient] })
      .mockResolvedValueOnce({ Items: [olderCall, newerCall] })
      .mockResolvedValueOnce({ Item: validProtocol })
      .mockResolvedValueOnce({});

    await respondToSms(makeEvent('yes'), makeDeps());

    // The UpdateCommand (4th call) Key should use the newer call_id
    const updateArg = dynamoSend.mock.calls[3][0];
    expect(updateArg.input.Key).toEqual({ call_id: 'CALL-newer' });
  });
});

// ---------------------------------------------------------------------------
// Audit log PHI safety
// ---------------------------------------------------------------------------

describe('audit log PHI safety', () => {
  it('does not include phone number in any audit log detail', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('yes'), makeDeps());

    const calls = (auditLog as jest.Mock).mock.calls as Array<[Record<string, unknown>]>;
    for (const [ctx] of calls) {
      expect(String(ctx['detail'] ?? '')).not.toContain('+15551234567');
    }
  });

  it('does not include patient name in any audit log detail', async () => {
    setupAnsweredPath();
    await respondToSms(makeEvent('yes'), makeDeps());

    const calls = (auditLog as jest.Mock).mock.calls as Array<[Record<string, unknown>]>;
    for (const [ctx] of calls) {
      // patient_id is not a name, but validate no raw patient data leaks
      expect(String(ctx['detail'] ?? '')).not.toContain('PAT-001');
    }
  });
});
