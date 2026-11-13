// Sponsor fee budget: a rolling-window cap on the SOL a facilitator will burn
// co-signing settles, independent of the wallet balance floor. The floor protects
// the wallet; the budget bounds the RATE, so a flood of valid small settles cannot
// drain the runway between operator top-ups.

export function createFeeBudget({ lamports, windowMs = 24 * 3600_000, clock = Date.now } = {}) {
	const spent = [];
	const prune = () => {
		const cutoff = clock() - windowMs;
		while (spent.length && spent[0].at < cutoff) spent.shift();
	};
	const used = () => {
		prune();
		return spent.reduce((n, e) => n + e.lamports, 0);
	};
	return {
		lamports,
		windowMs,
		used,
		/** Would admitting a settle of `estLamports` stay inside the budget? */
		allows(estLamports) {
			return used() + Number(estLamports || 0) <= lamports;
		},
		/**
		 * Charge a broadcast. `signature` makes the charge idempotent: Solana dedupes a
		 * resent transaction by signature, so a replay spends no second fee and must
		 * not drain the window twice.
		 */
		record(estLamports, signature = null) {
			prune();
			if (signature && spent.some((e) => e.signature === signature)) return;
			spent.push({ at: clock(), lamports: Number(estLamports || 0), signature });
		},
	};
}
