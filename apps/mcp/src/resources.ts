/**
 * MCP resources (spec §33).
 *
 * The content itself lives in `@luma/mcp-tools`, because
 * `get_luma_learning_resource` (spec §32.1) serves the same Norwegian text and
 * a package must not import from an app. This module re-exports it so the
 * transport layer keeps its import path and there is exactly one copy of the
 * text in the repository.
 */
export { LUMA_RESOURCES, findResource, type LumaResource } from '@luma/mcp-tools';
