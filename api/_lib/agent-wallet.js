// Agent wallet generation and management.
// Generates a random Ethereum wallet per agent and encrypts the private key
// at rest using AES-256-GCM with the server JWT_SECRET as the key material.

import { webcrypto } from 'node:crypto';
import { env } from './env.js';

const subtle = globalThis.crypto?.subtle || webcrypto.subtle;
const randomBytes = (n) => {
	const b = new Uint8Array(n);
	(globalThis.crypto || webcrypto).getRandomValues(b);
	return b;
};

// ── Key derivation ──────────────────────────────────────────────────────────
// Derive a stable AES-256 key from JWT_SECRET for encrypting agent private keys.
async function deriveKey() {
	const raw = new TextEncoder().encode(env.JWT_SECRET);
	const base = await subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
	return subtle.deriveKey(
		{
			name: 'HKDF',
			hash: 'SHA-256',
			salt: new TextEncoder().encode('agent-wallet-v1'),
			info: new Uint8Array(0),
		},
		base,
		{ name: 'AES-GCM', length: 256 },
		false,
		['encrypt', 'decrypt'],
	);
}

// ── Encrypt / decrypt ───────────────────────────────────────────────────────

async function encrypt(plaintext) {
	const key = await deriveKey();
	const iv = randomBytes(12);
	const data = new TextEncoder().encode(plaintext);
	const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
	const buf = new Uint8Array(iv.length + ct.byteLength);
	buf.set(iv, 0);
	buf.set(new Uint8Array(ct), iv.length);
	return Buffer.from(buf).toString('base64');
}

async function decrypt(ciphertext) {
	const key = await deriveKey();
	const raw = Buffer.from(ciphertext, 'base64');
	const iv = raw.subarray(0, 12);
	const ct = raw.subarray(12);
	const plain = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
	return new TextDecoder().decode(plain);
}

// ── Wallet generation ───────────────────────────────────────────────────────

/**
 * Generate a new Ethereum wallet for an agent.
 * Returns { address, encrypted_key } where encrypted_key is the AES-GCM
 * encrypted private key (base64). Store encrypted_key in agent meta.
 */
export async function generateAgentWallet() {
	// Generate 32 random bytes for a private key
	const pk = randomBytes(32);
	const pkHex = '0x' + Array.from(pk, (b) => b.toString(16).padStart(2, '0')).join('');

	// Compute address from private key using ethers
	const { computeAddress } = await import('ethers');
	const address = computeAddress(pkHex);

	const encrypted_key = await encrypt(pkHex);
	return { address, encrypted_key };
}

/**
 * Recover an agent wallet's private key from its encrypted form.
 * Only call this when the agent needs to sign a transaction.
 */
export async function recoverAgentKey(encryptedKey) {
	return decrypt(encryptedKey);
}

// ── EVM on-chain balance + spend helpers ────────────────────────────────────

let _ethUsdPrice = null;
let _ethUsdPriceAt = 0;
const ETH_USD_CACHE_MS = 5 * 60_000;

async function fetchEthUsdPrice() {
	if (_ethUsdPrice && Date.now() - _ethUsdPriceAt < ETH_USD_CACHE_MS) return _ethUsdPrice;
	const r = await fetch(
		'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
	);
	if (!r.ok) throw new Error('coingecko ETH/USD fetch failed');
	const { ethereum } = await r.json();
	_ethUsdPrice = ethereum.usd;
	_ethUsdPriceAt = Date.now();
	return _ethUsdPrice;
}

/**
 * Query the live ETH balance of an agent's wallet_address on its registered chain.
 * @returns {{ address: string, chain_id: number, balance_wei: string, balance_eth: string }}
 */
