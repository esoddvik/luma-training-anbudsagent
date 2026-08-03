/**
 * The background job runtime for `apps/core`.
 *
 * `boss.ts` owns the pg-boss instance and its lifecycle; `register.ts` owns
 * which queue calls which already-tested job function. Nothing else in the
 * application imports pg-boss directly.
 */
export {
  checkQueueHealth,
  DEAD_LETTER_QUEUE,
  isJobName,
  queueDependencyCheck,
  queueStatus,
  QUEUE_SCHEMA,
  startQueue,
  type QueueDepth,
  type QueueRuntime,
  type StartQueueOptions,
} from './boss.js';
export {
  createQueues,
  registerJobs,
  registerSchedules,
  type JobConfig,
  type RegisterJobsOptions,
} from './register.js';
