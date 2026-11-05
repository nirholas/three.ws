#!/usr/bin/env node
// Sell every token a PLATFORM-OWNED agent wallet holds back into SOL, then close
// the emptied token accounts so their rent returns to the same wallet.
//
// Scope is the platform's own custody only: agents owned by the house account or
// a `*@agents.three.ws` circulation bot (`isPlatformOwnedAgent`, enforced in SQL
// and again in JS). A customer's agent is never touched, even though its key is
// custodied here. SOL proceeds stay in each agent's own wallet: nothing is
// transferred anywhere.
//
// $THREE is kept by default. Selling it needs the explicit `--include-three` flag.
//
// Every sell reuses the sniper's tested exit path: the pump.fun bonding curve via
// PumpTradeClient, falling through to the PumpSwap AMM when the coin graduated
// (workers/agent-sniper/amm-exit.js), broadcast by the MEV-aware execution
// engine, then `reclaimMintRent` closes the provably-empty account. A sniper
// moon bag sold here is written off in `agent_sniper_positions` so the worker's
// moon-bag manager does not chase tokens that are gone.
//
// Usage:
//   node scripts/liquidate-platform-wallets.mjs                  # dry run: quote + simulate every sell
//   node scripts/liquidate-platform-wallets.mjs --apply --yes    # sell for real
//   options: --agent <id>   only this agent
//            --mint <mint>  only this mint
//            --include-three  also sell $THREE (off by default)
//            --slippage <pct> default 10
//            --out <file>   write the per-holding JSON report here
//
// Env: DATABASE_URL, the wallet decryption keys (WALLET_ENCRYPTION_KEY and/or
// JWT_SECRET), and a mainnet RPC (SOLANA_RPC_URL or HELIUS_API_KEY).

import fs from 'node:fs';
import { config as dotenv } from 'dotenv';

dotenv({ path: '.env' });
dotenv({ path: '.env.local', override: false });

const { sql } = await import('../api/_lib/db.js');
const { recoverSolanaAgentKeypair } = await import('../api/_lib/agent-wallet.js');
const { isPlatformOwnedAgent, PLATFORM_AGENT_OWNER_EMAIL, PLATFORM_AGENT_EMAIL_SUFFIX } = await import(
	'../api/_lib/custodial-key-health.js'
);
const { getTradeCtx, signAndSend } = await import('../workers/agent-sniper/trade-client.js');
const { buildAmmSellInstructions } = await import('../workers/agent-sniper/amm-exit.js');
const { reclaimMintRent } = await import('../workers/agent-sniper/rent-reclaim.js');
const { TOKEN_PROGRAMS, deriveTokenAccounts } = await import('../workers/agent-sniper/reconcile.js');

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const opt = (f, d) => {
	const i = args.indexOf(f);
	return i >= 0 && args[i + 1] ? args[i + 1] : d;
};

const APPLY = has('--apply');
const CONFIRMED = has('--yes');
const INCLUDE_THREE = has('--include-three');
const ONLY_AGENT = opt('--agent', null);
const ONLY_MINT = opt('--mint', null);
const SLIPPAGE_PCT = Number(opt('--slippage', '10'));
const OUT = opt('--out', null);
const NETWORK = 'mainnet';
// Pinned, never read from env: an unset THREE_TOKEN_MINT must not turn the keep-$THREE guard off.
const THREE_MINT = 'FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump';
const CONFIRM_TIMEOUT_MS = 60_000;
// Below this the wallet cannot pay even a base fee, so no sell can land.
const MIN_FEE_LAMPORTS = 20_000;

if (APPLY && !CONFIRMED) {
	console.error('Refusing to sell without `--yes`. Run the dry run first and review its table.');
	process.exit(1);
}
if (!Number.isFinite(SLIPPAGE_PCT) || SLIPPAGE_PCT <= 0 || SLIPPAGE_PCT > 50) {
	console.error('--slippage must be a percentage between 0 and 50.');
	process.exit(1);
}

