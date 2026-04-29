// pump-fun-trade — signing actions via @pump-fun/pump-swap-sdk + @pump-fun/pump-sdk.
// Wallet is supplied by the host runtime via ctx.wallet (Keypair-like + signTransaction).

import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { PumpSdk } from '@pump-fun/pump-sdk';
import { PumpAmmSdk } from '@pump-fun/pump-swap-sdk';

function getConn(ctx) {
	const rpc = ctx?.skillConfig?.rpc ?? 'https://api.mainnet-beta.solana.com';
	return new Connection(rpc, 'confirmed');
}

function getWallet(ctx) {
	if (!ctx?.wallet) throw new Error('pump-fun-trade requires ctx.wallet');
	return ctx.wallet;
}

async function isGraduated(sdk, mintPk) {
	const curve = await sdk.fetchBondingCurve(mintPk).catch(() => null);
	return !curve || curve.complete === true;
}

function priorityIxs(ctx) {
	const micro = ctx?.skillConfig?.priorityFeeMicroLamports ?? 0;
	return micro > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micro })] : [];
}

export async function quoteTrade(args, ctx) {
	const conn = getConn(ctx);
	const mintPk = new PublicKey(args.mint);
	const pump = new PumpSdk(conn);
	const amm = new PumpAmmSdk(conn);
	const graduated = await isGraduated(pump, mintPk);
	const venue = graduated ? amm : pump;
	const quote = await venue.quote({
		mint: mintPk,
		side: args.side,
		amountSol: args.amountSol,
		amountTokens: args.amountTokens,
	});
	return { ok: true, data: { route: graduated ? 'pumpswap' : 'curve', ...quote } };
}

export async function buyToken(args, ctx) {
	const cap = ctx?.skillConfig?.maxSpendSol ?? Infinity;
	if (args.amountSol > cap) {
		return { ok: false, error: `amountSol ${args.amountSol} exceeds cap ${cap}` };
	}
	const conn = getConn(ctx);
	const wallet = getWallet(ctx);
	const mintPk = new PublicKey(args.mint);
	const pump = new PumpSdk(conn);
	const amm = new PumpAmmSdk(conn);
	const slippageBps = args.slippageBps ?? ctx?.skillConfig?.slippageBps ?? 100;
	const venue = (await isGraduated(pump, mintPk)) ? amm : pump;
	const tx = await venue.buyTx({
		payer: wallet.publicKey,
		mint: mintPk,
		amountSol: args.amountSol,
		slippageBps,
		extraIxs: priorityIxs(ctx),
	});
	const sig = await wallet.sendAndConfirm(tx, conn);
	ctx?.memory?.note?.('pump-fun-trade:buy', { mint: args.mint, amountSol: args.amountSol, sig });
	return { ok: true, data: { sig, mint: args.mint, amountSol: args.amountSol } };
}

export async function sellToken(args, ctx) {
	const conn = getConn(ctx);
	const wallet = getWallet(ctx);
	const mintPk = new PublicKey(args.mint);
	const pump = new PumpSdk(conn);
	const amm = new PumpAmmSdk(conn);
	const slippageBps = args.slippageBps ?? ctx?.skillConfig?.slippageBps ?? 100;

	let amountTokens = args.amountTokens;
	if (!amountTokens && args.percent) {
		const bal = await pump.fetchTokenBalance(wallet.publicKey, mintPk);
		amountTokens = (bal * args.percent) / 100;
	}
	if (!amountTokens) return { ok: false, error: 'amountTokens or percent required' };

	const venue = (await isGraduated(pump, mintPk)) ? amm : pump;
	const tx = await venue.sellTx({
		payer: wallet.publicKey,
		mint: mintPk,
		amountTokens,
		slippageBps,
		extraIxs: priorityIxs(ctx),
	});
	const sig = await wallet.sendAndConfirm(tx, conn);
	ctx?.memory?.note?.('pump-fun-trade:sell', { mint: args.mint, amountTokens, sig });
	return { ok: true, data: { sig, mint: args.mint, amountTokens } };
}

export async function createToken(args, ctx) {
	const conn = getConn(ctx);
	const wallet = getWallet(ctx);
	const pump = new PumpSdk(conn);
	const { tx, mint } = await pump.createTx({
		creator: wallet.publicKey,
		name: args.name,
		symbol: args.symbol,
		description: args.description,
		imageUrl: args.imageUrl,
		twitter: args.twitter,
		telegram: args.telegram,
		website: args.website,
		initialBuySol: args.initialBuySol ?? 0,
		extraIxs: priorityIxs(ctx),
	});
	const sig = await wallet.sendAndConfirm(tx, conn);
	ctx?.memory?.note?.('pump-fun-trade:create', { mint: mint.toBase58(), sig });
	return { ok: true, data: { sig, mint: mint.toBase58() } };
}
