// pump-fun-trade — signing actions. All upstream SDK quirks are isolated to
// sdk-adapter.js so a SDK upgrade only ripples through one file.

import { Connection, PublicKey, ComputeBudgetProgram } from '@solana/web3.js';
import { makeAdapter } from './sdk-adapter.js';

function getConn(ctx) {
	const rpc = ctx?.skillConfig?.rpc ?? 'https://api.mainnet-beta.solana.com';
	return new Connection(rpc, 'confirmed');
}

function getWallet(ctx) {
	if (!ctx?.wallet?.publicKey) throw new Error('pump-fun-trade requires ctx.wallet');
	return ctx.wallet;
}

function priorityIxs(ctx) {
	const micro = ctx?.skillConfig?.priorityFeeMicroLamports ?? 0;
	return micro > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micro })] : [];
}

export async function quoteTrade(args, ctx) {
	const conn = getConn(ctx);
	const sdk = await makeAdapter(conn);
	const mintPk = new PublicKey(args.mint);
	const route = (await sdk.isGraduated(mintPk)) ? 'pumpswap' : 'curve';
	const quote = await sdk.quote({
		mintPk,
		side: args.side,
		amountSol: args.amountSol,
		amountTokens: args.amountTokens,
	});
	return { ok: true, data: { route, ...quote } };
}

export async function buyToken(args, ctx) {
	const cap = ctx?.skillConfig?.maxSpendSol ?? Infinity;
	if (args.amountSol > cap) {
		return { ok: false, error: `amountSol ${args.amountSol} exceeds cap ${cap}` };
	}
	const conn = getConn(ctx);
	const wallet = getWallet(ctx);
	const sdk = await makeAdapter(conn);
	const mintPk = new PublicKey(args.mint);
	const slippageBps = args.slippageBps ?? ctx?.skillConfig?.slippageBps ?? 100;

	const tx = await sdk.buyTx({
		mintPk,
		payerPk: wallet.publicKey,
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
	const sdk = await makeAdapter(conn);
	const mintPk = new PublicKey(args.mint);
	const slippageBps = args.slippageBps ?? ctx?.skillConfig?.slippageBps ?? 100;

	let amountTokens = args.amountTokens;
	if (!amountTokens && args.percent) {
		const bal = await sdk.fetchTokenBalance(wallet.publicKey, mintPk);
		amountTokens = (bal * args.percent) / 100;
	}
	if (!amountTokens) return { ok: false, error: 'amountTokens or percent required' };

	const tx = await sdk.sellTx({
		mintPk,
		payerPk: wallet.publicKey,
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
	const sdk = await makeAdapter(conn);
	const { tx, mint } = await sdk.createTx({
		creatorPk: wallet.publicKey,
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
