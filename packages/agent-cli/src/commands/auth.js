// `login`, `logout` and `whoami`. Sign-in is the device link the three-ws CLI
// uses: the terminal shows a code, the person approves it in the browser, and
// the granted key lands in the `agent_key` slot of the shared credential file.

import { clearAgentKey, DEFAULT_SCOPES, mask, pollDeviceLink, resolveCredential, saveAgentKey, startDeviceLink } from '../credentials.js';
import { loadConfig } from '../config.js';
import { createPlatform } from '../platform.js';
import { credentialsPath } from '../paths.js';

/**
 * @param {object} o
 * @param {object} o.env
 * @param {string[]} [o.extraScopes]  e.g. wallet:write, opted into with --scope
 * @param {(link: object) => void} o.onCode  show the code and URL to the person
 */
export async function login({ env, extraScopes = [], onCode, signal, sleep }) {
	const config = loadConfig(env);
	const scope = [...new Set([...DEFAULT_SCOPES, ...extraScopes])].join(' ');
	const link = await startDeviceLink({ origin: config.origin, scope });
	onCode?.(link);
	const granted = await pollDeviceLink({ origin: config.origin, link, signal, sleep });
	saveAgentKey(granted, env);
	const credential = resolveCredential(env);
	return { origin: config.origin, email: granted.account?.email || credential?.email || null, scope: granted.scope || scope, key: mask(granted.access_token), file: credentialsPath(env) };
}

export function printLoginCode(link) {
	return `To sign this machine in, open\n  ${link.verification_uri_complete || link.verification_uri}\nand confirm the code ${link.user_code}. Waiting for approval...`;
}

export function printLogin(r) {
	return `Signed in${r.email ? ` as ${r.email}` : ''} on ${r.origin}. Key ${r.key} saved to ${r.file} with scopes: ${r.scope}`;
}

export function logout({ env }) {
	const before = resolveCredential(env);
	clearAgentKey(env);
	const after = resolveCredential(env);
	return { removed: before?.source === 'agent key', stillSignedInVia: after?.source || null };
}

export function printLogout(r) {
	const head = r.removed ? 'Removed the agent key from this machine.' : 'There was no agent key on this machine.';
	const tail = r.stillSignedInVia
		? ` The agent still has a credential from ${r.stillSignedInVia}; remove it with \`three-ws logout\` or unset THREE_WS_API_KEY to sign out completely.`
		: '';
	return head + tail;
}

export async function whoami({ env }) {
	const config = loadConfig(env);
	const credential = resolveCredential(env);
	if (!credential) return { signedIn: false, origin: config.origin };
	const platform = createPlatform({ origin: config.origin, credential });
	const me = await platform.me();
	return {
		signedIn: true,
		origin: config.origin,
		source: credential.source,
		key: mask(credential.token),
		email: credential.email,
		userId: me?.userId || null,
		scopes: me?.auth?.scopes || [],
		freeTier: me?.freeTier || null,
		agentId: config.agentId,
	};
}

export function printWhoami(r) {
	if (!r.signedIn) return `Not signed in to ${r.origin}. Run \`three-ws-agent login\`, or set THREE_WS_API_KEY.`;
	return [
		`Signed in to ${r.origin}${r.email ? ` as ${r.email}` : ''}`,
		`  user      ${r.userId}`,
		`  key       ${r.key} (${r.source})`,
		`  scopes    ${r.scopes.join(' ') || '(none)'}`,
		`  agent     ${r.agentId || 'none selected (pick one with /agent)'}`,
	].join('\n');
}