const ctx = await getTradeCtx(NETWORK);
const { web3, BN, connection } = ctx;

const agents = await sql`
	SELECT a.id, a.name, a.user_id, a.meta->>'solana_address' AS address,
	       a.meta->>'encrypted_solana_secret' AS enc, LOWER(u.email) AS owner_email
	FROM agent_identities a
	JOIN users u ON u.id = a.user_id
	WHERE a.deleted_at IS NULL
	  AND a.meta->>'solana_address' IS NOT NULL
	  AND a.meta->>'encrypted_solana_secret' IS NOT NULL
	  AND (LOWER(u.email) = ${PLATFORM_AGENT_OWNER_EMAIL} OR LOWER(u.email) LIKE ${'%' + PLATFORM_AGENT_EMAIL_SUFFIX})
	  AND (${ONLY_AGENT}::uuid IS NULL OR a.id = ${ONLY_AGENT}::uuid)
	ORDER BY a.name
`;
const owned = agents.filter((a) => isPlatformOwnedAgent(a.owner_email));

/** Every token account the wallet holds, empty ones included (their rent is reclaimable). */
async function readHoldings(ownerPk) {
	const rows = [];
	for (const programId of TOKEN_PROGRAMS) {
		const res = await connection.getParsedTokenAccountsByOwner(ownerPk, { programId: new web3.PublicKey(programId) });
		for (const { pubkey, account } of res.value) {
			const info = account.data.parsed.info;
			const amount = BigInt(info.tokenAmount.amount);
			rows.push({ account: pubkey.toBase58(), programId, mint: info.mint, amount, decimals: info.tokenAmount.decimals });
		}
	}
	return rows;
}

/** Quote + build a full sell of `amount`, curve first, AMM once graduated. */
async function buildSell(ownerPk, mint, amount) {
	const mintPk = new web3.PublicKey(mint);
	const baseAmount = new BN(amount.toString());
	try {
		const quote = await ctx.client.quoteForSell({ mint: mintPk, baseAmount, slippagePct: SLIPPAGE_PCT });
		const built = await ctx.client.buildSellInstructions({ mint: mintPk, user: ownerPk, baseAmount, slippagePct: SLIPPAGE_PCT });
		return { venue: 'curve', expectedLamports: BigInt(quote.expectedQuoteOut.toString()), instructions: built.instructions };
	} catch (err) {
		if (err?.name !== 'CoinGraduatedError') throw err;
	}
	const built = await buildAmmSellInstructions({ network: NETWORK, mint, user: ownerPk, baseAmount, slippagePct: SLIPPAGE_PCT });
	return { venue: 'amm', expectedLamports: BigInt(built.expectedQuoteOut), instructions: built.instructions };
}

/** Dry-run proof that the sell would land: simulate it as the wallet, unsigned. */
async function simulate(payerPk, instructions) {
	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	const message = new web3.TransactionMessage({ payerKey: payerPk, recentBlockhash: blockhash, instructions }).compileToV0Message();
	const sim = await connection.simulateTransaction(new web3.VersionedTransaction(message), {
		sigVerify: false,
		replaceRecentBlockhash: true,
	});
	if (sim.value.err) {
		const tail = (sim.value.logs || []).filter((l) => /error|failed/i.test(l)).slice(-2).join(' | ');
		throw new Error(`simulation failed: ${JSON.stringify(sim.value.err)}${tail ? ` (${tail})` : ''}`);
	}
}

/**
 * Close the sniper's moon-bag ledger rows for a mint this run just sold, so the
 * moon-bag manager stops quoting (and trying to sell) a bag that no longer exists.
 * Before the moon-bag manager migration adds `moonbag_closed_at`, the only true
 * statement the ledger can make is that the bag now holds zero, so the size is
 * zeroed instead; the report keeps the size each row carried.
 * @returns {Promise<Array<{id:string, base:string}>>}
 */
