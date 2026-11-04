// @three-ws/skill-license — verify, read, and mint on-chain agent skill
// licenses. Thin client over the public, auth-free GET /api/skills/license-onchain
// read path and the authenticated POST /api/skills/mint write path — the
// platform endpoints do the Solana work (PDA derivation, RPC reads, minting),
// so this SDK stays zero-dependency and runs anywhere fetch does. See README.md.

import { createHttp, ThreeWsError } from './http.js';

export { ThreeWsError, PaymentRequiredError, DEFAULT_BASE_URL } from './http.js';

const NETWORKS = ['mainnet', 'devnet'];

/** The `skill_license` Anchor program id — identical on every cluster. */
export const PROGRAM_ID = '9rPHPFHmdek5WMH92HHtMuXsbeFBbvsetfbxuVZGsWoj';

/**
 * Create a skill-license client bound to a base URL, fetch, and optional auth.
 * For most callers the default `verifyLicense()` / `getLicense()` /
 * `mintLicense()` exports are enough; use this to reuse configuration (a
 * payment-aware fetch, a custom origin, a bearer apiKey) across many calls.
 *
 * @param {import('./index').SkillLicenseClientOptions} [options]
 */
export function createSkillLicense(options = {}) {
	const request = createHttp(options);

	/**
	 * Read the full on-chain license record for a holder+agent+skill triple.
	 * Returns `null` when no license exists at the derived PDA (never purchased),
	 * else a shaped `LicenseRecord`. Wraps GET /api/skills/license-onchain — a
	 * public, auth-free read of chain state.
	 */
	async function getLicense(input, opts = {}) {
		const query = licenseQuery(input, opts);
		const res = await request('/api/skills/license-onchain', { query, signal: opts.signal });
		const data = res?.data;
		if (!data) {
			throw new ThreeWsError('Unexpected empty response from /api/skills/license-onchain.', { code: 'bad_response' });
		}
		// No PDA on-chain ⇒ never purchased. Surface as null per the README contract.
		if (!data.exists) return null;
		return shapeLicense(data);
	}

	/**
	 * The headline check: does `holder` own an active (non-revoked) license for
	 * `skill` on `agent`? Resolves to a plain boolean. A missing license, an
	 * undeployed program, or a revoked license all read as `false` — never a throw
	 * for the "not owned" case. Only a transport/RPC failure rejects.
	 */
	async function verifyLicense(input, opts = {}) {
		const query = licenseQuery(input, opts);
		const res = await request('/api/skills/license-onchain', { query, signal: opts.signal });
		return Boolean(res?.data?.owned);
	}

	/**
	 * Server-side. Mint the on-chain license to `buyer` after their purchase is
	 * confirmed. Wraps POST /api/skills/mint, which verifies the payment reached
	 * the agent's payout wallet before minting — a caller can never mint a free
	 * license. Idempotent: a second call returns the existing mint with
	 * `alreadyMinted: true`.
	 *
	 * @param {import('./index').MintLicenseInput} input
	 */
	async function mintLicense(input = {}, opts = {}) {
		const agentId = req(input.agentId, 'agentId');
		const skill = req(input.skill, 'skill');
		const buyer = req(input.buyer, 'buyer');
		if (skill.length > 100) {
			throw new ThreeWsError('skill must be ≤100 characters.', { code: 'invalid_input' });
		}

		// Per-call apiKey/headers override the client defaults for this request only.
		const headers = { ...(input.headers || {}) };
		if (input.apiKey) headers.authorization = `Bearer ${input.apiKey}`;

		const body = prune({
			agent_id: agentId,
			skill_name: skill,
			user_wallet: buyer,
			transaction_signature: input.txSignature,
		});

		const res = await request('/api/skills/mint', {
			method: 'POST',
			body,
			headers,
			signal: opts.signal,
		});
		return shapeMint(res?.data ?? res);
	}

	return { verifyLicense, getLicense, mintLicense };
}

// Module-level default client for the zero-config path: `import { verifyLicense }`.
let shared = null;
function defaultClient() {
	return (shared ||= createSkillLicense());
}

/** Does `holder` own an active license for `skill` on `agent`? → boolean. */
export function verifyLicense(input, opts) {
	return defaultClient().verifyLicense(input, opts);
}
/** Read the full on-chain license record (or `null` if none exists). */
export function getLicense(input, opts) {
	return defaultClient().getLicense(input, opts);
}
/** Server-side: mint the on-chain license to a buyer after a confirmed purchase. */
export function mintLicense(input, opts) {
	return defaultClient().mintLicense(input, opts);
}

