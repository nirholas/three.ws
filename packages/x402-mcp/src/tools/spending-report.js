// `spending_report`: read-only totals from this wallet's local ledger
// (../lib/ledger.js), so a human can ask what the agent spent without reading
// raw JSONL. Every settled pay_and_call or named-tool call appends one entry;
// this just reads them back and sums by merchant and by day.

import { z } from 'zod';

import { summarize, LEDGER_PATH } from '../lib/ledger.js';

export const def = {
	name: 'spending_report',
	title: "This wallet's x402 spending report (totals by merchant and day)",
	annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
	description:
		'Report what this wallet has spent through pay_and_call and the named service tools, from the local ledger. Returns a grand total, totals per merchant (the endpoint\'s hostname), and totals per UTC day. Read-only, local file only: never touches the network or a key. Optionally filter by `since` (ISO-8601 timestamp) or `merchant`. Use this when you need to know how much this wallet has paid, and to whom, before approving another paid call.',
	inputSchema: {
		since: z.string().datetime({ offset: true }).optional().describe('Only include payments at or after this ISO-8601 timestamp.'),
		merchant: z.string().optional().describe('Only include payments to this merchant hostname (e.g. "three.ws").'),
	},
	async handler(args) {
		const report = await summarize({ since: args?.since, merchant: args?.merchant });
		return { ok: true, ledger_path: LEDGER_PATH, ...report };
	},
};
