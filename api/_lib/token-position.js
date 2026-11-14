// Exact token positions for sizing a sell.
//
// A sell can be asked for in tokens ("all", or an amount like 12.5) rather than
// base units. Sizing it from a float UI balance can overshoot the real balance
// by a rounding step and fail at the venue, so this reads the raw on-chain
// amount (SPL Token and Token-2022, summed across token accounts) and does all
// sizing in BigInt. Shared by runAgentTrade (every trade caller) and autopilot.

/**
 * Every token the owner holds a non-zero balance of, as
 * Map<mint, { raw: bigint, decimals: number }>. Live RPC read; throws when the
 * RPC is unreachable so a caller can refuse rather than guess.
 * @param {import('@solana/web3.js').Connection} conn
 * @param {string|PublicKey} owner
 */
export async function readTokenBalances(conn, owner) {
	// Loaded on first read so the pure sizing helpers stay cheap to import.
	const { PublicKey } = await import('@solana/web3.js');
	const { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID } = await import('@solana/spl-token');
	const ownerPk = owner instanceof PublicKey ? owner : new PublicKey(owner);
	const balances = new Map();
	for (const programId of [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID]) {
		const resp = await conn.getParsedTokenAccountsByOwner(ownerPk, { programId });
		for (const { account } of resp.value) {
			const info = account.data?.parsed?.info;
			const raw = BigInt(info?.tokenAmount?.amount ?? '0');
			if (!info?.mint || raw <= 0n) continue;
			const prev = balances.get(info.mint);
			balances.set(info.mint, { raw: (prev?.raw ?? 0n) + raw, decimals: Number(info.tokenAmount.decimals) || 0 });
		}
	}
	return balances;
}

/** "all" (any case) or a positive finite token amount (number or plain decimal string); null otherwise. */
export function parseAmountTokens(value) {
	if (typeof value === 'string' && value.trim().toLowerCase() === 'all') return 'all';
	if (typeof value !== 'number' && !(typeof value === 'string' && /^\s*\d*\.?\d+\s*$/.test(value))) return null;
	const n = Number(value);
	return Number.isFinite(n) && n > 0 ? n : null;
}

/** A decimal token amount in base units, truncated (never rounded up) to the mint decimals. */
export function tokensToRaw(amount, decimals) {
	const text = amount.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 20 });
	const [whole, frac = ''] = text.split('.');
	return BigInt(whole + frac.slice(0, decimals).padEnd(decimals, '0'));
}

/** Base units as a human token amount: exact, grouped, trailing zeros trimmed. */
export function formatRaw(raw, decimals) {
	const s = BigInt(raw).toString().padStart(decimals + 1, '0');
	const whole = s.slice(0, s.length - decimals);
	const frac = decimals ? s.slice(-decimals).replace(/0+$/, '') : '';
	return `${BigInt(whole).toLocaleString('en-US')}${frac ? `.${frac}` : ''}`;
}

/**
 * The exact base-unit size of a sell against the live position: "all" is the
 * whole balance, a token amount converts with the mint decimals, base units
 * pass through. Returns { raw: string } or { refusal: { status, code, message } }.
 * @param {{ mint: string, amountTokens?: 'all'|number|null, tokenAmountRaw?: string|null }} sell
 * @param {{ raw: bigint, decimals: number }|null|undefined} position
 */
export function resolveSellSize({ mint, amountTokens = null, tokenAmountRaw = null }, position) {
	const label = `${mint.slice(0, 6)}…`;
	if (!position) {
		return { refusal: { status: 409, code: 'no_position', message: `The agent wallet holds none of ${label}, so there is nothing to sell.` } };
	}
	let raw;
	if (amountTokens === 'all') raw = position.raw;
	else if (amountTokens != null) raw = tokensToRaw(amountTokens, position.decimals);
	else raw = BigInt(tokenAmountRaw);
	if (raw <= 0n) {
		return { refusal: { status: 400, code: 'invalid_trade', message: `That amount is below the smallest unit of ${label}.` } };
	}
	if (raw > position.raw) {
		return {
			refusal: {
				status: 409,
				code: 'insufficient_tokens',
				message: `The wallet holds ${formatRaw(position.raw, position.decimals)} of ${label}, less than the ${formatRaw(raw, position.decimals)} this sell asks for.`,
			},
		};
	}
	return { raw: raw.toString() };
}
