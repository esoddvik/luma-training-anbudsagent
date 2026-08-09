/**
 * The shared vocabulary of Luma Anbudsvarsling.
 *
 * Every other package imports its types and validation schemas from here, so
 * that the API, the workers, the web app and the MCP server cannot drift apart
 * on what a tender, a match or a consent event is.
 *
 * This package has exactly one runtime dependency (Zod) and imports nothing
 * from the rest of the workspace. That is deliberate: it is the bottom of the
 * dependency graph, and keeping it there is what lets the matching package
 * stay provably free of any commercial input (ADR-6).
 */

export * from './tender.js';
export * from './text.js';
export * from './cpv.js';
export * from './regions.js';
export * from './alert-profile.js';
export * from './matching.js';
export * from './consent.js';
export * from './sharing.js';
export * from './editorial.js';
export * from './billing.js';
export * from './entitlements.js';
export * from './attribution.js';
