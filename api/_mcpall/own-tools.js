// The two tools the unified server serves itself instead of mounting a
// source's copy (OWN_TOOL_NAMES in registry.js): the free getting_started
// overview, written over every mounted tool, and read_resource, which reads
// the three:// resources of every hosted server through one tool.

import { buildGettingStartedTool } from '../_lib/mcp-getting-started.js';
import { toolDefs as READ_RESOURCE_DEFS } from '../_mcp/tools/resources.js';
import { readResourceToolResult } from '../_mcp/resources.js';
import { UNIFIED_ENDPOINT, UNIFIED_RESOURCE_SERVER } from './registry.js';

/**
 * @param {() => { tools: object[] }} getRegistry the registry, read at call
 *   time so the overview always lists what the server really mounts
 */
export function makeOwnTools(getRegistry) {
	const baseOverview = buildGettingStartedTool({
		server: 'three.ws (every tool)',
		tagline: '',
		tools: [],
	});
	let overview = null;
	const overviewTool = () => {
		if (!overview) {
			const tools = getRegistry().tools.map((t) => t.def);
			overview = buildGettingStartedTool({
				server: 'three.ws (every tool)',
				tagline:
					'One MCP endpoint and one sign-in for every three.ws tool: 3D generation and rigging, agents and their wallets, ' +
					'x402 payments, trading, pump.fun data and more. Tools are grouped, and money-moving groups are off until you turn them on.',
				tools,
				access: [
					'Sign in with OAuth when your client asks, or send an API key as a Bearer token.',
					'Read and write tools of every group are on by default. Turn a group on with `npx three-ws tools`, the X-Three-Tools header, or https://three.ws/settings/mcp-tools.',
					'Money-moving tools stay off until their group is enabled, and each needs a preview first and an explicit confirm flag.',
				],
				links: { endpoint: UNIFIED_ENDPOINT, install: 'https://three.ws/mcp', catalog: 'https://three.ws/mcp-tools', docs: 'https://three.ws/docs/mcp' },
			});
		}
		return overview;
	};

	const readDef = READ_RESOURCE_DEFS.find((d) => d.name === 'read_resource');
	const { handler: _readHandler, ...readPublic } = readDef;

	return [
		{
			name: 'utility_getting_started',
			legacyName: 'getting_started',
			group: 'utility',
			tier: 'read',
			def: {
				name: 'utility_getting_started',
				title: baseOverview.title,
				description: baseOverview.description,
				inputSchema: baseOverview.inputSchema,
				annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
			},
			run: (args) => overviewTool().handler(args || {}),
		},
		{
			name: 'utility_read_resource',
			legacyName: 'read_resource',
			group: 'utility',
			tier: 'read',
			def: {
				...readPublic,
				name: 'utility_read_resource',
				description: readPublic.description.replace('three://x402/services.', 'three://x402/services and three://assets/<id>.'),
			},
			run: (args, auth, req) => readResourceToolResult(UNIFIED_RESOURCE_SERVER, args, auth, req),
		},
	];
}
