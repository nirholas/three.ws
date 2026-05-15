// Holder snapshot via Helius RPC.
//
// Pump.fun tokens are issued on Token-2022 (createV2). We poll both the
// legacy SPL Token program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA) and
// Token-2022 (TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb) so we never miss a
// holder regardless of which program the mint targets.
//
// getProgramAccounts with a mint memcmp filter returns every token account
// holding that mint. Each token account belongs to an owner wallet (the
// "holder"). We aggregate balances by owner — a single owner can have multiple
// token accounts (rare for retail wallets but does happen with multisigs).
//
// Snapshots are persisted into coin_holders via upsert; balances of zero
// (i.e. holders that fully exited) are KEPT in the table at balance=0 because
// their accrued_reflection_lamports might still be unpaid. The reflection
// payout flow filters by balance > min_holder_balance at distribution time.

import { sql } from '../db.js';

const TOKEN_PROGRAM_LEGACY = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_PROGRAM_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

// SPL Token account layout: 32-byte mint at offset 0.
// Token-2022 has the same first 165 bytes for plain token accounts (extensions
// are appended after byte 165), so dataSize-greater-than filter works.

function heliusRpcUrl(network) {
	const key = process.env.HELIUS_API_KEY;
	if (!key) throw new Error('HELIUS_API_KEY not set');
	const host = network === 'devnet' ? 'devnet.helius-rpc.com' : 'mainnet.helius-rpc.com';
	return `https://${host}/?api-key=${key}`;
}

async function rpc(network, method, params) {
	const url = heliusRpcUrl(network);
	const resp = await fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
	});
	if (!resp.ok) throw new Error(`helius_rpc_${method}_${resp.status}`);
	const data = await resp.json();
	if (data.error) throw new Error(`helius_rpc_${method}: ${data.error.message}`);
	return data.result;
}

/**
 * Fetch all holders of a given mint by walking SPL token accounts under both
 * the legacy Token program and Token-2022. Aggregates by owner wallet.
 *
 * @param {object} opts
 * @param {string} opts.mint
 * @param {'mainnet'|'devnet'} [opts.network]
 * @returns {Promise<Map<string, bigint>>}  owner → token-units
 */
export async function fetchHolderBalances({ mint, network = 'mainnet' }) {
	const balances = new Map();

	for (const programId of [TOKEN_PROGRAM_LEGACY, TOKEN_PROGRAM_2022]) {
		// jsonParsed gives us owner + tokenAmount.amount as a string directly,
		// avoiding any need to decode account data ourselves.
		const accounts = await rpc(network, 'getProgramAccounts', [
			programId,
			{
				encoding: 'jsonParsed',
				commitment: 'confirmed',
				filters: [
					{ dataSize: programId === TOKEN_PROGRAM_LEGACY ? 165 : 170 },
					{ memcmp: { offset: 0, bytes: mint } },
				],
			},
		]).catch(async (err) => {
			// Token-2022 accounts may not match exact dataSize 170 — try without
			// the dataSize filter as a fallback. This is slower but correct.
			if (programId === TOKEN_PROGRAM_2022) {
				return rpc(network, 'getProgramAccounts', [
					programId,
					{
						encoding: 'jsonParsed',
						commitment: 'confirmed',
						filters: [{ memcmp: { offset: 0, bytes: mint } }],
					},
				]);
			}
			throw err;
		});

		if (!Array.isArray(accounts)) continue;
		for (const acc of accounts) {
			const parsed = acc?.account?.data?.parsed?.info;
			if (!parsed) continue;
			const owner = parsed.owner;
			const amount = parsed.tokenAmount?.amount;
			if (!owner || amount == null) continue;
			const n = BigInt(amount);
			if (n === 0n) continue;
			balances.set(owner, (balances.get(owner) || 0n) + n);
		}
	}

	return balances;
}

/**
 * Persist a holder snapshot into coin_holders. Returns counts for logging.
 * Wallets with balance=0 in the snapshot are downgraded to balance=0 in DB
 * (so they stop accruing reflection) but the row is preserved so any pending
 * accrued_reflection_lamports remains claimable.
 *
 * @param {object} opts
 * @param {string} opts.coinId
 * @param {Map<string, bigint>} opts.balances
 */
export async function persistHolderSnapshot({ coinId, balances }) {
	const now = new Date();
	const wallets = [...balances.keys()];

	// Insert/update each wallet. Postgres jsonb-style would be nice but we
	// don't have batch tooling wired in; for snapshots of a few thousand
	// holders this is fast enough on Solana traffic.
	for (const wallet of wallets) {
		const bal = balances.get(wallet);
		await sql`
			insert into coin_holders (coin_id, wallet, balance, first_seen, last_seen)
			values (${coinId}, ${wallet}, ${bal.toString()}, ${now}, ${now})
			on conflict (coin_id, wallet) do update set
				balance = excluded.balance,
				last_seen = excluded.last_seen
		`;
	}

	// Mark wallets that vanished from the snapshot as balance=0 so they stop
	// accruing reflection. Neon's HTTP client expands arrays into Postgres
	// array params, so we use `NOT (wallet = ANY($1))` rather than `NOT IN`.
	if (wallets.length > 0) {
		await sql`
			update coin_holders
			set balance = 0
			where coin_id = ${coinId}
			  and balance > 0
			  and not (wallet = any(${wallets}))
		`;
	} else {
		await sql`
			update coin_holders set balance = 0
			where coin_id = ${coinId} and balance > 0
		`;
	}

	await sql`
		update coin_launches
		set last_snapshot_at = ${now}, updated_at = ${now}
		where id = ${coinId}
	`;

	const positive = wallets.filter((w) => balances.get(w) > 0n).length;
	return { totalAccounts: wallets.length, positive };
}

/**
 * Read the current eligible-holder set from DB. Returns {wallet, balance}
 * tuples for everyone with balance > min_holder_balance, sorted descending
 * by balance.
 */
export async function readEligibleHolders({ coinId, minBalance = 0n }) {
	const rows = await sql`
		select wallet, balance::text as balance
		from coin_holders
		where coin_id = ${coinId} and balance > ${minBalance.toString()}::bigint
		order by balance::numeric desc
	`;
	return rows.map((r) => ({ wallet: r.wallet, balance: BigInt(r.balance) }));
}
