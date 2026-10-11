// Constant-product maths for a pump.fun bonding curve, from the coin's own
// reported virtual reserves. Paper fills use real, live reserves, so a paper
// trade shows the price and impact the same order would get on chain, less
// the venue fee.

const FEE = 0.01;
const LAMPORTS = 1e9;

function reserves(coin) {
	const s = Number(coin?.virtual_sol_reserves);
	const t = Number(coin?.virtual_token_reserves);
	if (!(s > 0) || !(t > 0)) throw new Error('coin has no usable reserves');
	return { s, t };
}

export function quoteBuy(coin, sol) {
	const { s, t } = reserves(coin);
	const inLamports = sol * LAMPORTS * (1 - FEE);
	const tokens = t - (s * t) / (s + inLamports);
	const spot = s / t;
	const exec = (sol * LAMPORTS) / tokens;
	return { tokens: Math.floor(tokens), impact_pct: Math.max(0, (exec / spot - 1) * 100) };
}

export function quoteSell(coin, tokens) {
	const { s, t } = reserves(coin);
	const out = s - (s * t) / (t + tokens);
	return { lamports: Math.floor(out * (1 - FEE)) };
}
