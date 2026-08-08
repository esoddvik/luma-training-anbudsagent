/**
 * Job names (spec §38).
 *
 * Declared in one place because a job name is a wire contract: a producer and
 * a consumer that disagree by one character produce a queue that fills and a
 * worker that idles, with nothing in the logs to say why.
 */
export const JOB = {
  tenderNormalize: 'tender.normalize',
  tenderMatch: 'tender.match',
  tenderChangeDetect: 'tender.change-detect',
  notificationImmediatePrepare: 'notification.immediate.prepare',
  notificationDigestPrepare: 'notification.digest.prepare',
  emailSend: 'email.send',
  postmarkWebhookProcess: 'postmark.webhook.process',
  feedbackProcess: 'feedback.process',
  orderRequestNotify: 'order.request.notify',
  consentSync: 'consent.sync',
  shareCleanup: 'share.cleanup',
  signupCleanup: 'signup.cleanup',
  doffinSync: 'doffin.sync',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

export const ALL_JOB_NAMES: readonly JobName[] = Object.values(JOB);

/**
 * Cron schedules, in the timezone the scheduler runs in.
 *
 * The digest scheduler runs every fifteen minutes rather than hourly because
 * spec §38 requires each user's local send hour to be respected, and a user
 * can pick any hour in any timezone. A quarter-hour tick is the coarsest
 * interval that still lands inside every hour boundary comfortably.
 */
export const CRON = {
  /** Doffin publishes on business days; hourly is well inside the rate limit. */
  doffinSync: '0 * * * *',
  digestScheduler: '*/15 * * * *',
  /** Expired share links, overnight. */
  shareCleanup: '30 3 * * *',
  /**
   * Expired pending signups, overnight, offset from the share sweep.
   *
   * Ten minutes later rather than the same minute so that two unrelated
   * delete-heavy jobs do not contend, and so an error in the log can be
   * attributed to one of them without reading the message.
   */
  signupCleanup: '40 3 * * *',
} as const;