/**
 * sha256(skillName) as a 32-byte hex string — the fixed-length third PDA seed.
 * Matches the Rust `skill_seed()` (Solana `hash::hash` is sha256), so client and
 * program derive identical addresses. Pure and zero-dep via Web Crypto; async
 * because `crypto.subtle.digest` is. The platform endpoint derives full PDAs
 * server-side and returns them on every `getLicense` record, so this is the one
 * derivation that's trivially reproducible client-side without a curve library.
 */
export async function skillSeed(skillName) {
	if (typeof skillName !== 'string' || !skillName) {
		throw new ThreeWsError('skillSeed() needs a non-empty skill name string.', { code: 'invalid_input' });
	}
	const subtle = globalThis.crypto?.subtle;
	if (!subtle) {
		throw new ThreeWsError('Web Crypto (crypto.subtle) is unavailable — run on Node 18+ or a modern browser.', { code: 'no_crypto' });
	}
	const bytes = new TextEncoder().encode(skillName);
	const digest = await subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- internal helpers ------------------------------------------------------

// Build the license-onchain query: holder+skill plus agent_mint OR agent_id.
function licenseQuery(input, opts) {
	const i = input && typeof input === 'object' ? input : {};
	const holder = req(i.holder, 'holder');
	const skill = req(i.skill, 'skill');
	if (skill.length > 100) {
		throw new ThreeWsError('skill must be ≤100 characters.', { code: 'invalid_input' });
	}
	if (!i.agent && !i.agentId) {
		throw new ThreeWsError('Pass either `agent` (skill-collection mint) or `agentId` (three.ws uuid).', { code: 'invalid_input' });
	}
	const network = normalizeEnum(i.network ?? opts.network, NETWORKS, 'network');
	return prune({
		wallet: holder,
		skill,
		agent_mint: i.agent,
		agent_id: i.agent ? undefined : i.agentId,
		network,
	});
}

// Shape the verify endpoint's `data` envelope → camelCase LicenseRecord.
function shapeLicense(data) {
	const record = data.record || {};
	return {
		owned: Boolean(data.owned),
		exists: Boolean(data.exists),
		revoked: Boolean(data.revoked),
		deployed: Boolean(data.deployed),
		authority: record.authority ?? null,
		agentMint: record.agentMint ?? data.agent_mint ?? null,
		nftMint: data.nft_mint ?? record.nftMint ?? null,
		ownerTokenAccount: data.owner_token_account ?? null,
		skillName: record.skillName ?? data.skill ?? null,
		skillHash: record.skillHash ?? null,
		purchaseDate: record.purchaseDate ?? null,
		revokedAt: record.revokedAt ?? 0,
		license: data.license ?? null,
		programId: data.program_id ?? PROGRAM_ID,
		network: data.network ?? null,
		explorer: data.explorer ?? null,
		raw: data,
	};
}

// Shape the mint endpoint's `data` envelope → camelCase MintResult.
function shapeMint(data) {
	if (!data || typeof data !== 'object') {
		throw new ThreeWsError('Unexpected empty response from /api/skills/mint.', { code: 'bad_response' });
	}
	return {
		nftMint: data.nftMint ?? null,
		signature: data.signature ?? null,
		collection: data.collection ?? null,
		network: data.network ?? null,
		explorer: data.explorer ?? null,
		skill: data.skill ?? null,
		agentId: data.agent_id ?? null,
		purchaseId: data.purchase_id ?? null,
		alreadyMinted: data.already_minted === true,
		raw: data,
	};
}

function req(value, label) {
	if (typeof value !== 'string' || !value.trim()) {
		throw new ThreeWsError(`${label} is required.`, { code: 'invalid_input' });
	}
	return value.trim();
}

function normalizeEnum(value, allowed, label) {
	if (value === undefined || value === null) return undefined;
	if (!allowed.includes(value)) {
		throw new ThreeWsError(`Invalid ${label} "${value}". Expected one of: ${allowed.join(', ')}.`, { code: 'invalid_input' });
	}
	return value;
}

function prune(obj) {
	const out = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v === undefined || v === null) continue;
		out[k] = v;
	}
	return out;
}