export async function getAgentBalance(agentId) {
	const { sql } = await import('./db.js');
	const [agent] = await sql`
		select wallet_address, chain_id
		from agent_identities
		where id = ${agentId} and deleted_at is null
		limit 1
	`;
	if (!agent?.wallet_address) throw new Error('agent has no wallet_address');
	const chainId = agent.chain_id || 8453;

	const { env } = await import('./env.js');
	const rpcUrl = env.getRpcUrl(chainId);
	if (!rpcUrl) throw new Error(`no RPC URL for chain ${chainId}`);

	const { JsonRpcProvider, formatEther } = await import('ethers');
	const provider = new JsonRpcProvider(rpcUrl);
	const balanceBigInt = await provider.getBalance(agent.wallet_address);
	return {
		address: agent.wallet_address,
		chain_id: chainId,
		balance_wei: balanceBigInt.toString(),
		balance_eth: formatEther(balanceBigInt),
	};
}

/**
 * Returns true if the agent's EVM wallet can afford priceUsd (at current ETH/USD).
 */
export async function canAfford(agentId, priceUsd) {
	const { parseEther } = await import('ethers');
	const [bal, ethUsd] = await Promise.all([getAgentBalance(agentId), fetchEthUsdPrice()]);
	const priceEth = priceUsd / ethUsd;
	const priceWei = parseEther(priceEth.toFixed(18));
	return BigInt(bal.balance_wei) >= priceWei;
}

const SPEND_ABI = [
	'function spend(uint256 agentId, address payable recipient, uint256 amountWei, string calldata memo) external',
];

/**
 * Calls IdentityRegistry.spend() via the agent's delegated signer key.
 * @param {{ agentId: string, recipient: string, amountWei: bigint|string, memo: string, signer: import('ethers').Signer }} opts
 * @returns {Promise<string>} tx hash
 */
export async function delegatedSpend({ agentId, recipient, amountWei, memo, signer }) {
	const { sql } = await import('./db.js');
	const [agent] = await sql`
		select erc8004_agent_id, chain_id from agent_identities
		where id = ${agentId} and deleted_at is null
		limit 1
	`;
	if (!agent?.erc8004_agent_id) throw new Error('agent has no on-chain erc8004_agent_id');

	const chainId = agent.chain_id || 8453;
	const { CHAIN_BY_ID, IDENTITY_REGISTRY_MAINNET, IDENTITY_REGISTRY_TESTNET } = await import('./erc8004-chains.js');
	const chain = CHAIN_BY_ID[chainId];
	const registryAddress = chain?.testnet ? IDENTITY_REGISTRY_TESTNET : IDENTITY_REGISTRY_MAINNET;

	const { Contract } = await import('ethers');
	const registry = new Contract(registryAddress, SPEND_ABI, signer);
	const tx = await registry.spend(agent.erc8004_agent_id, recipient, amountWei, memo || '');
	return tx.hash;
}

/**
 * Fire-and-forget: charge an agent for a paid skill call.
 * Records in agent_payments; broadcasts on-chain via delegatedSpend if affordable.
 * Never throws — errors are logged and the payment row reflects the outcome.
 */
