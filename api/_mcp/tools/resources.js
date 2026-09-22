// read_resource on /api/mcp: every three:// resource this server publishes
// (api/_mcp/resources.js), for clients that render tools but not resources.

import { readResourceToolResult } from '../resources.js';

export const toolDefs = [
	{
		name: 'read_resource',
		title: 'Read a three:// resource',
		annotations: {
			readOnlyHint: true,
			destructiveHint: false,
			idempotentHint: false,
			openWorldHint: false,
		},
		description:
			'Read a live three.ws resource by URI: three://me (account, scopes, quota), three://agents and three://agents/<id> (your agents), three://agents/<id>/wallet (balances, limits, freeze state), .../usage, .../chat, .../runs, .../orders, .../dca, .../intents, three://wallets, three://launches, three://marketplace, three://models and three://x402/services. Omit uri to list every resource you can read. Set format to markdown for a readable rendering.',
		inputSchema: {
			type: 'object',
			properties: {
				uri: {
					type: 'string',
					maxLength: 300,
					description:
						'A three:// resource URI, for example three://me or three://agents/<agentId>/wallet. Omit to list every resource you can read here.',
				},
				format: { type: 'string', enum: ['json', 'markdown'], default: 'json' },
			},
			additionalProperties: false,
		},
		async handler(args, auth, req) {
			return readResourceToolResult('mcp', args, auth, req);
		},
	},
];
