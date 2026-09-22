// @ts-check
// api/_lib/x402/ring-allowlist.js
//
// The controlled-wallet universe + the ring spend invariants — the two halves
// of the leak-proofing guarantee: **no SOL or USDC ever leaves the set of
// wallets three.ws controls.**
//
// ── ringAllowedAddresses() vs payToAllowlist() ────────────────────────────────
// These are DIFFERENT sets on purpose; do not merge them.
//
//   payToAllowlist() (self-facilitator.js) is the RECEIVING set: the handful of
//   recipients the facilitator will settle USDC *to*. Receiving is stricter
//   than membership — a wallet can be platform-controlled (so money moving to
//   it is not a leak) without being a settlement recipient. Keep it narrow.
//
//   ringAllowedAddresses() (this module) is the MEMBERSHIP set: every address
//   the platform controls. It is the reference the on-chain leak scanner
//   (api/cron/x402-ring-leak-scan.js) classifies counterparties against — a
//   debit whose counterparty is outside this set is a LEAK. It is a superset
//   of payToAllowlist(): the three ring role wallets, the x402_ring_wallets
//   registry, every SOLANA_SIGNERS platform signer, explicit extras from
//   X402_SELF_FACILITATOR_PAYTO_ALLOWLIST, plus the USDC ATAs of all of the
//   above (SPL credits land on the token account, not the owner).
//
// ── Ring spend invariants ─────────────────────────────────────────────────────
// The closed loop is only closed while three env guards hold. They used to be
// passive (a flipped or forgotten flag silently re-opened external spending);
// checkRingInvariants() makes them ACTIVE: every spend entry point calls
// assertRingSpendInvariants() before moving money and no-ops (fails CLOSED)
// with one throttled CRITICAL alert if any guard is off:
//
//   1. X402_EXTERNAL_ENABLED       must be exactly 'false'  (unset = violation)
//   2. X402_CHARITY_AUDIT_BPS      must parse to exactly 0  (unset = violation)
//   3. facilitator must resolve to SELF — X402_SELF_FACILITATOR_ENABLED='true'
//      and X402_FACILITATOR_URL_SOLANA pointing at our own
//      /api/x402-facilitator (an external facilitator URL = violation)
//
// Call sites: api/cron/x402-autonomous-loop.js entry, and the ring tick
// (api/cron/x402-ring-tick.js) once it lands — one line:
//   const inv = await assertRingSpendInvariants({ context: 'x402-ring-tick' });
//   if (!inv.ok) return json(res, 200, { ok: false, skipped: true, reason: 'ring_invariant_violation', violations: inv.violations.map(v => v.flag) });

import { env } from '../env.js';
import { SOLANA_SIGNERS, resolveSignerPubkey, decodeSecretKey } from '../solana-signers.js';
import { sendOpsAlert } from '../alerts.js';
import { resolveSolanaFacilitator, selfFacilitatorEnabled } from './ring-config.js';
import { freshWorkersConfig } from './fresh-workers/plan.js';

// ── Controlled-wallet set ─────────────────────────────────────────────────────

/**
 * The three ring role wallets from env. Payer is derived from its secret (it
 * has no public env var); treasury and sponsor are advertised pubkeys.
 * @returns {Promise<{ payer: string|null, treasury: string|null, sponsor: string|null }>}
 */
export async function ringRoleWallets() {
	let payer = null;
	const payerSecret =
		process.env.X402_SEED_SOLANA_SECRET_BASE58 ||
		process.env.X402_AGENT_SOLANA_SECRET_BASE58 ||
		'';
	if (payerSecret) {
		try {
			const bytes = await decodeSecretKey(payerSecret);
			if (bytes) {
				const { Keypair } = await import('@solana/web3.js');
				payer = Keypair.fromSecretKey(bytes).publicKey.toBase58();
			}
		} catch { /* undecodable secret → payer unresolved; scanner still covers the rest */ }
	}
	return {
		payer,
		treasury: env.X402_PAY_TO_SOLANA || null,
		sponsor: env.X402_FEE_PAYER_SOLANA || null,
	};
}

/**
 * USDC ATA for an owner, or null when the owner string is not a real pubkey
 * (synthetic test addresses, malformed env). Never throws.
 * @param {string} owner
 * @returns {Promise<string|null>}
 */
async function usdcAtaOf(owner) {
	try {
		const [{ PublicKey }, { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID }] =
			await Promise.all([import('@solana/web3.js'), import('@solana/spl-token')]);
		const mint = new PublicKey(env.X402_ASSET_MINT_SOLANA);
		return getAssociatedTokenAddressSync(
			mint, new PublicKey(owner), true, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
		).toBase58();
	} catch {
		return null;
	}
}

/**
 * Every address the platform controls: ring role wallets, the
 * x402_ring_wallets registry, all SOLANA_SIGNERS pubkeys, explicit extras from
 * X402_SELF_FACILITATOR_PAYTO_ALLOWLIST, and the USDC ATAs of all of them.
 *
 * Degrades safely: an unreachable DB or an unconfigured signer SHRINKS the set
 * (more leak alerts — false-positive-leaning), never widens it.
 *
 * @param {{ sql?: Function }} [deps] inject the sql tag (tests); defaults to _lib/db.js
 * @returns {Promise<Set<string>>}
 */
