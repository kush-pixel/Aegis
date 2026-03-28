import type { DynamoDBStreamEvent } from 'aws-lambda';
import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import { auditLog } from '@aegis/audit';

const TRIAGE_STATUS_SET = new Set(['RED', 'YELLOW', 'GREEN']);

const PUBLISH_MUTATION = `mutation PublishTriageUpdate(
  $callId: String!
  $patientId: String!
  $triageStatus: String!
  $callStatus: String
  $isbarrSummary: AWSJSON
  $updatedAt: String!
) {
  publishTriageUpdate(
    callId: $callId
    patientId: $patientId
    triageStatus: $triageStatus
    callStatus: $callStatus
    isbarrSummary: $isbarrSummary
    updatedAt: $updatedAt
  ) {
    callId
  }
}`;

export interface AppSyncPublisherDeps {
  appsyncEndpoint: string;
  appsyncApiKey: string;
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
}

export interface PublishUpdatesResult {
  batchItemFailures: { itemIdentifier: string }[];
}

interface UnmarshalledRecord {
  call_id: string;
  patient_id: string;
  triage_status?: string;
  call_status?: string;
  isbarr_summary?: unknown;
}

function isMeaningfulChange(
  newImage: UnmarshalledRecord,
  oldImage: UnmarshalledRecord | null,
): boolean {
  // call_status changed to COMPLETE
  if (
    newImage.call_status === 'COMPLETE' &&
    oldImage?.call_status !== 'COMPLETE'
  ) {
    return true;
  }

  // triage_status set to a terminal value (was different or insert)
  if (
    TRIAGE_STATUS_SET.has(newImage.triage_status ?? '') &&
    newImage.triage_status !== oldImage?.triage_status
  ) {
    return true;
  }

  // isbarr_summary written for the first time
  if (newImage.isbarr_summary !== undefined && oldImage?.isbarr_summary === undefined) {
    return true;
  }

  return false;
}

export async function publishUpdates(
  event: DynamoDBStreamEvent,
  deps: AppSyncPublisherDeps,
): Promise<PublishUpdatesResult> {
  const { appsyncEndpoint, appsyncApiKey, fetchFn } = deps;

  for (const record of event.Records) {
    if (record.eventName === 'REMOVE' || !record.dynamodb?.NewImage) {
      continue;
    }

    const newImage = unmarshall(
      record.dynamodb.NewImage as Record<string, AttributeValue>,
    ) as UnmarshalledRecord;

    const oldImage = record.dynamodb.OldImage
      ? (unmarshall(
          record.dynamodb.OldImage as Record<string, AttributeValue>,
        ) as UnmarshalledRecord)
      : null;

    if (!isMeaningfulChange(newImage, oldImage)) {
      continue;
    }

    const callId: string = newImage.call_id;

    const variables: Record<string, unknown> = {
      callId,
      patientId: newImage.patient_id,
      triageStatus: newImage.triage_status ?? 'INCOMPLETE',
      callStatus: newImage.call_status ?? null,
      isbarrSummary:
        newImage.isbarr_summary !== undefined
          ? JSON.stringify(newImage.isbarr_summary)
          : null,
      updatedAt: new Date().toISOString(),
    };

    try {
      const response = await fetchFn(appsyncEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': appsyncApiKey,
        },
        body: JSON.stringify({ query: PUBLISH_MUTATION, variables }),
      });

      if (!response.ok) {
        throw new Error(`AppSync returned HTTP ${response.status}`);
      }

      auditLog({
        action: 'appsync_update_published',
        actor: 'appsync-publisher',
        resource: 'AppSync',
        callId,
        detail: `Published triageStatus=${newImage.triage_status ?? 'INCOMPLETE'}`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      auditLog({
        action: 'appsync_publish_failed',
        actor: 'appsync-publisher',
        resource: 'AppSync',
        callId,
        detail: `Publish failed: ${message}`,
      });
    }
  }

  return { batchItemFailures: [] };
}
