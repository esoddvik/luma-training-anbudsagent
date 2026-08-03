import { parseCoreEnv, parseMcpEnv, parseWebEnv, type CoreEnv, type McpEnv, type WebEnv } from './env.js';
import { loadDotEnv } from './load-env.js';

/**
 * Lazily validated, per-service views of `process.env`.
 *
 * Validation happens on first access rather than at import time so that
 * importing a package for its types never crashes a process that does not need
 * that service's variables.
 */

let core: CoreEnv | undefined;
let web: WebEnv | undefined;
let mcp: McpEnv | undefined;

export function getCoreEnv(): CoreEnv {
  if (!core) {
    loadDotEnv();
    core = parseCoreEnv(process.env);
  }
  return core;
}

export function getWebEnv(): WebEnv {
  if (!web) {
    loadDotEnv();
    web = parseWebEnv(process.env);
  }
  return web;
}

export function getMcpEnv(): McpEnv {
  if (!mcp) {
    loadDotEnv();
    mcp = parseMcpEnv(process.env);
  }
  return mcp;
}

/** Clears the memoised views. Tests that mutate `process.env` need this. */
export function resetEnvCacheForTests(): void {
  core = undefined;
  web = undefined;
  mcp = undefined;
}
