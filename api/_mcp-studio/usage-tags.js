// Attribution for the studio surfaces' usage_events rows.
//
// usageClientLabel turns the caller the studio's limits charge (./handler.js
// studioCaller: an account, an install token, an MCP session or an IP) into the
// row's client_id: `<server>:<kind>:<16 hex>`, a salted hash, so a row can be
// grouped by client without storing an account id, token or IP in it.
//
// madeModelUrl reads the finished model a tool call returned, so a model is
// counted once it exists (a pending job counts when its job tool collects it,
// and counting distinct URLs absorbs repeated collections of the same job).
// /api/grok/stats (api/_lib/grok-stats.js) aggregates both.

import { createHash } from 'node:crypto';

const LABEL_SALT = 'studio-usage:v1';

// Tools whose successful result is a model the caller made. look_at_model
// renders views of an existing model and create_agent_persona saves one as a
// persona: neither makes a new model.
export const MODEL_TOOL_NAMES = new Set(['forge_free', 'mesh_forge', 'text_to_avatar', 'forge_avatar', 'rig_mesh', 'refine_model']);

// Tools that collect a pending job's finished model.
const JOB_TOOL_NAMES = new Set(['check_job', 'get_job']);

/**
 * @param {string} server the surface's endpoint name (mcp-grok, mcp-studio, ...)
 * @param {{ key: string, kind: string } | null} caller
 * @returns {string|null}
 */
export function usageClientLabel(server, caller) {
	if (!server || !caller?.key) return null;
	const kind = caller.kind || 'ip';
	const hash = createHash('sha256').update(`${LABEL_SALT}:${server}:${caller.key}`).digest('hex').slice(0, 16);
	return `${server}:${kind}:${hash}`;
}

/**
 * The GLB URL of the model a tool call finished, or null.
 * @param {string} name tool name
 * @param {object|null} result the tool's MCP result
 * @param {string} jobTool the surface's job-collection tool
 * @returns {string|null}
 */
export function madeModelUrl(name, result, jobTool) {
	if (!MODEL_TOOL_NAMES.has(name) && !JOB_TOOL_NAMES.has(name) && name !== jobTool) return null;
	if (!result || result.isError) return null;
	const sc = result.structuredContent;
	if (!sc || sc.format !== 'glb' || typeof sc.glbUrl !== 'string' || !/^https:\/\//.test(sc.glbUrl)) return null;
	return sc.glbUrl;
}
