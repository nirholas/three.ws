// The 3D AR Studio MCP server (stdio).
//
//   npx 3d-ar-studio-mcp
//
// Gives an agent the studio's own capabilities: generate a 3D model, search the
// ready-made library, arrange several models into one scene, turn any model into
// a device-aware "View in your space" link, and emit a deployable AR page.
//
// Free and keyless. Nothing here reads a credential.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createRequire } from 'node:module';

import { createTools, readEnv } from './tools.js';

const { version } = createRequire(import.meta.url)('../package.json');

/**
 * Build the server with every tool registered. Exported so a host can mount it
 * on a transport of its own choosing.
 *
 * @param {object} [opts]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @returns {McpServer}
 */
export function createServer({ env } = {}) {
	const server = new McpServer(
		{ name: '3d-ar-studio', version },
		{
			capabilities: { tools: {} },
			instructions:
				'Put 3D things in a person\'s real room. Search the ready-made library first (search_models) and '
				+ 'generate only what you cannot find (generate_3d_model). For more than one object, arrange them '
				+ 'with compose_ar_scene and give the person the single link it returns: that link reopens the whole '
				+ 'arrangement in their room. Always hand back a link rather than only a .glb file: a bare model file '
				+ 'is not something a person can look at. AR links are meant to be opened on a phone.',
		},
	);

	for (const tool of createTools({ env: env ? readEnv(env) : undefined })) {
		server.registerTool(
			tool.name,
			{
				title: tool.title,
				description: tool.description,
				inputSchema: tool.schema,
				annotations: tool.annotations,
			},
			async (args) => {
				try {
					return await tool.run(args ?? {});
				} catch (err) {
					const message = err?.message || 'That did not work.';
					return {
						content: [{ type: 'text', text: message }],
						structuredContent: { error: true, message },
						isError: true,
					};
				}
			},
		);
	}
	return server;
}

/** Run the server over stdio. This is what the `3d-ar-studio-mcp` binary calls. */
export async function main() {
	const server = createServer();
	await server.connect(new StdioServerTransport());
}

export { createTools, readEnv, renderPage, sceneUrl } from './tools.js';
