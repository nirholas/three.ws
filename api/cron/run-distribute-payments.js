// GET /api/cron/run-distribute-payments
//
// Permissionless: builds + (optionally) submits `distributePayments` for every
// agent mint that has unrouted paymentVault balance. distribute is permissionless
// per the SDK, so any signer works — we use the cron relayer keypair if set,
// otherwise we just *prepare* and persist the unsigned tx for an external
// keeper to land.
//
// Authorized via Vercel Cron `Bearer $CRON_SECRET` (see env.CRON_SECRET).

import { sql } from '../_lib/db.js';
import { cors, json, method, wrap, error } from '../_lib/http.js';
import { env } from '../_lib/env.js';
import {
	getPumpAgent,
	getPumpAgentOffline,
	getConnection,
	buildUnsignedTxBase64,
	solanaPubkey,
} from '../_lib/pump.js';
import { SOLANA_USDC_MINT, SOLANA_USDC_MINT_DEVNET } from '../payments/_config.js';

const CRON_RELAYER_SECRET_KEY_B64 = () => process.env.PUMP_CRON_RELAYER_SECRET_KEY_B64 || null;

async function loadRelayer() {
	const b64 = CRON_RELAYER_SECRET_KEY_B64();
	if (!b64) return null;
	const [{ Keypair }] = await Promise.all([import('@solana/web3.js')]);
	return Keypair.fromSecretKey(Buffer.from(b64, 'base64'));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	// Auth: cron secret OR admin bearer.
	const auth = req.headers.authorization || '';
	const cronSecret = env.CRON_SECRET;
	if (!cronSecret) return error(res, 503, 'not_configured', 'CRON_SECRET unset');
	if (auth !== `Bearer ${cronSecret}`) {
		return error(res, 401, 'unauthorized', 'cron auth required');
	}

	// Pick mints to consider: those with confirmed payments since last
	// distribute run, or never run before.
	const mints = await sql`
		select m.id, m.mint, m.network, m.buyback_bps
		from pump_agent_mints m
		where exists (
			select 1 from pump_agent_payments p
			where p.mint_id = m.id and p.status = 'confirmed'
			  and (
				p.confirmed_at > coalesce(
					(select max(created_at) from pump_distribute_runs r where r.mint_id = m.id),
					'epoch'::timestamptz
				)
			  )
		)
		limit 200
	`;

	const relayer = await loadRelayer();
	const results = [];

	for (const m of mints) {
		const currencyStr = m.network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT;
		const currency = solanaPubkey(currencyStr);

		try {
			const { agent } = await getPumpAgent({ network: m.network, mint: m.mint });
			const balancesBefore = await agent.getBalances(currency);
			const paymentBalance = BigInt(balancesBefore.paymentVault.balance ?? 0);

			if (paymentBalance === 0n) {
				const [run] = await sql`
					insert into pump_distribute_runs (mint_id, currency_mint, status, balances_before)
					values (${m.id}, ${currencyStr}, 'skipped', ${JSON.stringify({ payment: paymentBalance.toString() })}::jsonb)
					returning id
				`;
				results.push({ mint: m.mint, status: 'skipped', run_id: run.id });
				continue;
			}

			const { offline } = await getPumpAgentOffline({ network: m.network, mint: m.mint });

			if (!relayer) {
				// No relayer: build unsigned tx for an external keeper. Persist run as 'pending'.
				const ixs = await offline.distributePayments({
					user: solanaPubkey(process.env.PUMP_DISTRIBUTE_FALLBACK_PAYER || m.mint),
					currencyMint: currency,
				});
				const txBase64 = await buildUnsignedTxBase64({
					network: m.network,
					payer: solanaPubkey(process.env.PUMP_DISTRIBUTE_FALLBACK_PAYER || m.mint),
					instructions: Array.isArray(ixs) ? ixs : [ixs],
				});
				const [run] = await sql`
					insert into pump_distribute_runs (mint_id, currency_mint, status, balances_before)
					values (${m.id}, ${currencyStr}, 'pending', ${JSON.stringify({ payment: paymentBalance.toString() })}::jsonb)
					returning id
				`;
				results.push({ mint: m.mint, status: 'pending', run_id: run.id, tx_base64: txBase64 });
				continue;
			}

			// Relayer path: sign + send.
			const ixs = await offline.distributePayments({
				user: relayer.publicKey,
				currencyMint: currency,
			});
			const connection = getConnection({ network: m.network });
			const [{ Transaction }] = await Promise.all([import('@solana/web3.js')]);
			const tx = new Transaction();
			tx.add(...(Array.isArray(ixs) ? ixs : [ixs]));
			const { blockhash } = await connection.getLatestBlockhash('confirmed');
			tx.recentBlockhash = blockhash;
			tx.feePayer = relayer.publicKey;
			tx.sign(relayer);
			const sig = await connection.sendRawTransaction(tx.serialize(), {
				skipPreflight: false,
			});
			await connection.confirmTransaction(sig, 'confirmed');

			const balancesAfter = await agent.getBalances(currency);
			const [run] = await sql`
				insert into pump_distribute_runs
					(mint_id, currency_mint, tx_signature, status, balances_before, balances_after)
				values
					(${m.id}, ${currencyStr}, ${sig}, 'confirmed',
					 ${JSON.stringify({ payment: paymentBalance.toString() })}::jsonb,
					 ${JSON.stringify({
						buyback: balancesAfter.buybackVault?.balance?.toString?.(),
						withdraw: balancesAfter.withdrawVault?.balance?.toString?.(),
					})}::jsonb)
				returning id
			`;
			results.push({ mint: m.mint, status: 'confirmed', tx_signature: sig, run_id: run.id });
		} catch (err) {
			await sql`
				insert into pump_distribute_runs (mint_id, currency_mint, status, error)
				values (${m.id}, ${currencyStr}, 'failed', ${err.message || String(err)})
			`;
			results.push({ mint: m.mint, status: 'failed', error: err.message });
		}
	}

	return json(res, 200, {
		ok: true,
		processed: results.length,
		relayer: relayer ? relayer.publicKey.toBase58() : null,
		results,
	});
});