export async function triggerSkillPayment({ agentId, skillSlug, skillId }) {
	try {
		const { sql } = await import('./db.js');

		// Resolve skill price and author wallet
		const [skill] = await sql`
			select ms.id, ms.price_per_call_usd, ms.author_id,
			       uw.address as author_wallet
			from marketplace_skills ms
			left join user_wallets uw on uw.user_id = ms.author_id
			    and uw.chain_type = 'evm' and uw.is_primary = true
			where ms.slug = ${skillSlug}
			limit 1
		`;
		if (!skill || Number(skill.price_per_call_usd) <= 0) return;

		const priceUsd = Number(skill.price_per_call_usd);

		// Load agent to get chain + encrypted key
		const [agent] = await sql`
			select wallet_address, chain_id, erc8004_agent_id, meta
			from agent_identities
			where id = ${agentId} and deleted_at is null
			limit 1
		`;
		if (!agent) return;

		const chainId = agent.chain_id || 8453;
		const encryptedKey = agent.meta?.encrypted_wallet_key;
		if (!encryptedKey) return;

		// Convert USD → wei
		const ethUsd = await fetchEthUsdPrice();
		const priceEth = priceUsd / ethUsd;
		const { parseEther, Wallet, JsonRpcProvider } = await import('ethers');
		const amountWei = parseEther(priceEth.toFixed(18));

		const affordable = BigInt(
			(await getAgentBalance(agentId).catch(() => ({ balance_wei: '0' }))).balance_wei,
		) >= amountWei;

		if (!affordable) {
			await sql`
				insert into agent_payments
					(payer_agent_id, skill_id, amount_wei, chain_id, memo, status)
				values (
					${agentId}, ${skill.id ?? null}, ${amountWei.toString()},
					${chainId}, ${skillSlug}, 'failed'
				)
			`;
			console.warn(`[agent-payments] agent ${agentId} cannot afford skill ${skillSlug}`);
			return;
		}

		// Insert pending row first
		const [row] = await sql`
			insert into agent_payments
				(payer_agent_id, skill_id, amount_wei, chain_id, memo, status)
			values (
				${agentId}, ${skill.id ?? null}, ${amountWei.toString()},
				${chainId}, ${skillSlug}, 'pending'
			)
			returning id
		`;

		// Build signer + dispatch tx (fire-and-forget)
		(async () => {
			try {
				const { env } = await import('./env.js');
				const rpcUrl = env.getRpcUrl(chainId);
				if (!rpcUrl) throw new Error(`no RPC URL for chain ${chainId}`);
				const pkHex = await decrypt(encryptedKey);
				const provider = new JsonRpcProvider(rpcUrl);
				const signer = new Wallet(pkHex, provider);
				const recipient = skill.author_wallet || signer.address;
				const txHash = await delegatedSpend({
					agentId,
					recipient,
					amountWei,
					memo: skillSlug,
					signer,
				});
				await sql`
					update agent_payments set status = 'confirmed', tx_hash = ${txHash}
					where id = ${row.id}
				`;
			} catch (e) {
				await sql`
					update agent_payments set status = 'failed'
					where id = ${row.id}
				`.catch(() => {});
				console.error(`[agent-payments] tx failed for ${agentId}/${skillSlug}`, e?.message);
			}
		})();
	} catch (e) {
		console.error('[agent-payments] triggerSkillPayment error', e?.message);
	}
}

// ── Solana wallet ───────────────────────────────────────────────────────────

/**
 * Generate a new Solana keypair for an agent.
 * Returns { address, encrypted_secret } where encrypted_secret is the base64
 * AES-GCM ciphertext of the 64-byte secret key (also base64-encoded inside).
 */
export async function generateSolanaAgentWallet() {
	const { Keypair } = await import('@solana/web3.js');
	const kp = Keypair.generate();
	const secretB64 = Buffer.from(kp.secretKey).toString('base64');
	const encrypted_secret = await encrypt(secretB64);
	return { address: kp.publicKey.toBase58(), encrypted_secret };
}

/**
 * Recover a Solana Keypair from its encrypted form.
 * Only call this when the agent needs to sign a transaction.
 *
 * Audit hook: pass `audit: { agentId, userId, reason, meta }` and a
 * usage_events row will be written fire-and-forget so every decrypt
 * is traceable.
 */
export async function recoverSolanaAgentKeypair(encryptedSecret, audit = null) {
	const { Keypair } = await import('@solana/web3.js');
	const secretB64 = await decrypt(encryptedSecret);
	const kp = Keypair.fromSecretKey(Buffer.from(secretB64, 'base64'));
	if (audit && audit.agentId) {
		const { recordEvent } = await import('./usage.js');
		recordEvent({
			userId: audit.userId ?? null,
			agentId: audit.agentId,
			kind: 'solana_key_use',
			tool: audit.reason || 'sign',
			status: 'ok',
			meta: { address: kp.publicKey.toBase58(), ...(audit.meta || {}) },
		});
	}
	return kp;
}
