// token_due_diligence: holder-quality read for a Solana token mint. Insider hold
// rate, sniper share, bundler exposure, fresh-wallet ratio and smart-money
// holders as shares of supply, plus a two-hop funding graph, from the same
// engine as GET /api/crypto/due-diligence (api/_lib/token-due-diligence.js).
// Cached per mint for five minutes. Read-only; never signs or spends.

import { getTokenDueDiligence } from '../../_lib/token-due-diligence.js';
import { isValidSolanaAddress } from '../../_lib/validate.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

function fail(message, data) {
	return { content: [{ type: 'text', text: message }], isError: true, structuredContent: data };
}

export const toolDefs = [
	{
		name: 'token_due_diligence',
		title: 'Token due diligence',
		annotations: READ,
		description:
			'Who holds a Solana token, not just what its contract can do. Returns insider hold rate (creator-linked wallets), ' +
			'sniper share (bought within a few slots of launch), bundler exposure (holders funded by a common source), ' +
			'fresh-wallet ratio (wallets under 24h old when they bought) and smart-money holders (wallets whose realized ' +
			'history in three.ws tracked data clears the bar), each as a percent of total supply, plus the holder rows and a ' +
			'two-hop funding graph. A field is null when its chain reads failed; `coverage` and `notes` say why. Cached per ' +
			'mint for 5 minutes. Definitions and thresholds: docs/token-due-diligence.md. Example mint: the $THREE CA ' +
			'"FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump". Use this when you are about to size or approve a buy and need to know whether insiders, snipers or bundles control the supply. Pair with the agent trade limits (max_insider_pct and kin) to refuse a buy automatically.',
		inputSchema: {
			type: 'object',
			required: ['mint'],
			properties: {
				mint: { type: 'string', description: 'Base58 Solana token mint address.' },
			},
			additionalProperties: false,
		},
		async handler(args) {
			const mint = String(args?.mint || '').trim();
			if (!isValidSolanaAddress(mint)) {
				return fail('mint must be a base58 Solana token mint address', { error: 'invalid_address', mint });
			}
			const report = await getTokenDueDiligence(mint);
			if (report.status === 'not_found') {
				return fail(`${mint} is not an on-chain token mint`, { error: 'token_not_found', mint });
			}
			if (report.status !== 'ok') {
				return fail('chain data sources are temporarily unreachable, retry shortly', { error: 'upstream_unavailable', mint, retry_after: 15 });
			}
			return { content: [{ type: 'text', text: JSON.stringify(report, null, 2) }], structuredContent: report };
		},
	},
];
