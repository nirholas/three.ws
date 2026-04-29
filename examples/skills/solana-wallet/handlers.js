// solana-wallet — generic Solana primitives. Uses ctx.wallet (the contract from
// api/_lib/solana-wallet.js: { publicKey, signTransaction, sendAndConfirm }).

import {
	Connection,
	PublicKey,
	SystemProgram,
	Transaction,
	LAMPORTS_PER_SOL,
	ComputeBudgetProgram,
} from '@solana/web3.js';
import {
	NATIVE_MINT,
	createAssociatedTokenAccountIdempotentInstruction,
	createSyncNativeInstruction,
	createTransferCheckedInstruction,
	createCloseAccountInstruction,
	getAssociatedTokenAddressSync,
	getMint,
	getAccount,
} from '@solana/spl-token';

function getConn(ctx) {
	const rpc = ctx?.skillConfig?.rpc ?? 'https://api.mainnet-beta.solana.com';
	return new Connection(rpc, 'confirmed');
}

function priorityIxs(ctx) {
	const micro = ctx?.skillConfig?.priorityFeeMicroLamports ?? 0;
	return micro > 0 ? [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: micro })] : [];
}

function requireWallet(ctx) {
	if (!ctx?.wallet?.publicKey) throw new Error('solana-wallet requires ctx.wallet');
	return ctx.wallet;
}

function resolveAddr(ctx, addr) {
	if (addr) return new PublicKey(addr);
	return requireWallet(ctx).publicKey;
}

export async function getAddress(_args, ctx) {
	return { ok: true, data: { address: requireWallet(ctx).publicKey.toBase58() } };
}

export async function getBalance(args, ctx) {
	const conn = getConn(ctx);
	const pk = resolveAddr(ctx, args?.address);
	const lamports = await conn.getBalance(pk);
	return { ok: true, data: { address: pk.toBase58(), lamports, sol: lamports / LAMPORTS_PER_SOL } };
}

export async function getSplBalances(args, ctx) {
	const conn = getConn(ctx);
	const pk = resolveAddr(ctx, args?.address);
	const resp = await conn.getParsedTokenAccountsByOwner(pk, {
		programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
	});
	const balances = resp.value
		.map((acc) => {
			const info = acc.account.data.parsed.info;
			return {
				mint: info.mint,
				amount: info.tokenAmount.uiAmount,
				decimals: info.tokenAmount.decimals,
			};
		})
		.filter((b) => (b.amount ?? 0) > 0);
	return { ok: true, data: { address: pk.toBase58(), balances } };
}

export async function transferSol(args, ctx) {
	const cap = ctx?.skillConfig?.maxTransferSol ?? Infinity;
	if (args.amountSol > cap) {
		return { ok: false, error: `amountSol ${args.amountSol} exceeds cap ${cap}` };
	}
	const conn = getConn(ctx);
	const wallet = requireWallet(ctx);
	const tx = new Transaction().add(
		...priorityIxs(ctx),
		SystemProgram.transfer({
			fromPubkey: wallet.publicKey,
			toPubkey: new PublicKey(args.to),
			lamports: Math.round(args.amountSol * LAMPORTS_PER_SOL),
		}),
	);
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.feePayer = wallet.publicKey;
	const sig = await wallet.sendAndConfirm(tx, conn);
	ctx?.memory?.note?.('solana-wallet:transferSol', { to: args.to, amountSol: args.amountSol, sig });
	return { ok: true, data: { sig } };
}

export async function transferSpl(args, ctx) {
	const conn = getConn(ctx);
	const wallet = requireWallet(ctx);
	const mintPk = new PublicKey(args.mint);
	const toPk = new PublicKey(args.to);

	const mintInfo = await getMint(conn, mintPk);
	const fromAta = getAssociatedTokenAddressSync(mintPk, wallet.publicKey);
	const toAta = getAssociatedTokenAddressSync(mintPk, toPk);
	const rawAmount = BigInt(Math.round(args.amount * 10 ** mintInfo.decimals));

	const tx = new Transaction().add(
		...priorityIxs(ctx),
		createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, toAta, toPk, mintPk),
		createTransferCheckedInstruction(
			fromAta,
			mintPk,
			toAta,
			wallet.publicKey,
			rawAmount,
			mintInfo.decimals,
		),
	);
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.feePayer = wallet.publicKey;
	const sig = await wallet.sendAndConfirm(tx, conn);
	ctx?.memory?.note?.('solana-wallet:transferSpl', { mint: args.mint, to: args.to, amount: args.amount, sig });
	return { ok: true, data: { sig } };
}

export async function wrapSol(args, ctx) {
	const conn = getConn(ctx);
	const wallet = requireWallet(ctx);
	const ata = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
	const lamports = Math.round(args.amountSol * LAMPORTS_PER_SOL);
	const tx = new Transaction().add(
		...priorityIxs(ctx),
		createAssociatedTokenAccountIdempotentInstruction(wallet.publicKey, ata, wallet.publicKey, NATIVE_MINT),
		SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: ata, lamports }),
		createSyncNativeInstruction(ata),
	);
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.feePayer = wallet.publicKey;
	const sig = await wallet.sendAndConfirm(tx, conn);
	return { ok: true, data: { sig, wsolAta: ata.toBase58() } };
}

export async function unwrapSol(_args, ctx) {
	const conn = getConn(ctx);
	const wallet = requireWallet(ctx);
	const ata = getAssociatedTokenAddressSync(NATIVE_MINT, wallet.publicKey);
	await getAccount(conn, ata);
	const tx = new Transaction().add(
		...priorityIxs(ctx),
		createCloseAccountInstruction(ata, wallet.publicKey, wallet.publicKey),
	);
	const { blockhash } = await conn.getLatestBlockhash();
	tx.recentBlockhash = blockhash;
	tx.feePayer = wallet.publicKey;
	const sig = await wallet.sendAndConfirm(tx, conn);
	return { ok: true, data: { sig } };
}

export async function getRecentSignatures(args, ctx) {
	const conn = getConn(ctx);
	const pk = resolveAddr(ctx, args?.address);
	const sigs = await conn.getSignaturesForAddress(pk, { limit: args?.limit ?? 25 });
	return { ok: true, data: { signatures: sigs } };
}
