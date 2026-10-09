// The signed-in half of /api/mcp-grok: the account's agent tools, composed
// from the core server (/api/mcp) at the dispatch layer.
//
// Grok Bot holds its credential unattended (an OAuth 2.1 grant or a connector
// API key stored as a Bot secret), so this surface lists only tools that read
// or edit agent data: agents, their memory, their custom skills, and the
// account's avatars. Nothing here moves value. A tool is admitted only when it
// is on GROK_ACCOUNT_TOOLS AND the shared policy keeps it out of the
// financial tier AND its scope is not a wallet, payment or trade scope AND the core server's own tools/list advertises no
// price for it, so a later change to the policy or the prices can only shrink
// this list, never widen it.
//
// tools/call runs only a tool this caller's tools/list would show, through the
// core dispatcher unchanged: the same tool policy (enablement, the spend gate),
// scope check, usage accounting and error sanitizing as /api/mcp. Any other
// core tool name is unknown here, whatever scopes the credential holds, so an
// OAuth grant that includes `wallet:write` still cannot reach a wallet tool
// through this URL.
//
// The core catalog is imported lazily: an anonymous studio request never pays
// for loading every core tool module.

import { POLICY } from '@three-ws/mcp-policy';
import { hasScope } from '../_lib/auth.js';

// The core server's @three-ws/mcp-policy id.
const CORE_SERVER = 'three.ws';

export const GROK_ACCOUNT_TOOLS = Object.freeze([
	// Agents
	'create_agent',
	'attach_avatar_to_agent',
	'identity_check',
	'call_agent',
	// Agent memory
	'remember',
	'recall',
	// Agent skills (prompt-only instruction files)
	'list_available_skills',
	'list_custom_skills',
	'get_custom_skill',
	'create_custom_skill',
	'update_custom_skill',
	'import_community_skill',
	// The account's avatars
	'list_my_avatars',
	'get_avatar',
	'get_embed_code',
	'render_avatar_image',
]);

// Scopes that authorize moving value. A tool that needs one of these is a wallet,
// payment, trade or launch tool whatever its policy tier says.
const VALUE_SCOPE = /^(wallet|payments?|trade|trading|spend|launch)[:.]/;

/** Does the shared policy or the tool's own scope make this core tool value-moving? */
export function movesValue(name, tools = null) {
	if (POLICY[CORE_SERVER]?.[name]?.tier === 'financial') return true;
	const scope = tools?.[name]?.scope;
	return typeof scope === 'string' && VALUE_SCOPE.test(scope);
}

const ADMITTED = new Set(GROK_ACCOUNT_TOOLS.filter((name) => !movesValue(name)));

/** Is `name` an account tool this surface serves? */
export function isAccountTool(name) {
	return typeof name === 'string' && ADMITTED.has(name);
}

let corePromise = null;
function loadCore() {
	corePromise ??= Promise.all([import('../_mcp/catalog.js'), import('../_mcp/dispatch.js')]).then(([catalog, dispatch]) => ({
		tools: catalog.TOOLS,
		dispatch: dispatch.dispatch,
	}));
	return corePromise;
}

/**
 * The account tools a signed-in caller sees on tools/list: admitted, granted by
 * the credential's scope (a tool it could only be refused is left out), enabled
 * by the account's MCP tool settings, and unpriced. The last two come from the
 * core server's own tools/list for this caller, so this surface can never show
 * a tool /api/mcp would hide from the same credential.
 */
export async function accountToolCatalog(auth, req) {
	if (!auth?.userId) return [];
	const { tools, dispatch } = await loadCore();
	const listed = await dispatch({ jsonrpc: '2.0', id: 'grok-account-tools', method: 'tools/list' }, auth, req);
	return (listed?.result?.tools || []).filter((t) => {
		if (!ADMITTED.has(t.name) || t.pricing || movesValue(t.name, tools)) return false;
		const scope = tools[t.name]?.scope;
		return !scope || hasScope(auth.scope, scope);
	});
}

/**
 * Run one tools/call for an account tool through the core dispatcher, but only
 * when this caller's tools/list shows it. Returns the JSON-RPC response exactly
 * as /api/mcp would, or null when the tool is not listed for this caller.
 */
export async function callAccountTool(msg, auth, req) {
	const listed = await accountToolCatalog(auth, req);
	if (!listed.some((t) => t.name === msg.params?.name)) return null;
	const { dispatch } = await loadCore();
	return dispatch(msg, auth, req);
}
