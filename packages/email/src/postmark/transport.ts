import { ServerClient } from 'postmark';
import { getCoreEnv } from '@luma/config';
import { createLogger, type Logger } from '@luma/observability';
import { PostmarkEmailClient, type EmailClient, type PostmarkTransport } from './client.js';
import { streamIdsFromEnv } from './streams.js';

/**
 * The Postmark SDK, behind `PostmarkTransport`.
 *
 * Everything above this file is testable without a network. This is the only
 * place the SDK is constructed, so the token has exactly one reader.
 */
export function createPostmarkTransport(serverToken: string): PostmarkTransport {
  const client = new ServerClient(serverToken);
  return {
    async sendEmail(message) {
      const response = await client.sendEmail(message);
      return {
        MessageID: response.MessageID,
        SubmittedAt: response.SubmittedAt,
        ErrorCode: response.ErrorCode,
        Message: response.Message,
      };
    },
    async getSuppressions(messageStream, filter) {
      const response = await client.getSuppressions(messageStream, {
        emailAddress: filter.emailAddress,
      });
      return { Suppressions: response.Suppressions };
    },
  };
}

/**
 * Builds the production client from `CoreEnv`.
 *
 * Lazy: `getCoreEnv()` validates on first access, so importing this module for
 * its types never crashes a process that has no Postmark configuration.
 */
export function createEmailClientFromEnv(options?: { logger?: Logger }): EmailClient {
  const env = getCoreEnv();
  return new PostmarkEmailClient({
    transport: createPostmarkTransport(env.POSTMARK_SERVER_TOKEN),
    streams: streamIdsFromEnv(env),
    from: env.AUTH_EMAIL_FROM,
    logger: options?.logger ?? createLogger({ service: 'email', level: env.LOG_LEVEL }),
  });
}
