// three.ws 3D Studio (free): the asset catalog tools.
//
// search_catalog, get_catalog_item and get_item_source are free public reads of
// the published CC0 props, rigged characters and motion clips. The main server
// at /api/mcp also lists them, but an MCP client that connects there is sent
// through OAuth sign-in on initialize, because most of that server's tools act on
// an account. This keyless server is where a client with no account reaches the
// catalog, so "check the catalog before you generate" holds on the server the
// generation tools live on.
//
// The definitions are the main server's own (api/_mcp/tools/library.js): one
// implementation, two transports, identical answers. Each tool is named here
// explicitly because scripts/build-openai-skills-bundle.mjs reads the tool names
// this directory declares to decide which skills the studio can serve.

import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { toolDefs as libraryTools } from '../_mcp/tools/library.js';

// The studio's contract carries no payment vocabulary at all (tests/mcp-studio.test.js
// holds every studio tool to that), so the main server's "no account or payment"
// lead-in is restated as what it means here.
const MAIN_SERVER_LEAD = /^FREE, no account or payment\. /;

function libraryTool(name) {
	const def = libraryTools.find((d) => d.name === name);
	if (!def) throw new Error(`api/_mcp/tools/library.js no longer defines ${name}`);
	return { ...def, description: def.description.replace(MAIN_SERVER_LEAD, 'Free, no account needed. ') };
}

const DEFS = [
	{
		...libraryTool('search_catalog'),
		name: 'search_catalog',
	},
	{
		...libraryTool('get_catalog_item'),
		name: 'get_catalog_item',
	},
	{
		...libraryTool('get_item_source'),
		name: 'get_item_source',
	},
];

export const CATALOG_TOOL_CATALOG = DEFS.map(({ handler: _h, ...schema }) => schema);

const ajv = new Ajv({ allErrors: true, useDefaults: true, coerceTypes: true, strict: false });
addFormats(ajv);

export const CATALOG_TOOLS = Object.fromEntries(
	DEFS.map(({ name, handler, inputSchema }) => [name, { handler, validate: ajv.compile(inputSchema) }]),
);