async function writeOffMoonbags(agentId, mint) {
	try {
		return await sql`
			UPDATE agent_sniper_positions
			SET moonbag_closed_at = now(), moonbag_exit_reason = 'owner_liquidation'
			WHERE agent_id = ${agentId} AND mint = ${mint}
			  AND moonbag_base_amount > 0 AND moonbag_closed_at IS NULL
			RETURNING id, moonbag_base_amount::text AS base
		`;
	} catch (err) {
		if (err?.code !== '42703') throw err;
	}
	return sql`
		UPDATE agent_sniper_positions p
		SET moonbag_base_amount = 0
		FROM agent_sniper_positions old
		WHERE p.id = old.id AND p.agent_id = ${agentId} AND p.mint = ${mint} AND p.moonbag_base_amount > 0
		RETURNING p.id, old.moonbag_base_amount::text AS base
	`;
}

// pump.fun curve `overflow` (6023 / 0x1787): the curve's real SOL reserve cannot
// pay out the full bag, which happens when several fleet wallets exit the same
// self-launched coin back to back. A smaller slice still clears.
const isCurveOverflow = (err) => /0x1787|"Custom":6023/.test(String(err?.message || err));
const MAX_HALVINGS = 8;

/** Sell `amount`, halving the slice on curve overflow until it clears or is spent. */
async function sellWithBackoff(row, ownerPk, keypair, mint, amount) {
	let slice = amount;
	for (let attempt = 0; ; attempt++) {
		const built = await buildSell(ownerPk, mint, slice);
		row.venue = built.venue;
		try {
			if (!APPLY) await simulate(ownerPk, built.instructions);
			else row.sig = await signAndSend(ctx, keypair, built.instructions, CONFIRM_TIMEOUT_MS);
			row.expectedSol = lamportsToSol(built.expectedLamports);
			row.soldAmount = slice.toString();
			return;
		} catch (err) {
			if (built.venue !== 'curve' || !isCurveOverflow(err) || attempt >= MAX_HALVINGS || slice < 2n) throw err;
			slice /= 2n;
		}
	}
}

const report = [];
const lamportsToSol = (l) => Number(l) / 1e9;

console.log(`${APPLY ? 'LIVE' : 'DRY RUN'}: ${owned.length} platform-owned wallets, $THREE ${INCLUDE_THREE ? 'INCLUDED' : 'kept'}, slippage ${SLIPPAGE_PCT}%\n`);

