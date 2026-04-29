/**
 * Pump.fun signals crawler.
 *
 * Periodically pulls recent claim activity from the upstream pumpfun-claims-bot
 * MCP server, filters to claims/graduations whose creator or claimer wallet is
 * linked to a `user_wallets` row (chain_type='solana'), and writes typed signals
 * to `pumpfun_signals`. The `solana-reputation` endpoint reads these to weight
 * the Solana agent reputation score.
 *
 * Runs every 15 minutes via Vercel Cron (see vercel.json). Manually triggerable
 * with `Authorization: Bearer $CRON_SECRET`.
 *
 * Idempotent: tx_signature is unique; duplicate inserts are skipped.
 */

import { sql } from '../_lib/db.js';
import { cors, error, json, wrap } from '../_lib/http.js';
import { pumpfunMcp, pumpfunBotEnabled } from '../_lib/pumpfun-mcp.js';

const CLAIMS_PER_RUN = 200;
const GRADS_PER_RUN = 50;

const SIGNAL_WEIGHT = {
	first_claim: +0.2,
	graduation: +0.3,
	influencer: +0.2,
	fake_claim: -0.6,
	new_account: -0.2,
};

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;

	const auth = req.headers['authorization'] || '';
	const expected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
	const fromCron = req.headers['x-vercel-cron'] === '1';
	if (!fromCron && expected && auth !== expected) {
		return error(res, 401, 'unauthorized', 'cron secret required');
	}

	if (!pumpfunBotEnabled()) {
		return json(res, 200, { skipped: 'pumpfun bot not configured' });
	}

	const [claims, grads] = await Promise.all([
		pumpfunMcp.recentClaims({ limit: CLAIMS_PER_RUN }),
		pumpfunMcp.graduations({ limit: GRADS_PER_RUN }),
	]);

	const report = { claims: 0, graduations: 0, inserted: 0, skipped: 0, errors: [] };

	const claimItems = arr(claims.ok ? claims.data : null);
	const gradItems = arr(grads.ok ? grads.data : null);
	report.claims = claimItems.length;
	report.graduations = gradItems.length;

	const wallets = collectWallets(claimItems, gradItems);
	const linked = await linkedWalletMap(wallets);

	for (const ev of claimItems) {
		const wallet = ev.claimer || ev.github_wallet;
		if (!wallet || !linked.has(wallet)) {
			report.skipped++;
			continue;
		}
		try {
			const inserts = signalsFromClaim(ev);
			for (const sig of inserts) {
				const ok = await insertSignal({
					wallet,
					agent_asset: linked.get(wallet) || null,
					kind: sig.kind,
					weight: SIGNAL_WEIGHT[sig.kind] ?? 0,
					payload: sig.payload,
					tx_signature: sig.tx_signature,
				});
				if (ok) report.inserted++;
			}
		} catch (err) {
			report.errors.push({ tx: ev.tx_signature, error: err.message });
		}
	}

	for (const ev of gradItems) {
		const wallet = ev.creator || ev.dev_wallet;
		if (!wallet || !linked.has(wallet)) {
			report.skipped++;
			continue;
		}
		try {
			const ok = await insertSignal({
				wallet,
				agent_asset: linked.get(wallet) || null,
				kind: 'graduation',
				weight: SIGNAL_WEIGHT.graduation,
				payload: { mint: ev.mint, symbol: ev.symbol, name: ev.name },
				tx_signature: ev.tx_signature || ev.signature,
			});
			if (ok) report.inserted++;
		} catch (err) {
			report.errors.push({ tx: ev.tx_signature, error: err.message });
		}
	}

	return json(res, 200, report);
});

function arr(x) {
	if (!x) return [];
	return Array.isArray(x) ? x : x.items || [];
}

function collectWallets(claims, grads) {
	const out = new Set();
	for (const c of claims) {
		if (c.claimer) out.add(c.claimer);
		if (c.github_wallet) out.add(c.github_wallet);
	}
	for (const g of grads) {
		if (g.creator) out.add(g.creator);
		if (g.dev_wallet) out.add(g.dev_wallet);
	}
	return [...out];
}

async function linkedWalletMap(wallets) {
	const map = new Map();
	if (wallets.length === 0) return map;
	const rows = await sql`
		select uw.address, ai.meta->>'sol_mint_address' as agent_asset
		from user_wallets uw
		left join agent_identities ai
			on ai.user_id = uw.user_id
			and ai.deleted_at is null
			and ai.meta->>'chain_type' = 'solana'
		where uw.chain_type = 'solana'
		  and uw.address = any(${wallets})
	`;
	for (const r of rows) map.set(r.address, r.agent_asset);
	return map;
}

function signalsFromClaim(ev) {
	const out = [];
	const base = { tx_signature: ev.tx_signature, payload: ev };
	if (ev.first_time_claim) out.push({ kind: 'first_claim', ...base });
	if (ev.fake_claim) out.push({ kind: 'fake_claim', ...base });
	if (ev.tier === 'mega' || ev.tier === 'influencer') out.push({ kind: 'influencer', ...base });
	if (ev.github_account_age_days != null && ev.github_account_age_days < 30) {
		out.push({ kind: 'new_account', ...base });
	}
	return out;
}

async function insertSignal({ wallet, agent_asset, kind, weight, payload, tx_signature }) {
	if (!tx_signature) return false;
	const result = await sql`
		insert into pumpfun_signals (wallet, agent_asset, kind, weight, payload, tx_signature)
		values (${wallet}, ${agent_asset}, ${kind}, ${weight}, ${JSON.stringify(payload)}::jsonb, ${tx_signature})
		on conflict (tx_signature) do nothing
		returning id
	`;
	return result.length > 0;
}
