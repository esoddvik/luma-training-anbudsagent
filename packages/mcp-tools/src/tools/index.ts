import {
  invokeToolFrom,
  type InvocationContext,
  type LumaTool,
  type ToolInvocation,
} from '../registry.js';
import { searchTendersTool } from './search-tenders.js';
import { findMatchingTendersTool } from './find-matching-tenders.js';
import { getTenderTool } from './get-tender.js';
import { explainTenderMatchTool } from './explain-tender-match.js';
import { getAlertProfileTool, listAlertProfilesTool } from './alert-profiles.js';
import { dismissTenderTool, saveTenderTool } from './saved-tenders.js';
import { getLumaLearningResourceTool } from './learning-resource.js';

/**
 * The MVP tool surface (spec section 32.1), in the order the spec lists it.
 *
 * `apps/mcp` registers the surface by iterating this array. It never names an
 * individual tool, so a phase 7 addition (spec section 32.2) lands here and
 * nowhere else.
 */
export const LUMA_TOOLS: readonly LumaTool[] = Object.freeze([
  searchTendersTool,
  findMatchingTendersTool,
  getTenderTool,
  explainTenderMatchTool,
  listAlertProfilesTool,
  getAlertProfileTool,
  saveTenderTool,
  dismissTenderTool,
  getLumaLearningResourceTool,
]);

export function findTool(name: string): LumaTool | undefined {
  return LUMA_TOOLS.find((tool) => tool.name === name);
}

/** Runs one tool: scope check, input validation, execution and audit. */
export function invokeTool(
  toolName: string,
  rawInput: unknown,
  context: InvocationContext,
): Promise<ToolInvocation> {
  return invokeToolFrom(LUMA_TOOLS, toolName, rawInput, context);
}

export * from './search-tenders.js';
export * from './find-matching-tenders.js';
export * from './get-tender.js';
export * from './explain-tender-match.js';
export * from './alert-profiles.js';
export * from './saved-tenders.js';
export * from './learning-resource.js';
export {
  hasScope,
  NO_PROFILES_NB,
  PROFILE_NOT_FOUND_NB,
  PROFILE_SCOPE_MISSING_NB,
  SAVED_SCOPE_MISSING_NB,
  TENDER_NOT_FOUND_NB,
} from './shared.js';
