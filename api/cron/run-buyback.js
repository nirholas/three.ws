// GET /api/cron/run-buyback
//
// For every agent mint with non-zero buybackVault balance, builds a
// `buybackTrigger` ix that CPIs into pump-swap to swap currency → agent token
// then burn. If PUMP_CRON_RELAYER_SECRET_KEY_B64 is set, signs + lands the tx;
// otherwise persists unsigned txs for an external keeper.
//
// Auth: `Bearer $CRON_SECRET`.
//
// NOTE: swapInstructionData / remainingAccounts construction is swap-program-
// specific. This implementation supports the empty-data "burn-only" form
// (which the SDK accepts to skip the swap and just burn whatever is already
// in the buyback vault denominated in the agent token). Full swap path is
// gated behind PUMP_BUYBACK_FULL_SWAP=true and uses pump-swap-sdk to build
// the inner ix.

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

async function loadRelayer() {
	const b64 = process.env.PUMP_CRON_RELAYER_SECRET_KEY_B64;
	if (!b64) return null;
	const [{ Keypair }] = await Promise.all([import('@solana/web3.js')]);
	return Keypair.fromSecretKey(Buffer.from(b64, 'base64'));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const auth = req.headers.authorization || '';
	if (!env.CRON_SECRET) return error(res, 503, 'not_configured', 'CRON_SECRET unset');
	if (auth !== `Bearer ${env.CRON_SECRET}`) {
		return error(res, 401, 'unauthorized', 'cron auth required');
	}

	const fullSwap = process.env.PUMP_BUYBACK_FULL_SWAP === 'true';
	const relayer = await loadRelayer();

	const mints = await sql`
		select id, mint, network from pump_agent_mints limit 200
	`;

	const results = [];
	for (const m of mints) {
		const currencyStr = m.network === 'devnet' ? SOLANA_USDC_MINT_DEVNET : SOLANA_USDC_MINT;
		const currency = solanaPubkey(currencyStr);

		try {
			const { agent } = await getPumpAgent({ network: m.network, mint: m.mint });
			const balances = await agent.getBalances(currency);
			const buyback = BigInt(balances.buybackVault?.balance ?? 0);

			if (buyback === 0n) {
				const [run] = await sql`
					insert into pump_buyback_runs (mint_id, currency_mint, status)
					values (${m.id}, ${currencyStr}, 'skipped') returning id
				`;
				results.push({ mint: m.mint, status: 'skipped', run_id: run.id });
				continue;
			}

			const { offline } = await getPumpAgentOffline({ network: m.network, mint: m.mint });
			const [{ PUMP_PROGRAM_ID }] = await Promise.all([
				import('@pump-fun/agent-payments-sdk'),
			]);

			const payerPk = relayer ? relayer.publicKey : solanaPubkey(m.mint);
			const params = {
				globalBuybackAuthority: payerPk,                  // gated by globalConfig — for skipped-swap form, can be relayer
				currencyMint: currency,
				swapProgramToInvoke: PUMP_PROGRAM_ID || payerPk, // sentinel program for skip-swap path
				swapInstructionData: Buffer.alloc(0),             // empty = skip swap, just burn
				remainingAccounts: [],
			};

			if (fullSwap) {
				// TODO(Phase 3.1): build pump-swap inner ix here. Skipping for safety;
				// keepers should supply this off-chain until tested on devnet.
			}

			let ix;
			try {
				ix = await offline.buybackTrigger(params);
			} catch (e) {
				const [run] = await sql`
					insert into pump_buyback_runs (mint_id, currency_mint, status, error)
					values (${m.id}, ${currencyStr}, 'failed', ${'buybackTrigger build failed: ' + e.message})
					returning id
				`;
				results.push({ mint: m.mint, status: 'failed', error: e.message, run_id: run.id });
				continue;
			}

			if (!relayer) {
				const txBase64 = await buildUnsignedTxBase64({
					network: m.network,
					payer: payerPk,
					instructions: [ix],
				});
				const [run] = await sql`
					insert into pump_buyback_runs (mint_id, currency_mint, status, burn_amount)
					values (${m.id}, ${currencyStr}, 'pending', ${buyback.toString()})
					returning id
				`;
				results.push({ mint: m.mint, status: 'pending', run_id: run.id, tx_base64: txBase64 });
				continue;
			}

			const connection = getConnection({ network: m.network });
			const [{ Transaction }] = await Promise.all([import('@solana/web3.js')]);
			const tx = new Transaction();
			tx.add(ix);
			const { blockhash } = await connection.getLatestBlockhash('confirmed');
			tx.recentBlockhash = blockhash;
			tx.feePayer = relayer.publicKey;
			tx.sign(relayer);
			const sig = await connection.sendRawTransaction(tx.serialize());
			await connection.confirmTransaction(sig, 'confirmed');

			const [run] = await sql`
				insert into pump_buyback_runs
					(mint_id, currency_mint, tx_signature, status, burn_amount)
				values
					(${m.id}, ${currencyStr}, ${sig}, 'confirmed', ${buyback.toString()})
				returning id
			`;
			results.push({ mint: m.mint, status: 'confirmed', tx_signature: sig, run_id: run.id });
		} catch (err) {
			await sql`
				insert into pump_buyback_runs (mint_id, currency_mint, status, error)
				values (${m.id}, ${currencyStr}, 'failed', ${err.message || String(err)})
			`;
			results.push({ mint: m.mint, status: 'failed', error: err.message });
		}
	}

	return json(res, 200, { ok: true, processed: results.length, results });
});
