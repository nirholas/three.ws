import { toolDefs as avatarDefs } from './tools/avatars.js';
import { toolDefs as modelDefs } from './tools/models.js';
import { toolDefs as solanaDefs } from './tools/solana.js';
import { toolDefs as pumpfunDefs } from './tools/pumpfun.js';

const allDefs = [...avatarDefs, ...modelDefs, ...solanaDefs, ...pumpfunDefs];

// Schema objects for tools/list — strip internal fields (scope, handler).
export const TOOL_CATALOG = allDefs.map(({ scope: _s, handler: _h, ...schema }) => schema);

// Handler lookup for tools/call — keyed by tool name.
export const TOOLS = Object.fromEntries(
	allDefs.map(({ name, scope, handler }) => [name, { scope, handler }]),
);
