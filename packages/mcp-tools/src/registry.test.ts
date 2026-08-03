import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { McpScope } from './auth.js';
import { readOnlyPorts, type ToolPorts } from './ports.js';
import { defineReadTool, defineWriteTool, invokeToolFrom } from './registry.js';
import { LUMA_TOOLS, invokeTool } from './tools/index.js';
import { createInMemoryPorts } from './testing/in-memory-ports.js';
import { CALLER_A, DEFAULT_SEED, FIXED_NOW, callerFor, USER_A } from './testing/fixtures.js';

/**
 * The invocation pipeline: scope, input, ports, audit.
 *
 * Every property asserted here is one the tools rely on rather than
 * re-implement, so a regression in this file is a regression in all nine.
 */

function ports(): ReturnType<typeof createInMemoryPorts> {
  return createInMemoryPorts(DEFAULT_SEED);
}

/** Ports that fail loudly if anything reads or writes through them. */
function trapPorts(): ToolPorts {
  const boom = (name: string) => () => {
    throw new Error(`port ${name} must not be reached`);
  };
  const audit = createInMemoryPorts();
  return {
    tenders: {
      searchTenders: boom('searchTenders'),
      getTender: boom('getTender'),
      listChanges: boom('listChanges'),
      listMatchCandidates: boom('listMatchCandidates'),
    },
    profiles: { listProfiles: boom('listProfiles'), getProfile: boom('getProfile') },
    userTenderState: {
      getState: boom('getState'),
      listStates: boom('listStates'),
      saveTender: boom('saveTender'),
      dismissTender: boom('dismissTender'),
    },
    audit: audit.audit,
  };
}