export async function ringAllowedAddresses(deps = {}) {
	const owners = new Set();

	const roles = await ringRoleWallets();
	for (const pk of Object.values(roles)) if (pk) owners.add(pk);

	// x402_ring_wallets registry (task 03 provisioning writes it).
	const knownAtas = new Set();
	try {
		const sql = deps.sql || (await import('../db.js')).sql;
		const rows = await sql`SELECT pubkey FROM x402_ring_wallets WHERE enabled = true`;
		for (const r of rows) if (r?.pubkey) owners.add(r.pubkey);
		// Fresh worker wallets (fresh-workers/): each one is funded by the master,
		// pays once, and is emptied within minutes, so it never joins the registry.
		// It still has to be a member for the window in which the leak scanner can
		// meet its funding leg, or the master's transfer to it reads as a LEAK. The
		// row already carries the wallet's USDC ATA, so nothing is re-derived here.
		const hours = freshWorkersConfig().membershipWindowHours;
		const fresh = await sql`
			SELECT pubkey, usdc_ata FROM x402_fresh_wallets
			WHERE created_at > now() - make_interval(hours => ${hours})`;
		for (const r of fresh) {
			if (r?.pubkey) owners.add(r.pubkey);
			if (r?.usdc_ata) knownAtas.add(r.usdc_ata);
		}
	} catch { /* no DB / table absent → env-derived set stands */ }

	// Every platform fee-paying signer is a controlled wallet.
	for (const spec of SOLANA_SIGNERS) {
		try {
			const { pubkey } = await resolveSignerPubkey(spec);
			if (pubkey) owners.add(pubkey);
		} catch { /* unconfigured signer → skip */ }
	}

	for (const extra of String(process.env.X402_SELF_FACILITATOR_PAYTO_ALLOWLIST || '')
		.split(',').map((s) => s.trim()).filter(Boolean)) {
		owners.add(extra);
	}

	// SPL transfers credit the token account, not the owner — include each
	// owner's USDC ATA so raw-account counterparties classify as internal.
	const out = new Set(owners);
	for (const owner of owners) {
		const ata = await usdcAtaOf(owner);
		if (ata) out.add(ata);
	}
	for (const ata of knownAtas) out.add(ata);
	return out;
}

// ── Spend invariants ──────────────────────────────────────────────────────────

/**
 * True when Solana settlement resolves to our own self-hosted facilitator.
 * Delegates to task 02's resolveSolanaFacilitator() so there is ONE routing
 * truth — an external explicit URL, a disabled self-facilitator, or the PayAI
 * default all resolve to self:false here.
 */
export function facilitatorResolvesToSelf() {
	return resolveSolanaFacilitator().self;
}

/**
 * Check the three guards that keep the loop closed. Pure read of env — no I/O,
 * no side effects. Missing/unset values are violations: the ring fails CLOSED.
 * @returns {{ ok: boolean, violations: Array<{ flag: string, expected: string, actual: string }> }}
 */
export function checkRingInvariants() {
	const violations = [];

	const external = process.env.X402_EXTERNAL_ENABLED;
	if (external !== 'false') {
		violations.push({
			flag: 'X402_EXTERNAL_ENABLED',
			expected: "'false' (external spending disabled)",
			actual: external === undefined ? '<unset>' : String(external),
		});
	}

	const bpsRaw = process.env.X402_CHARITY_AUDIT_BPS;
	if (Number(bpsRaw) !== 0 || String(bpsRaw ?? '').trim() === '') {
		violations.push({
			flag: 'X402_CHARITY_AUDIT_BPS',
			expected: '0 (no split leaves the ring)',
			actual: bpsRaw === undefined ? '<unset>' : String(bpsRaw),
		});
	}

	const selfFacEnabled = selfFacilitatorEnabled();
	const route = resolveSolanaFacilitator();
	if (!selfFacEnabled || !route.self) {
		violations.push({
			flag: 'X402_FACILITATOR_URL_SOLANA / X402_SELF_FACILITATOR_ENABLED',
			expected: 'self-hosted facilitator (our /api/x402-facilitator, enabled)',
			actual: `enabled=${selfFacEnabled} url=${route.url}`,
		});
	}

	return { ok: violations.length === 0, violations };
}

/**
 * The active guard every spend entry point calls before moving money. On any
 * violation it logs, fires ONE throttled CRITICAL ops alert naming the flipped
 * flag(s) (sendOpsAlert dedups per signature per hour), and returns ok:false —
 * the caller must no-op its spend path. Never throws: a broken alert channel
 * must not turn a fail-closed guard into a crash loop.
 * @param {{ context?: string }} [opts] the entry point name, for the alert/log
 * @returns {Promise<{ ok: boolean, violations: Array<{ flag: string, expected: string, actual: string }> }>}
 */
export async function assertRingSpendInvariants({ context = 'unknown' } = {}) {
	const result = checkRingInvariants();
	if (result.ok) return result;

	const flags = result.violations.map((v) => v.flag);
	const lines = result.violations
		.map((v) => `• ${v.flag} = ${v.actual} (expected ${v.expected})`)
		.join('\n');
	console.error(
		`[ring-invariants] SPEND PATH DISABLED in ${context} — guard env violated:\n${lines}`,
	);
	try {
		await sendOpsAlert(
			'🚨 x402 ring invariant violated — spend path disabled',
			`${context} refused to spend: the closed-loop guard env is off.\n${lines}\nThe ring fails CLOSED until the flag is restored. If you did not change this env, treat it as tampering and audit Vercel env history.`,
			{ signature: `ring-invariant:${flags.sort().join('|')}` },
		);
	} catch { /* alert failure never blocks the fail-closed decision */ }
	return result;
}
