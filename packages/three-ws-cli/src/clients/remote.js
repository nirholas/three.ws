// Clients whose MCP configuration lives in a vendor's cloud, so there is no file
// for the CLI to write. For these, `setup` does everything around the missing
// file: it picks the server, optionally mints a connector key, prints the exact
// fields the client's connector form asks for, copies the URL, and proves the
// public URL answers a real tools/list from outside the client.

export const REMOTE_CLIENTS = [
	{
		id: 'grok-bot',
		label: 'Grok Bot',
		kind: 'remote',
		hint: 'xAI cloud connector: prints the fields to paste',
		// The one connector URL for Grok Bot and the xAI API (docs/grok.md): the
		// free studio with no account, plus the account's agent tools with a key.
		serverPath: '/api/mcp-grok',
		serverName: 'three-ws',
		docs: 'https://three.ws/docs/grok',
		/** The exact form fields, in the order Grok Bot's custom MCP connector asks for them. */
		fields: ({ url, keyed }) => [
			['Name', 'three-ws'],
			['Transport', 'Streamable HTTP'],
			['Server URL', url],
			['Authentication', keyed ? 'API key (store it as a Bot secret)' : 'None'],
		],
		/** The sentence that adds the server from Grok Bot's chat. */
		chatPrompt: ({ url }) => `Add a custom MCP server called three-ws at ${url}`,
	},
];

export function getRemoteClient(id) {
	return REMOTE_CLIENTS.find((x) => x.id === id) || null;
}

/** True when a hostname can only be reached from this machine, never from a vendor's cloud. */
export function isLocalHost(hostname) {
	const h = String(hostname).toLowerCase();
	if (h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]') return true;
	if (/^127\./.test(h) || /^10\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h)) return true;
	return /^172\.(1[6-9]|2\d|3[01])\./.test(h);
}
