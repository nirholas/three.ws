import Ajv from 'ajv';
import addFormats from 'ajv-formats';

import { buildGettingStartedTool } from '../_lib/mcp-getting-started.js';
import { toolDefs, ORACLE_GETTING_STARTED, ORACLE_LINKS } from './tools.js';

// Hard cap from the work order: the server stays small enough that a client can
// hold the whole list in context.
export const MAX_TOOLS = 14;

// Free static overview, listed first. Annotations: built at module load, so it
// is read-only, deterministic and closed-world.
const gettingStarted = {
	...buildGettingStartedTool({
		server: 'three.ws Oracle',
		tagline: 'The Oracle conviction signal on pump.fun launches: scores, proof of results, and an agent you can arm to act on it.',
		tools: toolDefs,
		access: [
			'Every read tool is free and needs no account. Initialize and tools/list answer without credentials.',
			'oracle_arm_watch and oracle_watch_status need a three.ws account (OAuth). Arming defaults to simulate mode.',
			'Live mainnet arming is refused with risk_ack_required and a signing link until the account signs the Terms, Risk Disclosure and Agent Wallet Agreement.',
		],
		links: ORACLE_LINKS,
	}),
	name: ORACLE_GETTING_STARTED,
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
};

const allDefs = [gettingStarted, ...toolDefs];
if (allDefs.length > MAX_TOOLS) throw new Error(`Oracle MCP lists ${allDefs.length} tools, over the cap of ${MAX_TOOLS}`);

// tools/list entries: strip internal fields (scope, handler).
export const TOOL_CATALOG = allDefs.map(({ scope: _s, handler: _h, ...schema }) => schema);

const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: true, strict: false });
addFormats(ajv);

export const TOOLS = Object.fromEntries(
	allDefs.map(({ name, scope, handler, inputSchema }) => [
		name,
		{ scope, handler, validate: inputSchema ? ajv.compile(inputSchema) : null },
	]),
);

/** A tool is public when it needs no scope: the free reads and the overview. */
export function isPublicTool(name) {
	return Boolean(name && TOOLS[name] && !TOOLS[name].scope);
}
