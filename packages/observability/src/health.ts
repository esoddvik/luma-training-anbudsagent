/**
 * Health and readiness reporting. Spec section 47 requires `/health`,
 * `/ready` and a protected `/metrics` endpoint on the long-running services.
 *
 * The distinction matters operationally: `/health` answers "is this process
 * alive" and must stay cheap and dependency-free, so a platform restart loop
 * is never triggered by a slow database. `/ready` answers "should traffic be
 * routed here" and does check dependencies.
 */

export type CheckStatus = 'ok' | 'degraded' | 'failed';

export interface DependencyCheck {
  name: string;
  /** Resolves when the dependency is usable; rejects or returns false otherwise. */
  probe: () => Promise<boolean>;
  /** A failed non-critical dependency degrades readiness instead of failing it. */
  critical?: boolean;
}

export interface CheckResult {
  name: string;
  status: CheckStatus;
  durationMs: number;
  error?: string;
}

export interface ReadinessReport {
  status: CheckStatus;
  service: string;
  checks: CheckResult[];
}

export interface HealthReport {
  status: 'ok';
  service: string;
  uptimeSeconds: number;
}

export function buildHealthReport(service: string, uptimeSeconds: number): HealthReport {
  return { status: 'ok', service, uptimeSeconds: Math.floor(uptimeSeconds) };
}

/**
 * Runs every dependency probe concurrently with an individual timeout.
 *
 * A probe that hangs must not hang the readiness endpoint, or the platform's
 * own health check times out and the service is cycled for the wrong reason.
 */
export async function runReadinessChecks(
  service: string,
  checks: readonly DependencyCheck[],
  timeoutMs = 2000,
  now: () => number = () => performance.now(),
): Promise<ReadinessReport> {
  const results = await Promise.all(
    checks.map(async (check): Promise<CheckResult> => {
      const started = now();
      try {
        const passed = await withTimeout(check.probe(), timeoutMs);
        return {
          name: check.name,
          status: passed ? 'ok' : failureStatus(check),
          durationMs: Math.round(now() - started),
        };
      } catch (error) {
        return {
          name: check.name,
          status: failureStatus(check),
          durationMs: Math.round(now() - started),
          error: error instanceof Error ? error.message : 'unknown error',
        };
      }
    }),
  );

  return { status: aggregate(results), service, checks: results };
}

function failureStatus(check: DependencyCheck): CheckStatus {
  return check.critical === false ? 'degraded' : 'failed';
}

function aggregate(results: readonly CheckResult[]): CheckStatus {
  if (results.some((result) => result.status === 'failed')) return 'failed';
  if (results.some((result) => result.status === 'degraded')) return 'degraded';
  return 'ok';
}

/** HTTP status for a readiness report: only a hard failure removes the instance. */
export function readinessHttpStatus(report: ReadinessReport): number {
  return report.status === 'failed' ? 503 : 200;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
