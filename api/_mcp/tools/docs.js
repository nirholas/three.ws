// search_docs: answer "how do I" from the documentation source of truth.
//
// Backed by the same index the docs site and the Cmd-K palette search
// (api/_lib/docs-search.js), so an agent and a person get the same sections.
// Free and keyless: it reads published documentation and nothing about the
// caller, which is why it is on the public-tool allowlist and on the keyless
// studio server.

import { searchDocs } from '../../_lib/docs-search.js';
import { resolveOrigin } from '../origin.js';

function origin(req) {
	try {
		return resolveOrigin(req);
	} catch {
		return 'https://three.ws';
	}
}

export const toolDefs = [
	{
		name: 'search_docs',
		title: 'Search the three.ws documentation',
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		description:
			'FREE, no account or payment. Search the three.ws documentation for the section that answers a question, such as "how do I embed an avatar on my site" or "how does auto-rigging work". Returns the best sections ranked, each with the page and heading title, a url that opens the docs reader at that heading, and a snippet from the start of the section. Use this before guessing at an API or a flow; to browse ready-made 3D assets call search_catalog instead.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['query'],
			properties: {
				query: { type: 'string', minLength: 2, maxLength: 300, description: 'A question or keywords, in plain words.' },
				limit: { type: 'integer', minimum: 1, maximum: 10, default: 5, description: 'How many sections to return.' },
			},
		},
		async handler(args = {}, _auth, req) {
			const results = await searchDocs(args.query, { limit: args.limit || 5, origin: origin(req) });
			if (!results.length) {
				return {
					content: [{ type: 'text', text: `No documentation section matched "${args.query}". Try fewer or different keywords, or call getting_started for an overview of what this server offers.` }],
					structuredContent: { query: args.query, count: 0, results: [] },
				};
			}
			const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
			return {
				content: [{ type: 'text', text }],
				structuredContent: { query: args.query, count: results.length, results },
			};
		},
	},
];
