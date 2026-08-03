# Runbook

Operating Luma Anbudsvarsling. Spec §50 phase 6 requires this before launch.

Written for the person on call, which for a while will be the person who wrote the code. Each section says how to tell whether something is actually wrong, because several of the alarming-looking states here are normal.

## The shape of the system

Three services. `web` on Vercel serves the site and the dashboard. `core` on Railway runs the API, the queue worker and the scheduled jobs in one process. `mcp` on Railway serves the MCP endpoint and is separate specifically so a live demo stays responsive while an ingest or digest run is in flight.

One PostgreSQL on Railway holds everything, including the job queue (pg-boss creates its own schema in the same database). There is no Redis.

## Health

```bash
curl -s https://api.luma-training.com/health && curl -s https://mcp.luma-training.com/health
```

`/health` is liveness and takes no dependencies. It returns 200 even when the database is down — deliberately, so a slow dependency never makes the platform restart a healthy process.

`/ready` is the one that consults dependencies. It returns 503 only on a hard failure; a degraded non-critical dependency, such as Postmark, keeps the instance in rotation.

If `/health` is failing, the process is not running. Check the Railway deploy log, and read the **tail** of it unfiltered — a log that ends at "Build Completed" with no error usually means a post-build gate rejected the artifact, not that the code is broken.

## The Doffin ingest

Runs hourly. Watch it in `/admin/ingestion`, which reads `ingestion_runs`.

**A run with `status: partial` is not an emergency.** It means at least one notice failed to persist and the checkpoint was deliberately held back. The next run re-reads the same window. Look at `ingestion_errors` for that run to see which notice and why.

**The checkpoint not advancing across several runs is an emergency.** It means the same notice keeps failing and the window is never being cleared. Find it in `ingestion_errors`, and if the notice is genuinely unstorable, suppress it from admin and let the run complete.

**No new tenders for a day is usually not a fault.** Doffin publishes on business days, roughly 32 notices a day. A quiet Sunday is quiet. Compare against `numHitsTotal` before concluding anything.

**Rate limiting.** Doffin allows roughly 30 requests per 10 seconds and sends `Retry-After` on a 429. The adapter honours it. If you see sustained 429s, something is running ingest more often than hourly — check for a second instance.

**A 401 from Doffin means the subscription key is wrong or expired.** Retrying will not fix it and burns quota. The adapter treats 401 as non-retryable for that reason.

### Re-running ingest by hand

From admin, or:

```bash
curl -X POST https://api.luma-training.com/api/v1/admin/ingestion/run -H "authorization: Bearer $ADMIN_TOKEN"
```

Safe to run at any time. Re-ingest is idempotent: an unchanged notice produces no observable write and enqueues no match job, so it cannot cause a duplicate alert.

## Digests

The scheduler ticks every fifteen minutes and sends to each profile at its own local hour, computed against the profile's IANA timezone rather than an offset.

**A user says they did not get their digest.** In order: are their tender alerts on; does the profile have unsent included matches (an empty digest is deliberately not sent); is there a `notification_deliveries` row for that profile and day; did Postmark bounce or suppress the address.

**A user says they got the same tender twice.** This should be impossible — a tender already delivered to a profile is excluded by query, and the delivery is claimed under a unique idempotency key. If it happened, get the two Postmark message ids and the delivery rows; that is a real bug and worth stopping to understand.

**A crash between claiming and sending loses one digest.** This is the intended trade: the alternative is sending two. The tenders stay unsent and appear in the next digest, so nothing is lost permanently.

## Email

Three Postmark streams: `transactional`, `tender-notifications`, `luma-marketing`. The mapping from template to stream is enforced by types, so a magic link cannot go out on the marketing stream.

**A spike in spam complaints** is the signal that matters most, more than bounce rate. Check what went out immediately before it. If a promotion block is implicated, the fastest safe action is to deactivate the editorial recommendation in admin, which takes effect on the next digest without a deploy.

**Withdrawing marketing consent must never stop tender alerts.** If a user reports losing alerts after unsubscribing from something, that is a bug, not a preference.

## Database

Backups are Railway's. **A backup nobody has restored is not a backup** — schedule a restore drill into a scratch database and record the date here when done. *(Not yet done.)*

Migrations run through `pnpm db:migrate`, which reads `DATABASE_URL` directly rather than through the full environment parser, so a release step does not need a Postmark token to migrate a schema.

`consent_events` and `user_legal_acceptances` have a trigger that refuses UPDATE and DELETE. If a migration or a cleanup script fails against those tables, that is the trigger doing its job. The only permitted update is severing `user_id` on account deletion, and the trigger checks that nothing else changed in the same statement.

## Security incidents

**A leaked MCP token.** Revoke it from admin or `/api/v1/mcp-tokens/:id/revoke`. Tokens are stored only as peppered hashes, so there is nothing to rotate beyond the token itself. Revocation takes effect on the next request.

**A leaked share link.** Revoke from admin. An expired or revoked link returns 410 with a neutral page, never a 404, so revoking does not tell anyone whether the token was real.

**A leaked session.** Log out all sessions for that user. Sessions are opaque and database-backed precisely so this is immediate rather than waiting for a token to expire.

**A leaked Doffin subscription key.** Rotate it in the Doffin developer portal and update `DOFFIN_SUBSCRIPTION_KEY` on Railway. Ingest will fail with 401 until it is updated, which is visible in `ingestion_runs` within the hour.

## What is deliberately not logged

Never in logs: a full MCP token, a magic link, a share token in cleartext, a full user prompt, or an unredacted email address. Two layers enforce it — pino redacts structured fields, and a scrubber catches credentials that reach a message string from a library we do not control.

If you need a value that is redacted in order to debug, get it from the database rather than loosening the redaction.

## Things that look wrong and are not

- `municipalities` is always empty. Doffin has no municipality field; NUTS-3 is the finest geography available.
- `estimatedValue` is missing on roughly half of all tenders. That is the source, not a parsing failure.
- `modified_at` is often null and never comes from Doffin. It records when *our* ingest last saw a change.
- A tender with `locationId: "anyw"` is nationwide, not unlocated. It matches every profile geography.
- An intention notice is categorised as *planned* even though Doffin files it under its award roll-up. That is deliberate and tested.
