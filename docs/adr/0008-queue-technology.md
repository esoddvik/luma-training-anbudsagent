# ADR-0008: Queue technology

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §12, §35, §36, §38, §47, §48, §49 (ADR 8)

## Context

Spec §38 lists eleven job types: `tender.normalize`, `tender.match`, `tender.change-detect`, `notification.immediate.prepare`, `notification.digest.prepare`, `email.send`, `postmark.webhook.process`, `feedback.process`, `order.request.notify`, `consent.sync` and `share.cleanup`. The requirements are at-least-once tolerance, idempotency keys, exponential backoff, a failed-job view, no duplicate emails, graceful shutdown and clean database connection closing. Scheduled work includes Doffin sync and a digest scheduler that may run every fifteen minutes and must respect each user's local time.

§35 allows "Redis eller PostgreSQL-basert kø" and §48 lists `REDIS_URL` as an environment variable. So Redis is permitted, not required.

Volume matters here. At realistic Doffin publication rates the system handles on the order of thousands of jobs per day, with bursts during ingest and digest fan-out. That is two to three orders of magnitude below where a Postgres-backed queue starts to hurt.

The decisive property is different from throughput, though. Consider the ingest job: it upserts tenders and enqueues match jobs. With a separate broker, those two writes are in different systems. A crash between them either loses match jobs (tenders ingested, never matched, silent under-delivery) or duplicates them. With a Postgres-backed queue, the enqueue is in the same transaction as the upsert, and the question disappears.

## Decision

Use **pg-boss** (pinned to the 12.x line) on the same PostgreSQL instance. No Redis. `REDIS_URL` is not defined in the environment schema.

pg-boss also provides cron scheduling, so scheduled work uses pg-boss schedules rather than a separate scheduler:

| Schedule | Cadence | Job |
| --- | --- | --- |
| Doffin sync | Frequent, checkpointed with an overlapping window (§12) | `doffin.sync` |
| Digest scheduler | Every 15 minutes, resolving each user's `digestHourLocal` and `timezone` (§38) | `notification.digest.prepare` |
| Cleanup | Daily | `share.cleanup` and retention tasks |

Implementation rules:

- pg-boss runs inside `apps/core` (ADR-0001), in the same process as the Fastify API.
- Job payloads are validated with Zod on both enqueue and handle.
- Every handler is idempotent and carries an explicit idempotency key. `email.send` keys on the `notification_delivery_items` unique constraint (§37) so a retried job cannot produce a second email.
- Enqueues that follow a data write share that write's transaction, using pg-boss's ability to insert into its job table on a supplied connection.
- Retries use exponential backoff. Exhausted jobs land in the dead-letter state and are surfaced in admin (§45) and in `/metrics` (§47).
- Graceful shutdown stops polling, waits for in-flight handlers, then closes the pool (§38).
- Queue depth, oldest-job age and failure counts are exported as metrics; a stalled queue triggers an alert (§47).

## Consequences

### Positive

- **Transactional enqueue.** The ingest correctness problem above is structurally solved rather than mitigated with reconciliation logic.
- **One stateful service.** Postgres is already required, backed up, monitored and restore-tested. Adding Redis would mean a second stateful component with its own persistence configuration, its own failure modes and its own place in the runbook, for a queue that is not throughput-bound.
- **Jobs are inspectable with SQL.** Debugging a stuck digest is a query, not a Redis CLI session. Admin's failed-job view (§38, §45) is an ordinary table read.
- **Durability is Postgres durability.** No question about whether the broker's persistence configuration survives a restart.
- **Cron is in the same system.** No Vercel Cron reaching into a Railway process, no separate scheduler container, and `CRON_SECRET` is needed only for any externally triggered admin operations rather than for core scheduling.
- One less environment variable, one less connection string to rotate, one less cost line.

### Negative / trade-offs

- Queue load lands on the primary database. Job polling and completion are writes, so the queue competes with application queries for the same connection pool and WAL. At the stated volume this is small, but it is real, and it means a queue storm and a slow dashboard are correlated. Mitigation: a separate, bounded connection pool for pg-boss, and queue-depth alerting so a storm is visible before it is felt.
- Throughput ceiling is far lower than a dedicated broker. Accepted knowingly. The trigger for revisiting is sustained queue depth or oldest-job age exceeding the alert threshold under normal (non-incident) load, not a hypothetical growth curve.
- pg-boss creates and migrates its own schema. That schema is versioned by the library, so a pg-boss major upgrade is a database migration and must be treated as one, with a backup taken first. This is why the version is pinned to a line rather than left open.
- Polling means latency is bounded below by the poll interval. Immediate alerts are therefore near-immediate, not instant. Acceptable for email delivery.
- No fan-out or pub/sub primitives. Not needed by any of the eleven job types.

## Alternatives considered

- **BullMQ on Redis.** Rejected: adds a stateful service, and breaks transactional enqueue, which is the property that motivated the decision. Redis would win on raw throughput, which is not a constraint here.
- **Graphile Worker.** A close second, and a legitimate alternative with a similar Postgres-native model. pg-boss was chosen for its built-in cron scheduling, which removes the need for a separate scheduling mechanism for the digest and sync jobs.
- **Vercel Cron plus serverless functions.** Rejected by §36, which forbids running Doffin ingest as a request-bound Vercel function, and by the checkpoint rule in §12 that a partial run must not advance the checkpoint.
- **A hand-rolled `SELECT ... FOR UPDATE SKIP LOCKED` queue.** Rejected: retries, backoff, dead-lettering, cron and graceful shutdown are exactly what a library should own. §49 says use one clear implementation, not a bespoke one.
- **Railway cron services (one container per scheduled job).** Rejected: three more deploy units, and cold-start scheduling with no shared job state or failed-job view.

## Verification

- A test asserts the environment schema in `packages/config` does not define `REDIS_URL`, and a source scan asserts no import of `ioredis`, `redis` or `bullmq` anywhere in the workspace.
- `apps/core/package.json` pins `pg-boss` to the 12.x line; a CI check asserts the resolved major version is 12.
- A test asserts `apps/web` and `apps/mcp` do not depend on `pg-boss`: only `core` runs jobs.
- A transactional-enqueue test opens a transaction, upserts a tender, enqueues a `tender.match` job on the same connection, then rolls back, and asserts no job row exists.
- An at-least-once test invokes each handler twice with the same payload and asserts the second invocation produces no additional side effect: no second `notification_delivery_items` row, no second Postmark call in the test double, no duplicate `tender_matches` row.
- A digest-timing test sets three users to different timezones and `digestHourLocal` values, advances a fake clock through 24 simulated hours of 15-minute ticks, and asserts each user receives exactly one digest at their local hour.
- A shutdown test sends SIGTERM mid-handler and asserts the handler completes, no new job is picked up, and the pool is closed with no open connections remaining.
- A backoff test asserts a repeatedly failing job retries with increasing delay and reaches the dead-letter state, and that the admin failed-job query returns it.
- A metrics test asserts `/metrics` exposes queue depth and oldest-job age per queue name.
