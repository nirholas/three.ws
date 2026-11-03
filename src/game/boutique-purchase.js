// $THREE boutique purchase (W04), the client half of the in-game premium
// cosmetics rail. Real on-chain settlement: the buyer's own connected Solana
// wallet signs ONE $THREE transfer (server-built, server-priced, split
// between the holder-rewards pool and the treasury, see
// multiplayer/src/game-token.js), we broadcast it, and only once the server
// re-reads the CONFIRMED transaction from RPC does it grant the cosmetic.
// Mirrors coin-buy.js's connect → sign → broadcast → confirm flow.

import { detectSolanaWallet, SOLANA_RPC, solanaTxExplorerUrl } from '../erc8004/solana-deploy.js';

// Overridable for local/devnet verification only (mirrors window.GAME_SERVER_URL
// in community-net.js). Every real deploy leaves this unset and settles on
// mainnet, matching the server's default SOLANA_RPC_URL.
function boutiqueNetwork() {
	return (typeof window !== 'undefined' && window.GAME_TOKEN_NETWORK) || 'mainnet';
}

// A fully custom RPC endpoint (e.g. a local `solana-test-validator`), for
// verification runs only, production never sets this and always resolves
// through the same-origin proxy in SOLANA_RPC.
function boutiqueRpcUrl() {
	if (typeof window !== 'undefined' && window.GAME_TOKEN_RPC_URL) return window.GAME_TOKEN_RPC_URL;
	return SOLANA_RPC[boutiqueNetwork()] || SOLANA_RPC.mainnet;
}

function decodeBase64(b64) {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

/**
 * Map a purchase failure to copy the player can act on, mirroring
 * coin-buy.js's friendlyTradeError.
 * @param {Error} err
 */
function friendlyBoutiqueError(err) {
	const raw = (err && (err.message || String(err))) || '';
	const m = raw.toLowerCase();
	if (/reject|denied|cancell?ed|user declined/.test(m)) return 'Cancelled in wallet.';
	// End the message on somewhere to go: a player who is short on $THREE can act
	// on this, and /three-token is the platform's own one-click buy for it.
	if (/insufficient (lamports|funds)|debit an account|custom program error: 0x1\b/.test(m))
		return 'Not enough $THREE (or SOL for network fees) for this purchase. Get $THREE at three.ws/three-token, then try again.';
	if (/blockhash not found|block height exceeded|expired|too old/.test(m))
		return 'The quote expired, try again.';
	if (/failed to fetch|networkerror|timed out|timeout|fetch failed/.test(m))
		return "Couldn't reach the network. Check your connection and try again.";
	return raw.replace(/\s+/g, ' ').trim().slice(0, 140) || 'Purchase failed. Try again.';
}

// Did a 'boutique' notice report success? Modern servers stamp every notice
// with an explicit `ok` boolean; older deployed servers omit it, so fall back
// to the only success texts those servers ever send ("Unlocked …" and
// "Payment verified" grants). "Payment verified, but that item couldn't be
// unlocked" is the one failure sharing that prefix, so it's excluded.
function boutiqueNoticeOk(n) {
	if (n?.ok === true) return true;
	if (n?.ok === false) return false;
	const text = String(n?.text || '');
	if (/couldn.t be unlocked/i.test(text)) return false;
	return text.startsWith('Unlocked') || text.startsWith('Payment verified');
}

// Wait for the server's reply to a specific boutiqueQuote request. A quote-time
// rejection ("not in the boutique", "already own that", "boutique offline")
// arrives as a 'boutique' notice, never a boutiqueQuote reply, so it's raced
// here to surface the real reason instead of stalling into the timeout. Times
// out so a dropped connection can't hang the buy action forever.
function waitForQuote(net, id, timeoutMs = 15000) {
	return new Promise((resolve, reject) => {
		const cleanup = () => { clearTimeout(timer); offQuote(); offNotice(); };
		const timer = setTimeout(() => { cleanup(); reject(new Error('Timed out waiting for a price. Try again.')); }, timeoutMs);
		const offQuote = net.on('boutiqueQuote', (msg) => {
			if (msg?.id !== id) return;
			cleanup();
			resolve(msg);
		});
		const offNotice = net.on('notice', (n) => {
			if (n?.kind !== 'boutique' || boutiqueNoticeOk(n)) return;
			cleanup();
			reject(new Error(n.text || 'Could not price that purchase. Try again.'));
		});
	});
}

// Wait for the settle-outcome notice. A success resolves; a server-side
// rejection ("Payment didn't verify", "already settled", …) rejects with the
// server's own reason so the caller reports the failure honestly instead of
// painting a rejection green. A silence rejects with code 'timeout' so the
// caller can tell "the server said no" from "nobody answered".
function waitForSettleNotice(net, timeoutMs = 20000) {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			unsub();
			reject(Object.assign(new Error('Timed out confirming the purchase.'), { code: 'timeout' }));
		}, timeoutMs);
		const unsub = net.on('notice', (n) => {
			if (n?.kind !== 'boutique') return;
			clearTimeout(timer);
			unsub();
			if (boutiqueNoticeOk(n)) resolve(n);
			else reject(Object.assign(new Error(n.text || 'The purchase did not settle.'), { serverText: n.text || '' }));
		});
	});
}

