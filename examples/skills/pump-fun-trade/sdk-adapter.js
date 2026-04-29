// SDK adapter — single shim layer between pump-fun-trade handlers and the
// upstream @pump-fun/pump-sdk + @pump-fun/pump-swap-sdk packages.
//
// Why: the SDKs ship breaking changes regularly (method renames, return
// shape changes, instruction-builder signatures). Funneling everything
// through this file means a SDK bump touches one place, not every handler.
//
// All upstream calls are done lazily so this module is safe to import even
// if the SDKs aren't installed (e.g. during DSL-only tests).

let _pump, _amm;
async function pumpSdk() {
	if (_pump) return _pump;
	const mod = await import('@pump-fun/pump-sdk');
	_pump = mod.PumpSdk ?? mod.default ?? mod;
	return _pump;
}
async function ammSdk() {
	if (_amm) return _amm;
	const mod = await import('@pump-fun/pump-swap-sdk');
	_amm = mod.PumpAmmSdk ?? mod.PumpSwapSdk ?? mod.default ?? mod;
	return _amm;
}

function getCurveCompleteFlag(curve) {
	// Different SDK versions name this `complete`, `graduated`, or expose
	// `completeAt` instead. Treat any of them as "graduated".
	if (curve == null) return true;
	if (curve.complete === true) return true;
	if (curve.graduated === true) return true;
	if (curve.completeAt) return true;
	return false;
}

export async function makeAdapter(conn) {
	const Pump = await pumpSdk();
	const Amm = await ammSdk();
	const pump = new Pump(conn);
	const amm = new Amm(conn);

	async function isGraduated(mintPk) {
		try {
			const curve = await (pump.fetchBondingCurve ?? pump.getBondingCurve).call(pump, mintPk);
			return getCurveCompleteFlag(curve);
		} catch {
			return true; // missing curve == post-graduation
		}
	}

	async function venueFor(mintPk) {
		return (await isGraduated(mintPk)) ? amm : pump;
	}

	return {
		isGraduated,
		venueFor,

		async quote({ mintPk, side, amountSol, amountTokens }) {
			const v = await venueFor(mintPk);
			const fn = v.quote ?? v.getQuote ?? v.simulate;
			if (!fn) throw new Error('SDK: no quote function found');
			return fn.call(v, { mint: mintPk, side, amountSol, amountTokens });
		},

		async buyTx({ mintPk, payerPk, amountSol, slippageBps, extraIxs = [] }) {
			const v = await venueFor(mintPk);
			const fn = v.buyTx ?? v.buyInstructions ?? v.buildBuyTx;
			if (!fn) throw new Error('SDK: no buy function found');
			return fn.call(v, { payer: payerPk, mint: mintPk, amountSol, slippageBps, extraIxs });
		},

		async sellTx({ mintPk, payerPk, amountTokens, slippageBps, extraIxs = [] }) {
			const v = await venueFor(mintPk);
			const fn = v.sellTx ?? v.sellInstructions ?? v.buildSellTx;
			if (!fn) throw new Error('SDK: no sell function found');
			return fn.call(v, { payer: payerPk, mint: mintPk, amountTokens, slippageBps, extraIxs });
		},

		async createTx({ creatorPk, name, symbol, description, imageUrl, twitter, telegram, website, initialBuySol, extraIxs = [] }) {
			const fn = pump.createTx ?? pump.createInstructions ?? pump.buildCreateTx;
			if (!fn) throw new Error('SDK: no create function found');
			return fn.call(pump, {
				creator: creatorPk,
				name, symbol, description, imageUrl,
				twitter, telegram, website,
				initialBuySol: initialBuySol ?? 0,
				extraIxs,
			});
		},

		async fetchTokenBalance(ownerPk, mintPk) {
			const fn = pump.fetchTokenBalance ?? pump.getTokenBalance;
			if (fn) return fn.call(pump, ownerPk, mintPk);
			// Fallback: query token accounts via the connection.
			const { TOKEN_PROGRAM_ID } = await import('@solana/spl-token');
			const resp = await conn.getParsedTokenAccountsByOwner(ownerPk, {
				mint: mintPk, programId: TOKEN_PROGRAM_ID,
			});
			return resp.value[0]?.account.data.parsed.info.tokenAmount.uiAmount ?? 0;
		},
	};
}