describe('the registry', () => {
  it('exposes exactly the nine MVP tools spec 32.1 lists, in order', () => {
    expect(LUMA_TOOLS.map((tool) => tool.name)).toEqual([
      'search_tenders',
      'find_matching_tenders',
      'get_tender',
      'explain_tender_match',
      'list_alert_profiles',
      'get_alert_profile',
      'save_tender',
      'dismiss_tender',
      'get_luma_learning_resource',
    ]);
  });

  it('declares at least one scope on every tool', () => {
    for (const tool of LUMA_TOOLS) {
      expect(tool.requiredScopes.length).toBeGreaterThan(0);
    }
  });

  it('gives every tool a Norwegian title and description for the calling model', () => {
    for (const tool of LUMA_TOOLS) {
      expect(tool.title.length).toBeGreaterThan(0);
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it('marks exactly one tool as Luma content, and it is the learning resource', () => {
    const luma = LUMA_TOOLS.filter((tool) => tool.lumaContent);
    expect(luma.map((tool) => tool.name)).toEqual(['get_luma_learning_resource']);
  });

  it('marks only save_tender and dismiss_tender as writes', () => {
    const writes = LUMA_TOOLS.filter((tool) => tool.kind === 'write');
    expect(writes.map((tool) => tool.name)).toEqual(['save_tender', 'dismiss_tender']);
  });

  it('requires a write scope for every write tool and none for a read tool', () => {
    for (const tool of LUMA_TOOLS) {
      const writeScopes = tool.requiredScopes.filter((scope) => scope.endsWith(':write'));
      if (tool.kind === 'write') expect(writeScopes.length).toBeGreaterThan(0);
      else expect(writeScopes).toEqual([]);
    }
  });
});

describe('scope enforcement', () => {
  it('refuses every tool when the required scope is missing, before touching a port', async () => {
    for (const tool of LUMA_TOOLS) {
      const missing = tool.requiredScopes[0] as McpScope;
      const caller = callerFor(
        USER_A,
        tool.requiredScopes.filter((scope) => scope !== missing),
      );

      const result = await invokeTool(
        tool.name,
        {},
        { caller, ports: trapPorts(), now: FIXED_NOW },
      );

      expect(result.ok, `${tool.name} should refuse without ${missing}`).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('forbidden');
        expect(result.message).toContain(missing);
      }
    }
  });

  it('checks the scope before it validates the input', async () => {
    // Malformed input plus a missing scope must answer "forbidden". Answering
    // "invalid_input" would tell an unauthorised caller which arguments exist.
    const caller = callerFor(USER_A, ['tenders:read']);
    const result = await invokeTool(
      'get_alert_profile',
      { profileId: 'ikke-en-id' },
      { caller, ports: trapPorts(), now: FIXED_NOW },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('forbidden');
  });

  it('will not let a read-scoped token write', async () => {
    const readOnly = callerFor(USER_A, ['tenders:read', 'profiles:read', 'saved:read']);
    const injected = ports();

    const result = await invokeTool(
      'save_tender',
      { tenderId: DEFAULT_SEED.tenders?.[0]?.id },
      { caller: readOnly, ports: injected, now: FIXED_NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('forbidden');
    expect(injected.savedStates).toEqual([]);
  });
});

describe('read tools cannot write', () => {
  it('hands a read tool a state port with no write method on it at runtime', async () => {
    let seen: object | undefined;
    const probe = defineReadTool({
      name: 'probe_read',
      title: 'Probe',
      description: 'Testverktøy som ser på portene det får utlevert.',
      requiredScopes: ['tenders:read'],
      lumaContent: false,
      inputSchema: z.object({}),
      handler: async (_input, context) => {
        seen = context.ports.userTenderState;
        return { ok: true };
      },
    });

    await invokeToolFrom(
      [probe],
      'probe_read',
      {},
      { caller: CALLER_A, ports: ports(), now: FIXED_NOW },
    );

    expect(seen).toBeDefined();
    expect(Object.keys(seen ?? {})).toEqual(['getState', 'listStates']);
    expect('saveTender' in (seen ?? {})).toBe(false);
    expect('dismissTender' in (seen ?? {})).toBe(false);
  });

  it('hands a write tool the full state port', async () => {
    let seen: object | undefined;
    const probe = defineWriteTool({
      name: 'probe_write',
      title: 'Probe',
      description: 'Testverktøy som ser på portene det får utlevert.',
      requiredScopes: ['saved:write'],
      lumaContent: false,
      inputSchema: z.object({}),
      handler: async (_input, context) => {
        seen = context.ports.userTenderState;
        return { ok: true };
      },
    });

    await invokeToolFrom(
      [probe],
      'probe_write',
      {},
      { caller: CALLER_A, ports: ports(), now: FIXED_NOW },
    );

    expect('saveTender' in (seen ?? {})).toBe(true);
  });

  it('strips the write methods in readOnlyPorts rather than only hiding them in the type', () => {
    const projected = readOnlyPorts(ports());
    expect(Object.keys(projected.userTenderState).sort()).toEqual(['getState', 'listStates']);
  });
});

describe('input validation', () => {
  it('rejects a malformed id with a Norwegian message naming the field', async () => {
    const result = await invokeTool(
      'get_tender',
      { tenderId: 'ikke-en-id' },
      { caller: CALLER_A, ports: ports(), now: FIXED_NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('invalid_input');
      expect(result.message).toContain('Ugyldige parametre');
      expect(result.message).toContain('tenderId');
      expect(result.message).toContain('gyldig id');
    }
  });

  it('rejects an unparseable date in Norwegian', async () => {
    const result = await invokeTool(
      'search_tenders',
      { publishedAfter: 'i fjor en gang' },
      { caller: CALLER_A, ports: ports(), now: FIXED_NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('publishedAfter');
      expect(result.message).toContain('gyldig dato');
    }
  });

  it('rejects an unknown learning topic in Norwegian', async () => {
    const result = await invokeTool(
      'get_luma_learning_resource',
      { topic: 'prising' },
      { caller: CALLER_A, ports: ports(), now: FIXED_NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('bid_no_bid');
  });

  it('answers a nonexistent tool in Norwegian without pretending it ran', async () => {
    const injected = ports();
    const result = await invokeTool(
      'delete_everything',
      {},
      { caller: CALLER_A, ports: injected, now: FIXED_NOW },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_found');
      expect(result.message).toContain('finnes ikke');
    }
    expect(injected.auditEvents).toHaveLength(1);
  });
});

describe('audit', () => {
  it('records one row per call, whatever the outcome', async () => {
    const injected = ports();
    const context = { caller: CALLER_A, ports: injected, now: FIXED_NOW };

    await invokeTool('list_alert_profiles', {}, context);
    await invokeTool('get_tender', { tenderId: 'ugyldig' }, context);
    await invokeTool(
      'save_tender',
      { tenderId: '11111111-1111-4111-8111-111111111111' },
      { ...context, caller: callerFor(USER_A, ['tenders:read']) },
    );

    expect(injected.auditEvents.map((event) => event.outcome)).toEqual([
      'ok',
      'invalid_input',
      'forbidden',
    ]);
  });

  it('records the caller, the tool and the scope decision', async () => {
    const injected = ports();
    await invokeTool(
      'list_alert_profiles',
      {},
      { caller: CALLER_A, ports: injected, now: FIXED_NOW },
    );

    const event = injected.auditEvents[0];
    expect(event?.toolName).toBe('list_alert_profiles');
    expect(event?.userId).toBe(USER_A);
    expect(event?.tokenId).toBe(CALLER_A.tokenId);
    expect(event?.requiredScopes).toEqual(['profiles:read']);
    expect(event?.missingScope).toBeNull();
    expect(event?.resultCount).toBe(2);
    expect(event?.occurredAt).toEqual(FIXED_NOW);
  });

  it('names the missing scope on a refusal', async () => {
    const injected = ports();
    await invokeTool(
      'save_tender',
      { tenderId: '11111111-1111-4111-8111-111111111111' },
      { caller: callerFor(USER_A, ['tenders:read']), ports: injected, now: FIXED_NOW },
    );

    expect(injected.auditEvents[0]?.missingScope).toBe('saved:write');
  });

  it('stores no free text from the arguments, on success or on refusal', async () => {
    // Spec 9.5: conversation content is not stored. A search phrase, a buyer
    // name and a keyword are all conversation content.
    const injected = ports();
    const secrets = ['hemmelig strateginotat', 'Bærum kommune', 'ikke-en-id'];

    await invokeTool(
      'search_tenders',
      { query: secrets[0], buyer: secrets[1] },
      { caller: CALLER_A, ports: injected, now: FIXED_NOW },
    );
    await invokeTool(
      'get_tender',
      { tenderId: secrets[2] },
      { caller: CALLER_A, ports: injected, now: FIXED_NOW },
    );

    const written = JSON.stringify(injected.auditEvents);
    for (const secret of secrets) expect(written).not.toContain(secret);
    expect(injected.auditEvents).toHaveLength(2);
  });

  it('drops a target id that is not an id, so no tool can smuggle text through', async () => {
    // The audit row has no free-text field at all; this covers the two id
    // fields, which are the only place a string reaches the row.
    const probe = defineReadTool({
      name: 'probe_audit',
      title: 'Probe',
      description: 'Testverktøy som prøver å skrive fritekst til auditloggen.',
      requiredScopes: ['tenders:read'],
      lumaContent: false,
      inputSchema: z.object({}),
      auditFacts: () => ({ targetTenderId: 'hemmelig forretningshemmelighet fra samtalen' }),
      handler: async () => ({ ok: true }),
    });

    const injected = ports();
    await invokeToolFrom(
      [probe],
      'probe_audit',
      {},
      { caller: CALLER_A, ports: injected, now: FIXED_NOW },
    );

    expect(injected.auditEvents[0]?.targetTenderId).toBeNull();
  });
});