// Resolve true as soon as the room socket is open again, false at the deadline.
function waitForOnline(net, timeoutMs) {
	if (net.isLive?.()) return Promise.resolve(true);
	return new Promise((resolve) => {
		const done = (v) => { clearTimeout(timer); off?.(); resolve(v); };
		const timer = setTimeout(() => done(false), Math.max(0, timeoutMs));
		const off = net.on('status', (s) => {
			const status = typeof s === 'string' ? s : s?.status;
			if (status === 'online' && (net.isLive ? net.isLive() : true)) done(true);
		});
	});
}

function unconfirmedError(sig) {
	const short = `${sig.slice(0, 6)}…${sig.slice(-6)}`;
	return Object.assign(
		new Error(`Your payment went through (tx ${short}) but the world could not confirm the unlock before the price quote expired. Reopen My Cosmetics in a minute; if it is still locked, contact support with that transaction.`),
		{ sig, code: 'unconfirmed' },
	);
}

/**
 * Hand a confirmed payment to the world and wait for the grant, surviving a
 * socket that drops mid-settle. The server accepts the same quote + signature
 * until the quote expires and its replay guard makes a resend safe, so: resend
 * whenever the first send never reached an open socket or its answer went to a
 * session that has since been replaced, and read "already settled" after a
 * resend as the earlier send having landed.
 * @param {object} net CommunityNet (on, boutiqueSettle -> boolean, isLive)
 * @param {string} quoteToken
 * @param {string} sig the confirmed transaction signature
 * @param {{ deadlineAt: number, noticeTimeoutMs?: number, onStage?: (s: string) => void }} opts
 */
export async function settleBoutique(net, quoteToken, sig, { deadlineAt, noticeTimeoutMs = 20000, onStage = () => {} }) {
	let resent = false;
	for (;;) {
		const remaining = deadlineAt - Date.now();
		if (remaining <= 0) throw unconfirmedError(sig);
		if (!net.boutiqueSettle(quoteToken, sig)) {
			onStage('reconnecting');
			if (!(await waitForOnline(net, remaining))) throw unconfirmedError(sig);
			resent = true;
			continue;
		}
		try {
			return await waitForSettleNotice(net, Math.min(noticeTimeoutMs, remaining));
		} catch (err) {
			if (resent && /already settled/i.test(err.serverText || '')) {
				return { ok: true, text: 'Payment verified. Your item is unlocked, check your wardrobe.' };
			}
			if (err.code !== 'timeout') throw err;
			resent = true;
		}
	}
}

/**
 * Buy one premium cosmetic with $THREE, end to end: connect wallet → server
 * quote (server-priced) → wallet signs → broadcast → server re-verifies the
 * confirmed transaction on-chain → grant. Never trusts the client's own
 * "it worked", the unlock only happens after `_handleBoutiqueSettle` on the
 * server confirms the transfer actually landed.
 * @param {{ net: object, item: { id: string, name: string, price?: number }, onStage?: (stage: string) => void }} opts
 * @returns {Promise<{ ok: true, sig: string, explorerUrl: string, text: string }>}
 */
export async function buyBoutiqueItem({ net, item, onStage = () => {} }) {
	if (!net || !item?.id) throw new Error('Nothing to buy.');
	const wallet = detectSolanaWallet();
	if (!wallet) {
		if (typeof window !== 'undefined') window.open('https://phantom.app/', '_blank', 'noopener');
		throw new Error('Install a Solana wallet (Phantom) to buy with $THREE.');
	}

	onStage('connecting');
	if (!wallet.publicKey) {
		try { await wallet.connect(); }
		catch (err) { throw new Error(friendlyBoutiqueError(err)); }
	}
	const address = wallet.publicKey?.toString?.();
	if (!address) throw new Error('Could not read your wallet address.');

	onStage('pricing');
	if (!net.boutiqueQuote(item.id, address)) throw new Error('Reconnecting to the world. Nothing was charged, try again in a moment.');
	const quote = await waitForQuote(net, item.id);
	// The server honours a settle for the life of the quote; that is the window
	// a dropped socket has to come back in.
	const quoteDeadline = Date.now() + (Number(quote?.quote?.ttlSeconds) || 90) * 1000 - 3000;
	if (!quote?.txBase64) throw new Error('Could not price that purchase, try again.');

	onStage('signing');
	const { Transaction, Connection } = await import('@solana/web3.js');
	const tx = Transaction.from(decodeBase64(quote.txBase64));
	let signed;
	try { signed = await wallet.signTransaction(tx); }
	catch (err) { throw new Error(friendlyBoutiqueError(err)); }

	onStage('broadcasting');
	const netId = boutiqueNetwork();
	const conn = new Connection(boutiqueRpcUrl(), 'confirmed');
	let sig;
	try {
		sig = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false, maxRetries: 3 });
	} catch (err) {
		throw new Error(friendlyBoutiqueError(err));
	}
	let confirmation = null;
	try {
		const latest = await conn.getLatestBlockhash('confirmed');
		confirmation = await conn.confirmTransaction({ signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight }, 'confirmed');
	} catch { /* landed but slow to confirm; settle re-checks the confirmed tx on RPC itself */ }
	// A confirmed-but-reverted transaction can never settle; fail fast with the
	// truth instead of sending the server a signature it will only reject.
	if (confirmation?.value?.err) throw new Error('Transaction failed on-chain.');

	onStage('settling');
	const notice = await settleBoutique(net, quote.quoteToken, sig, {
		// At least one full answer window even if the wallet took most of the TTL.
		deadlineAt: Math.max(quoteDeadline, Date.now() + 20000),
		onStage,
	});
	return { ok: true, sig, explorerUrl: solanaTxExplorerUrl(netId, sig), text: notice.text };
}
