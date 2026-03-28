import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { bridgeCall } from '../handler';
import type { ConnectContactFlowEvent, CallBridgeDeps } from '../handler';
import { auditLog } from '@aegis/audit';

jest.mock('@aegis/audit', () => ({
  auditLog: jest.fn(),
}));

jest.mock('@aegis/validation', () => ({
  validatePatientId: jest.requireActual('@aegis/validation').validatePatientId,
}));

const CALL_ID = 'CALL-abc123';
const PATIENT_ID = 'patient-xyz';
const PROTOCOL_ID = 'proto-001';

const mockCallRecord = {
  call_id: CALL_ID,
  patient_id: PATIENT_ID,
  variables: {},
  sdoh_responses: {
    medication_cost_barrier: false,
    transportation_barrier: false,
    z_codes: [],
  },
  triage_status: 'INCOMPLETE',
  created_at: '2026-03-27T00:00:00.000Z',
};

const validEvent: ConnectContactFlowEvent = {
  Details: {
    ContactData: {
      Attributes: {
        callId: CALL_ID,
        patientId: PATIENT_ID,
        protocolId: PROTOCOL_ID,
      },
      Channel: 'VOICE',
      ContactId: 'contact-001',
      InitialContactId: 'contact-001',
      InstanceARN: 'arn:aws:connect:us-east-1:123456789012:instance/abc',
    },
    Parameters: {},
  },
  Name: 'ContactFlowEvent',
};

function makeDeps(dynamoSend: jest.Mock, lambdaSend: jest.Mock): CallBridgeDeps {
  return {
    dynamo: { send: dynamoSend } as unknown as DynamoDBDocumentClient,
    lambdaClient: { send: lambdaSend } as unknown as LambdaClient,
    resultsTable: 'CallResults',
    sentinelFunctionName: 'sentinel-nova-sonic-handler',
  };
}

