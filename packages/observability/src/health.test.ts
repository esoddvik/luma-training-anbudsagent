import { describe, expect, it } from 'vitest';
import {
  buildHealthReport,
  readinessHttpStatus,
  runReadinessChecks,
  type DependencyCheck,
} from './health.js';

const ok = (name: string): DependencyCheck => ({ name, probe: async () => true });
const failing = (name: string): DependencyCheck => ({ name, probe: async () => false });
const throwing = (name: string, message: string): DependencyCheck => ({
  name,
  probe: async () => {
    throw new Error(message);
  },
});

describe('buildHealthReport', () => {
  it('reports liveness without consulting any dependency', () => {
    expect(buildHealthReport('core', 12.7)).toEqual({
      status: 'ok',
      service: 'core',
      uptimeSeconds: 12,
    });
  });
});

describe('runReadinessChecks', () => {
  it('is ok when every dependency passes', async () => {
    const report = await runReadinessChecks('core', [ok('database'), ok('queue')]);
    expect(report.status).toBe('ok');
    expect(report.checks.map((c) => c.name)).toEqual(['database', 'queue']);
  });

  it('is ok with no dependencies registered', async () => {
    expect((await runReadinessChecks('mcp', [])).status).toBe('ok');
  });

  it('fails when a critical dependency returns false', async () => {
    const report = await runReadinessChecks('core', [ok('queue'), failing('database')]);
    expect(report.status).toBe('failed');
    expect(report.checks.find((c) => c.name === 'database')?.status).toBe('failed');
  });

  it('fails when a critical dependency throws, and records the reason', async () => {
    const report = await runReadinessChecks('core', [throwing('database', 'ECONNREFUSED')]);
    expect(report.status).toBe('failed');
    expect(report.checks[0]?.error).toBe('ECONNREFUSED');
  });

  it('degrades rather than fails when a non-critical dependency is down', async () => {
    const report = await runReadinessChecks('core', [
      ok('database'),
      { name: 'postmark', critical: false, probe: async () => false },
    ]);
    expect(report.status).toBe('degraded');
  });

  it('prefers failed over degraded when both are present', async () => {
    const report = await runReadinessChecks('core', [
      failing('database'),
      { name: 'postmark', critical: false, probe: async () => false },
    ]);
    expect(report.status).toBe('failed');
  });

  it('times out a probe that never settles instead of hanging', async () => {
    const hanging: DependencyCheck = { name: 'database', probe: () => new Promise(() => {}) };
    const report = await runReadinessChecks('core', [hanging], 20);
    expect(report.status).toBe('failed');
    expect(report.checks[0]?.error).toMatch(/timed out/);
  });

  it('still reports a healthy dependency when a sibling times out', async () => {
    const hanging: DependencyCheck = { name: 'queue', probe: () => new Promise(() => {}) };
    const report = await runReadinessChecks('core', [ok('database'), hanging], 20);
    expect(report.checks.find((c) => c.name === 'database')?.status).toBe('ok');
  });
});

describe('readinessHttpStatus', () => {
  it('returns 503 only for a hard failure', () => {
    expect(readinessHttpStatus({ status: 'failed', service: 'core', checks: [] })).toBe(503);
  });

  it('keeps a degraded instance in rotation', () => {
    expect(readinessHttpStatus({ status: 'degraded', service: 'core', checks: [] })).toBe(200);
    expect(readinessHttpStatus({ status: 'ok', service: 'core', checks: [] })).toBe(200);
  });
});
