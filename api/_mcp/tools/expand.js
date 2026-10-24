// expand: page through, or narrow, a result another tool summarized.
//
// list_my_agents, recall and crypto_data answer a long list with a summary, a
// count, a handle and the first page (api/_lib/mcp-expand.js). This tool takes
// that handle back and returns any other page, optionally trimmed to the fields
// the caller needs. A handle is signed, expires, and only works for the account
// that received it.

import { MAX_PAGE, expandHandle } from '../../_lib/mcp-expand.js';

export const toolDefs = [
	{
		name: 'expand',
		title: 'Expand a summarized result',
		annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
		description:
			'Get more of a result that another tool summarized. Use this when list_my_agents, recall or crypto_data returns a summary with a handle and a count: pass that handle here with an offset to read the next page, or with fields to receive only those keys of each row (dot paths allowed, for example ["id","name"]). Handles are signed, last 15 minutes and only work for the account that received them; when one has expired, call the original tool again. Reads only.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['handle'],
			properties: {
				handle: { type: 'string', minLength: 8, maxLength: 600, description: 'The handle from a summarized tool result.' },
				offset: { type: 'integer', minimum: 0, default: 0, description: 'Row to start at. Use next_offset from the previous page.' },
				limit: { type: 'integer', minimum: 1, maximum: MAX_PAGE, description: 'Rows to return. Defaults to the page size of the original result.' },
				fields: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 }, description: 'Keys to keep on each row.' },
			},
		},
		async handler(args = {}, auth) {
			return expandHandle({ handle: args.handle, offset: args.offset, limit: args.limit, fields: args.fields, auth });
		},
	},
];