describe('bridgeCall', () => {
  let dynamoSend: jest.Mock;
  let lambdaSend: jest.Mock;
  let deps: CallBridgeDeps;

  beforeEach(() => {
    jest.clearAllMocks();
    dynamoSend = jest.fn();
    lambdaSend = jest.fn();
    deps = makeDeps(dynamoSend, lambdaSend);
  });

  it('returns { status: BRIDGE_OK, callId } on success', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: mockCallRecord });
    lambdaSend.mockResolvedValueOnce({ StatusCode: 202, $metadata: {} });

    const result = await bridgeCall(validEvent, deps);

    expect(result).toEqual({ status: 'BRIDGE_OK', callId: CALL_ID });
  });

  it('invokes sentinel Lambda with InvocationType Event', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: mockCallRecord });
    lambdaSend.mockResolvedValueOnce({ StatusCode: 202, $metadata: {} });

    await bridgeCall(validEvent, deps);

    const invokeArg = lambdaSend.mock.calls[0][0];
    expect(invokeArg.input.InvocationType).toBe('Event');
  });

  it('invokes sentinel Lambda with correct payload containing callId, patientId, protocolId', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: mockCallRecord });
    lambdaSend.mockResolvedValueOnce({ StatusCode: 202, $metadata: {} });

    await bridgeCall(validEvent, deps);

    const invokeArg = lambdaSend.mock.calls[0][0];
    const payload = JSON.parse(Buffer.from(invokeArg.input.Payload as Buffer).toString());
    expect(payload).toEqual({ callId: CALL_ID, patientId: PATIENT_ID, protocolId: PROTOCOL_ID });
  });

  it('invokes sentinel Lambda with correct FunctionName from deps', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: mockCallRecord });
    lambdaSend.mockResolvedValueOnce({ StatusCode: 202, $metadata: {} });

    await bridgeCall(validEvent, deps);

    const invokeArg = lambdaSend.mock.calls[0][0];
    expect(invokeArg.input.FunctionName).toBe('sentinel-nova-sonic-handler');
  });

  it('fires audit log once with callId and no PHI in detail', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: mockCallRecord });
    lambdaSend.mockResolvedValueOnce({ StatusCode: 202, $metadata: {} });

    await bridgeCall(validEvent, deps);

    expect(auditLog).toHaveBeenCalledTimes(1);
    expect(auditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'call_bridge_invoked',
        callId: CALL_ID,
      }),
    );
    const ctx = (auditLog as jest.Mock).mock.calls[0][0] as Record<string, string>;
    expect(ctx['detail']).not.toContain(PATIENT_ID);
    expect(ctx['detail']).not.toContain(PROTOCOL_ID);
  });

  it('throws and makes no AWS calls when callId is missing', async () => {
    const event: ConnectContactFlowEvent = {
      ...validEvent,
      Details: {
        ...validEvent.Details,
        ContactData: {
          ...validEvent.Details.ContactData,
          Attributes: { patientId: PATIENT_ID, protocolId: PROTOCOL_ID },
        },
      },
    };

    await expect(bridgeCall(event, deps)).rejects.toThrow('Missing required parameter: callId');
    expect(dynamoSend).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('throws and makes no AWS calls when patientId is missing', async () => {
    const event: ConnectContactFlowEvent = {
      ...validEvent,
      Details: {
        ...validEvent.Details,
        ContactData: {
          ...validEvent.Details.ContactData,
          Attributes: { callId: CALL_ID, protocolId: PROTOCOL_ID },
        },
      },
    };

    await expect(bridgeCall(event, deps)).rejects.toThrow('Missing required parameter: patientId');
    expect(dynamoSend).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('throws and makes no AWS calls when protocolId is missing', async () => {
    const event: ConnectContactFlowEvent = {
      ...validEvent,
      Details: {
        ...validEvent.Details,
        ContactData: {
          ...validEvent.Details.ContactData,
          Attributes: { callId: CALL_ID, patientId: PATIENT_ID },
        },
      },
    };

    await expect(bridgeCall(event, deps)).rejects.toThrow('Missing required parameter: protocolId');
    expect(dynamoSend).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('throws Invalid patientId when patientId is an empty string', async () => {
    const event: ConnectContactFlowEvent = {
      ...validEvent,
      Details: {
        ...validEvent.Details,
        ContactData: {
          ...validEvent.Details.ContactData,
          Attributes: { callId: CALL_ID, patientId: '   ', protocolId: PROTOCOL_ID },
        },
      },
    };

    await expect(bridgeCall(event, deps)).rejects.toThrow('Invalid patientId');
    expect(dynamoSend).not.toHaveBeenCalled();
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('throws Call record not found when DynamoDB returns Item: undefined', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: undefined });

    await expect(bridgeCall(validEvent, deps)).rejects.toThrow('Call record not found');
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('throws Call record not found when DynamoDB returns empty object', async () => {
    dynamoSend.mockResolvedValueOnce({});

    await expect(bridgeCall(validEvent, deps)).rejects.toThrow('Call record not found');
    expect(lambdaSend).not.toHaveBeenCalled();
  });

  it('propagates Lambda invocation error and does not call auditLog', async () => {
    dynamoSend.mockResolvedValueOnce({ Item: mockCallRecord });
    lambdaSend.mockRejectedValueOnce(new Error('Lambda service unavailable'));

    await expect(bridgeCall(validEvent, deps)).rejects.toThrow('Lambda service unavailable');
    expect(auditLog).not.toHaveBeenCalled();
  });

  it('propagates DynamoDB error and makes no Lambda or audit calls', async () => {
    dynamoSend.mockRejectedValueOnce(new Error('DynamoDB connection refused'));

    await expect(bridgeCall(validEvent, deps)).rejects.toThrow('DynamoDB connection refused');
    expect(lambdaSend).not.toHaveBeenCalled();
    expect(auditLog).not.toHaveBeenCalled();
  });
});