for (const agent of owned) {
	const ownerPk = new web3.PublicKey(agent.address);
	let holdings;
	try {
		holdings = await readHoldings(ownerPk);
	} catch (err) {
		report.push({ agent: agent.name, agentId: agent.id, wallet: agent.address, status: 'read_failed', error: err.message });
		continue;
	}
	holdings = holdings.filter((h) => (INCLUDE_THREE || h.mint !== THREE_MINT) && (!ONLY_MINT || h.mint === ONLY_MINT));
	if (!holdings.length) continue;

	const openPositions = new Set(
		(await sql`SELECT mint FROM agent_sniper_positions WHERE agent_id = ${agent.id} AND status IN ('opening', 'open', 'closing')`).map((r) => r.mint),
	);

	let keypair = null;
	if (APPLY) {
		keypair = await recoverSolanaAgentKeypair(agent.enc, { agentId: agent.id, userId: agent.user_id, reason: 'owner_liquidation' });
		if (keypair.publicKey.toBase58() !== agent.address) {
			report.push({ agent: agent.name, agentId: agent.id, wallet: agent.address, status: 'key_mismatch' });
			continue;
		}
	}

	for (const h of holdings) {
		const row = { agent: agent.name, agentId: agent.id, wallet: agent.address, mint: h.mint, amount: h.amount.toString() };
		report.push(row);
		if (openPositions.has(h.mint)) {
			Object.assign(row, { status: 'skipped', error: 'live sniper position: the worker owns this exit' });
			continue;
		}
		if (h.amount > 0n) {
			const ata = deriveTokenAccounts(ctx, ownerPk, new web3.PublicKey(h.mint))[TOKEN_PROGRAMS.indexOf(h.programId)];
			if (ata.toBase58() !== h.account) {
				Object.assign(row, { status: 'skipped', error: 'tokens sit in a non-associated account the sell builders cannot spend' });
				continue;
			}
			try {
				const sol = await connection.getBalance(ownerPk, 'confirmed');
				if (sol < MIN_FEE_LAMPORTS) {
					Object.assign(row, { status: 'skipped', error: `wallet holds ${lamportsToSol(sol)} SOL, too little to pay a fee` });
					continue;
				}
				await sellWithBackoff(row, ownerPk, keypair, h.mint, h.amount);
				row.status = APPLY ? 'sold' : 'would_sell';
			} catch (err) {
				Object.assign(row, { status: 'failed', error: String(err?.message || err).replace(/\s+/g, ' ').slice(0, 300) });
			}
		} else {
			row.status = APPLY ? 'emptied' : 'would_close';
		}
		// A landed sell is a sale whatever happens next: the ledger and rent steps
		// below report their own outcome and never relabel the row.
		if (APPLY && (row.status === 'sold' || row.status === 'emptied')) {
			if (row.status === 'sold') {
				try {
					row.moonbagsClosed = await writeOffMoonbags(agent.id, h.mint);
				} catch (err) {
					row.moonbagError = String(err?.message || err).slice(0, 200);
				}
			}
			if (row.soldAmount === undefined || row.soldAmount === row.amount) {
				const rent = await reclaimMintRent({
					ctx,
					keypair,
					mint: h.mint,
					sendTx: (ixs) => signAndSend(ctx, keypair, ixs, CONFIRM_TIMEOUT_MS),
					tag: { agent: agent.id, mint: h.mint },
				});
				row.rentSol = lamportsToSol(rent.rentLamports || 0);
				if (rent.sig) row.rentSig = rent.sig;
				if (rent.skipped) row.rentSkipped = rent.skipped;
			}
		}
		console.log(`${row.status.padEnd(11)} ${agent.name.slice(0, 28).padEnd(28)} ${h.mint.slice(0, 10)} ${row.venue || ''} ${row.expectedSol ?? ''} ${row.sig || row.rentSig || row.error || ''}`);
	}
}

const by = (s) => report.filter((r) => r.status === s);
const sum = (rows, k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
const done = APPLY ? by('sold') : by('would_sell');
const closes = APPLY ? by('emptied') : by('would_close');
console.log('\nSummary');
console.table({
	[APPLY ? 'sold' : 'would_sell']: { holdings: done.length, sol: sum(done, 'expectedSol').toFixed(6) },
	skipped: { holdings: by('skipped').length, sol: sum(by('skipped'), 'expectedSol').toFixed(6) },
	failed: { holdings: by('failed').length, sol: sum(by('failed'), 'expectedSol').toFixed(6) },
	read_failed: { holdings: by('read_failed').length, sol: 0 },
	[APPLY ? 'emptied' : 'would_close']: { holdings: closes.length, sol: 0 },
});
if (APPLY) {
	const moonbags = done.flatMap((r) => r.moonbagsClosed || []);
	console.log(`rent reclaimed: ${sum([...done, ...closes], 'rentSol').toFixed(6)} SOL, moon-bag rows written off: ${moonbags.length}`);
}
const reasons = {};
for (const r of [...by('skipped'), ...by('failed')]) reasons[r.error.split(':')[0].slice(0, 80)] = (reasons[r.error.split(':')[0].slice(0, 80)] || 0) + 1;
if (Object.keys(reasons).length) console.table(reasons);
if (OUT) fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
if (!APPLY) console.log('\nDry run: nothing was signed. Re-run with `--apply --yes` to sell.');
process.exit(0);
