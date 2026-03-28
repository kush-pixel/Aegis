import type { DynamoDBStreamEvent } from 'aws-lambda';
import { publishUpdates } from './handler';
import type { AppSyncPublisherDeps } from './handler';

function buildDeps(): AppSyncPublisherDeps {
  return {
    appsyncEndpoint: process.env['APPSYNC_ENDPOINT'] ?? '',
    appsyncApiKey: process.env['APPSYNC_API_KEY'] ?? '',
    fetchFn: fetch as AppSyncPublisherDeps['fetchFn'],
  };
}

export const handler = async (event: DynamoDBStreamEvent): Promise<unknown> => {
  return publishUpdates(event, buildDeps());
};
