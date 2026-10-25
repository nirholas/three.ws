// @ts-check
// Back-an-Agent Vaults — the dedicated, segregated custodial wallet + live NAV.
//
// Each vault owns its OWN Solana keypair, generated at open and stored
// AES-256-GCM-encrypted (api/_lib/secret-box.js, the same scheme protecting agent
// wallets). Backer capital lives in THIS wallet — never the agent's personal
// wallet, never another vault's — so a fork (a different agent → a different
// vault) can never co-mingle funds. The secret is decrypted only at signing time
// (vault-trade.js / vault-transfer.js) and every decrypt is audit-logged.

import { PublicKey, Keypair } from '@solana/web3.js';
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { encryptSecret, decryptSecret } from './secret-box.js';
import { solanaConnection } from './agent-pumpfun.js';
import { logAudit } from './audit.js';
import { markToUsdc, USDC_MINT_BY_NETWORK } from './vault-jupiter.js';
import { toBig } from './vault-accounting.js';

const SOL_FEE_HEADROOM_LAMPORTS = 3_000_000n; // ~0.003 SOL kept for fees/ATA rent

function net(network) {
	return network === 'devnet' ? 'devnet' : 'mainnet';
}

/** Generate a fresh vault wallet. Returns { address, encrypted_secret }. */
export async function generateVaultWallet() {
	const kp = Keypair.generate();
	const secretB64 = Buffer.from(kp.secretKey).toString('base64');
	const encrypted_secret = await encryptSecret(secretB64);
	return { address: kp.publicKey.toBase58(), encrypted_secret };
}

/**
 * Recover the vault keypair from its ciphertext, audit-logged. `audit` carries the
 * vault id + reason so every signing decrypt is traceable in the platform audit log
 * — mirroring recoverSolanaAgentKeypair's guarantee for agent wallets.
 */
export async function recoverVaultKeypair(encryptedSecret, audit = null) {
	const b64 = await decryptSecret(encryptedSecret);
	const secret = Buffer.from(b64, 'base64');
	const kp = Keypair.fromSecretKey(new Uint8Array(secret));
	if (audit?.vaultId) {
		logAudit({
			userId: audit.userId ?? null,
			action: 'vault.key_use',
			resourceId: audit.vaultId,
			meta: { reason: audit.reason || 'sign', address: kp.publicKey.toBase58(), ...(audit.meta || {}) },
		});
	}
	return kp;
}

/** Raw on-chain USDC balance of the vault wallet, in atomics (BigInt). 0 if no ATA. */
export async function readVaultUsdcAtomics(address, network = 'mainnet') {
	const n = net(network);
	const conn = solanaConnection(n);
	const owner = new PublicKey(address);
	const ata = getAssociatedTokenAddressSync(new PublicKey(USDC_MINT_BY_NETWORK[n]), owner, false, TOKEN_PROGRAM_ID);
	try {
		const bal = await conn.getTokenAccountBalance(ata);
		return BigInt(bal?.value?.amount ?? '0');
	} catch {
		return 0n; // no ATA yet → zero USDC
	}
}

/** Raw on-chain SOL balance of the vault wallet, in lamports (BigInt). */
export async function readVaultSolLamports(address, network = 'mainnet') {
	const conn = solanaConnection(net(network));
	try {
		return BigInt(await conn.getBalance(new PublicKey(address), 'confirmed'));
	} catch {
		return 0n;
	}
}

/** True when the vault holds enough SOL to cover a swap's fee + ATA rent buffer. */
export async function hasSolHeadroom(address, network = 'mainnet') {
	const lamports = await readVaultSolLamports(address, network);
	return lamports >= SOL_FEE_HEADROOM_LAMPORTS;
}

export { SOL_FEE_HEADROOM_LAMPORTS };

/**
 * Re-derive the vault's NAV from chain + a live mark of every open position.
 *   NAV = on-chain USDC balance + Σ (mark-to-market value of open token positions)
 *
 * `freeAtomics` is the liquid USDC available for instant redemption (the rest of
 * NAV is locked in positions). `priced` is false when one or more positions could
 * not be marked (Jupiter hiccup) — callers must NOT settle a redemption against an
 * unpriced NAV, and the breaker must not trip on a transient pricing gap.
 *
 * @param {object} vault         a vault row (id, vault_address, network)
 * @param {Array}  positions     open positions from vault-store.getOpenPositions
 * @returns {Promise<{ navAtomics:bigint, freeAtomics:bigint, usdcAtomics:bigint,
 *   positions:Array<{ mint:string, amount_raw:string, mark_atomics:string|null }>, priced:boolean }>}
 */
export async function computeVaultNav(vault, positions) {
	const network = net(vault.network);
	const usdcAtomics = await readVaultUsdcAtomics(vault.vault_address, network);
	let positionsValue = 0n;
	let priced = true;
	const marked = [];
	for (const p of positions) {
		const amountRaw = toBig(p.amount_raw);
		if (amountRaw <= 0n) {
			marked.push({ mint: p.mint, amount_raw: '0', mark_atomics: '0' });
			continue;
		}
		const mark = await markToUsdc({ network, mint: p.mint, amountRaw });
		if (mark == null) {
			priced = false;
			// Fall back to last known mark or cost so NAV is conservative, not zero.
			const fallback = p.last_mark_atomics != null ? toBig(p.last_mark_atomics) : toBig(p.cost_atomics);
			positionsValue += fallback;
			marked.push({ mint: p.mint, amount_raw: String(amountRaw), mark_atomics: null });
		} else {
			positionsValue += mark;
			marked.push({ mint: p.mint, amount_raw: String(amountRaw), mark_atomics: String(mark) });
		}
	}
	// The owner's unclaimed performance fee sits in the same USDC balance but is
	// not backer capital: leaving it in NAV let backers redeem it away.
	const accrued = toBig(vault.accrued_fee_atomics);
	const floorZero = (v) => (v > 0n ? v : 0n);
	return {
		navAtomics: floorZero(usdcAtomics + positionsValue - accrued),
		freeAtomics: floorZero(usdcAtomics - accrued),
		usdcAtomics,
		positions: marked,
		priced,
	};
}
