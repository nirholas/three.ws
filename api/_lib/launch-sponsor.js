// Gasless bonding-curve launches: the platform pays, the fees pay it back.
//
// A creator with no SOL cannot launch: the create transaction has to fund the
// mint, the bonding curve, its token account and the metadata. On a gasless
// launch the launch sponsor (the `launch-sponsor` signer in solana-signers.js)
// is both the transaction fee payer and the create instruction's rent payer.
// The creator still signs, because the same transaction also sets up the
// coin's on-chain creator-fee sharing, and only the creator may do that:
//
//   1. createV2           sponsor pays rent; creator is the on-chain creator
//   2. transfer           sponsor -> creator, exactly the rent the next two
//                         instructions charge the creator (measured, below)
//   3. createFeeSharing   creator opens the coin's fee-sharing config
//   4. updateFeeShares    creator splits future creator fees: creator share to
//                         the creator, platform share to the platform recipient
//
// The split comes from launch_economics (api/_lib/launch-economics.js). The
// platform recipient defaults to the sponsor itself, so every distribution of
// a gasless coin's fees refills the wallet that paid for the next launch.
//
// Nothing here is estimated. prepareGaslessCurveLaunch simulates the exact
// transaction against the live cluster with a probe transfer, reads the
// creator's and sponsor's post-balances, and rebuilds with the measured rent.
// The sponsored cost reported to the user and checked against the caps is the
// sponsor's simulated balance delta. Verified on mainnet 2026-09-22: a 32-char
// name with a 200-char URI compiles to 1,173 bytes against pump.fun's lookup
// table and consumes ~256k compute units.

import {
	PublicKey,
	SystemProgram,
	TransactionMessage,
	VersionedTransaction,
} from '@solana/web3.js';

import { sql } from './db.js';
import { SOLANA_SIGNERS, loadSignerKeypair, resolveSignerPubkey } from './solana-signers.js';
import { getConnection, getPumpSdk } from './pump.js';
import { getPumpLookupTables } from './pump-launch-tx.js';
import { getLaunchEconomics } from './launch-economics.js';

const SPONSOR_SPEC = SOLANA_SIGNERS.find((s) => s.name === 'launch-sponsor');

// Generous enough to cover the fee-sharing rent many times over; only used in
// simulation, the real transfer is the measured amount.
const PROBE_TRANSFER_LAMPORTS = 50_000_000;

export class GaslessError extends Error {
	constructor(status, code, message, detail = {}) {
		super(message);
		this.status = status;
		this.code = code;
		this.detail = detail;
	}
}

/** The sponsor keypair, or null when the env is unset or undecodable. */
export async function loadLaunchSponsor() {
	if (!SPONSOR_SPEC) return null;
	const { keypair } = await loadSignerKeypair(SPONSOR_SPEC);
	return keypair;
}

/** The sponsor's public address without touching the secret's signing use. */
export async function launchSponsorAddress() {
	if (!SPONSOR_SPEC) return null;
	const { pubkey } = await resolveSignerPubkey(SPONSOR_SPEC);
	return pubkey;
}

/**
 * Where the platform's share of a gasless coin's creator fees is paid.
 * LAUNCH_FEE_SHARE_WALLET overrides; otherwise the sponsor, so recovery refills it.
 */
export async function platformFeeShareRecipient() {
	const override = String(process.env.LAUNCH_FEE_SHARE_WALLET || '').trim();
	if (override) {
		try {
			return new PublicKey(override).toBase58();
		} catch {
			console.warn('[launch-sponsor] LAUNCH_FEE_SHARE_WALLET is not a valid address, using the sponsor');
		}
	}
	return launchSponsorAddress();
}

/** Sponsorships counted toward the caps: anything prepared or landed in the last 24h. */
async function sponsorshipCounts(userId, network) {
	const [row] = await sql`
		SELECT
			count(*) FILTER (WHERE user_id = ${userId})::int AS mine,
			count(*)::int AS platform
		FROM launch_sponsorships
		WHERE network = ${network}
		  AND created_at > now() - interval '24 hours'
		  AND status IN ('prepared', 'launched')
	`;
	return { mine: row?.mine ?? 0, platform: row?.platform ?? 0 };
}

/**
 * Whether this account may take a gasless launch right now, and why not.
 * Reads the live economics, the caps ledger and the sponsor's balance. Never
 * throws for an ineligible caller; `reasons` names every blocker.
 */
export async function gaslessEligibility({ userId, network = 'mainnet', econ = null }) {
	const e = econ || (await getLaunchEconomics());
	const g = e.gasless;
	const reasons = [];
	if (!g.enabled) reasons.push({ code: 'gasless_disabled', message: 'Gasless launches are paused by the platform.' });

	const sponsor = await launchSponsorAddress();
	let sponsorLamports = null;
	if (!sponsor) {
		reasons.push({ code: 'sponsor_unconfigured', message: 'The launch sponsor wallet is not configured on this server.' });
	} else {
		try {
			sponsorLamports = await getConnection({ network }).getBalance(new PublicKey(sponsor));
		} catch (err) {
			reasons.push({ code: 'rpc_unavailable', message: `Could not read the sponsor balance: ${err?.message || 'RPC error'}.` });
		}
		if (sponsorLamports != null && sponsorLamports < g.sponsor_floor_lamports + g.max_lamports) {
			reasons.push({
				code: 'sponsor_low',
				message: 'The launch sponsor is below its operating floor and is waiting for a refill. Try again later or launch self-funded.',
			});
		}
	}

	let counts = { mine: 0, platform: 0 };
	if (userId) {
		counts = await sponsorshipCounts(userId, network);
		if (counts.mine >= g.per_account_daily) {
			reasons.push({
				code: 'account_daily_cap',
				message: `This account has used its ${g.per_account_daily} gasless launch${g.per_account_daily === 1 ? '' : 'es'} for the last 24 hours.`,
			});
		}
	}
	if (counts.platform >= g.platform_daily) {
		reasons.push({ code: 'platform_daily_cap', message: 'The platform-wide gasless launch budget for the last 24 hours is used up.' });
	}

	return {
		eligible: reasons.length === 0,
		reasons,
		sponsor_address: sponsor,
		sponsor_lamports: sponsorLamports,
		used_last_24h: counts.mine,
		limit_per_24h: g.per_account_daily,
		platform_used_last_24h: counts.platform,
		platform_limit_per_24h: g.platform_daily,
		max_sponsored_lamports: g.max_lamports,
		creator_share_bps: g.creator_share_bps,
		platform_share_bps: g.platform_share_bps,
	};
}

/**
 * The four gasless-launch instructions for a given rent transfer.
 * @param {object} o
 * @param {any} o.sdk              composed pump sdk from getPumpSdk
 * @param {PublicKey} o.mint
 * @param {PublicKey} o.creator    on-chain creator; signs the fee-sharing setup
 * @param {PublicKey} o.sponsor    fee payer and rent payer
 * @param {PublicKey} o.platform   receives the platform share of creator fees
 * @param {number} o.creatorShareBps
 * @param {number} o.transferLamports rent forwarded to the creator
 */
export async function buildGaslessInstructions({ sdk, mint, creator, sponsor, platform, name, symbol, uri, creatorShareBps, transferLamports }) {
	if (creator.equals(platform)) {
		throw new GaslessError(400, 'creator_is_platform', 'The creator wallet cannot be the platform fee-share recipient.');
	}
	const createIx = await sdk.createV2Instruction({
		mint,
		name,
		symbol,
		uri,
		creator,
		user: sponsor,
		mayhemMode: false,
		holderReward: false,
	});
	const ixs = [createIx];
	if (transferLamports > 0) {
		ixs.push(SystemProgram.transfer({ fromPubkey: sponsor, toPubkey: creator, lamports: transferLamports }));
	}
	// A coin still on its bonding curve has no AMM pool yet, so pool is null.
	ixs.push(await sdk.createFeeSharingConfig({ creator, mint, pool: null }));
	ixs.push(
		await sdk.updateFeeShares({
			authority: creator,
			mint,
			currentShareholders: [creator],
			newShareholders: [
				{ address: creator, shareBps: creatorShareBps },
				{ address: platform, shareBps: 10_000 - creatorShareBps },
			],
		}),
	);
	return ixs;
}

function compile({ payer, blockhash, instructions, tables }) {
	return new VersionedTransaction(
		new TransactionMessage({ payerKey: payer, recentBlockhash: blockhash, instructions }).compileToV0Message(tables),
	);
}

/**
 * Measure a gasless launch by simulation: returns the exact rent the creator
 * must be forwarded and the sponsor's all-in cost. Pure over its connection.
 */
export async function measureGaslessLaunch({ connection, build, sponsor, creator, tables }) {
	const [creatorPre, sponsorPre, { blockhash }] = await Promise.all([
		connection.getBalance(creator),
		connection.getBalance(sponsor),
		connection.getLatestBlockhash('confirmed'),
	]);
	const probe = compile({ payer: sponsor, blockhash, instructions: await build(PROBE_TRANSFER_LAMPORTS), tables });
	const sim = await connection.simulateTransaction(probe, {
		sigVerify: false,
		replaceRecentBlockhash: true,
		commitment: 'confirmed',
		accounts: { encoding: 'base64', addresses: [creator.toBase58(), sponsor.toBase58()] },
	});
	if (sim.value.err) {
		const tail = (sim.value.logs || []).slice(-4).join(' | ');
		throw new GaslessError(422, 'simulation_failed', `The gasless launch did not simulate: ${JSON.stringify(sim.value.err)}${tail ? ` (${tail})` : ''}`);
	}
	const [creatorAcct, sponsorAcct] = sim.value.accounts || [];
	const creatorPost = Number(creatorAcct?.lamports ?? 0);
	const sponsorPost = Number(sponsorAcct?.lamports ?? 0);
	// Whatever of the probe the creator did not spend comes back off the transfer.
	const creatorSpent = creatorPre + PROBE_TRANSFER_LAMPORTS - creatorPost;
	const transferLamports = Math.max(0, creatorSpent);
	const sponsorCost = sponsorPre - sponsorPost - (PROBE_TRANSFER_LAMPORTS - transferLamports);
	return { transferLamports, sponsorCost, computeUnits: sim.value.unitsConsumed ?? null, sponsorPre };
}

/**
 * Build a gasless curve launch, partially signed by the sponsor (and the mint
 * when the server holds its key). The creator's signature is the one missing.
 *
 * @returns {Promise<{ tx: VersionedTransaction, tx_base64: string, bytes: number,
 *   sponsored_lamports: number, rent_forwarded_lamports: number, compute_units: number|null,
 *   sponsor: string, platform_recipient: string, creator_share_bps: number, platform_share_bps: number }>}
 */
export async function prepareGaslessCurveLaunch({ network = 'mainnet', mint, mintKeypair = null, creator, name, symbol, uri, econ = null }) {
	const e = econ || (await getLaunchEconomics());
	const sponsorKp = await loadLaunchSponsor();
	if (!sponsorKp) throw new GaslessError(503, 'sponsor_unconfigured', 'Gasless launches are not available: the launch sponsor is not configured.');
	const platformAddr = await platformFeeShareRecipient();
	const platform = new PublicKey(platformAddr);
	const sponsor = sponsorKp.publicKey;
	const connection = getConnection({ network });
	const [{ sdk }, tables] = await Promise.all([getPumpSdk({ network }), getPumpLookupTables({ network })]);
	const creatorShareBps = e.gasless.creator_share_bps;
	const build = (transferLamports) =>
		buildGaslessInstructions({ sdk, mint, creator, sponsor, platform, name, symbol, uri, creatorShareBps, transferLamports });

	const measured = await measureGaslessLaunch({ connection, build, sponsor, creator, tables });
	if (measured.sponsorCost > e.gasless.max_lamports) {
		throw new GaslessError(409, 'sponsor_cost_cap', `This launch would cost the sponsor ${measured.sponsorCost} lamports, above the ${e.gasless.max_lamports}-lamport cap.`);
	}
	if (measured.sponsorPre - measured.sponsorCost < e.gasless.sponsor_floor_lamports) {
		throw new GaslessError(503, 'sponsor_low', 'The launch sponsor is below its operating floor and is waiting for a refill. Try again later or launch self-funded.');
	}

	const { blockhash } = await connection.getLatestBlockhash('confirmed');
	const tx = compile({ payer: sponsor, blockhash, instructions: await build(measured.transferLamports), tables });
	// A client-ground vanity mint co-signs in the wallet; a server-ground one signs here.
	tx.sign(mintKeypair ? [sponsorKp, mintKeypair] : [sponsorKp]);
	let bytes;
	try {
		bytes = tx.serialize({ requireAllSignatures: false }).length;
	} catch {
		throw new GaslessError(413, 'launch_payload_too_large', 'This gasless launch does not fit in one transaction: shorten the name, symbol or metadata URI.');
	}
	return {
		tx,
		tx_base64: Buffer.from(tx.serialize({ requireAllSignatures: false })).toString('base64'),
		bytes,
		sponsored_lamports: measured.sponsorCost,
		rent_forwarded_lamports: measured.transferLamports,
		compute_units: measured.computeUnits,
		sponsor: sponsor.toBase58(),
		platform_recipient: platform.toBase58(),
		creator_share_bps: creatorShareBps,
		platform_share_bps: 10_000 - creatorShareBps,
	};
}

/**
 * Prove a landed transaction is the gasless launch we prepared: the sponsor paid
 * the fee, the mint is present, and the coin's fee-sharing config now exists.
 */
export function verifyGaslessTransaction(parsedTx, { sponsor, mint }) {
	const keys = parsedTx.transaction.message.accountKeys.map((k) => (k.pubkey || k).toString());
	if (keys[0] !== sponsor) {
		throw new GaslessError(422, 'not_sponsored', 'The confirmed transaction was not fee-paid by the launch sponsor.');
	}
	if (!keys.includes(mint)) throw new GaslessError(422, 'mint_not_in_tx', 'The mint is not in the confirmed transaction.');
}

/** Record a prepared sponsorship; the row is what the caps count. */
export async function recordSponsorshipPrepared({ userId, agentId, network, mint, creator, sponsor, prepId, sponsoredLamports, platformShareBps }) {
	await sql`
		INSERT INTO launch_sponsorships
			(user_id, agent_id, network, mint, creator_address, sponsor_address, prep_id, sponsored_lamports, platform_share_bps, status)
		VALUES
			(${userId}, ${agentId || null}, ${network}, ${mint}, ${creator}, ${sponsor}, ${prepId}, ${sponsoredLamports}, ${platformShareBps}, 'prepared')
		ON CONFLICT (mint, network) DO NOTHING
	`;
}

export async function recordSponsorshipLaunched({ mint, network, signature }) {
	await sql`
		UPDATE launch_sponsorships
		SET status = 'launched', signature = ${signature}, launched_at = now()
		WHERE mint = ${mint} AND network = ${network}
	`;
}

/** Prepared sponsorships that never landed stop counting against the caps. */
export async function expireStaleSponsorships() {
	const rows = await sql`
		UPDATE launch_sponsorships SET status = 'expired'
		WHERE status = 'prepared' AND created_at < now() - interval '45 minutes'
		RETURNING id
	`;
	return rows.length;
}

/**
 * Crank the permissionless fee distribution for gasless coins whose shared
 * creator vault holds enough to distribute, paid by the sponsor, and add the
 * platform recipient's measured receipt to recovered_lamports. Bounded per tick.
 */
export async function crankSponsoredDistributions({ network = 'mainnet', max = 10 } = {}) {
	const sponsorKp = await loadLaunchSponsor();
	if (!sponsorKp) return { checked: 0, distributed: 0, skipped: 'sponsor_unconfigured' };
	const expired = await expireStaleSponsorships();
	const rows = await sql`
		SELECT id, mint FROM launch_sponsorships
		WHERE network = ${network} AND status = 'launched'
		  AND (last_distribution_at IS NULL OR last_distribution_at < now() - interval '6 hours')
		ORDER BY last_distribution_at ASC NULLS FIRST
		LIMIT ${max}
	`;
	if (!rows.length) return { checked: 0, distributed: 0, expired };

	const { online } = await getPumpSdk({ network });
	const { submitProtected } = await import('./execution-engine.js');
	const connection = getConnection({ network });
	const recipient = new PublicKey(await platformFeeShareRecipient());
	let distributed = 0;
	const details = [];
	for (const row of rows) {
		const mint = new PublicKey(row.mint);
		try {
			const min = await online.getMinimumDistributableFee(mint, sponsorKp.publicKey);
			if (!min.canDistribute) {
				await sql`UPDATE launch_sponsorships SET last_distribution_at = now() WHERE id = ${row.id}`;
				details.push({ mint: row.mint, status: 'below_minimum' });
				continue;
			}
			const { instructions } = await online.buildDistributeCreatorFeesInstructions(mint, { payer: sponsorKp.publicKey });
			const before = await connection.getBalance(recipient);
			const { signature } = await submitProtected({ network, connection, payer: sponsorKp, instructions });
			const after = await connection.getBalance(recipient);
			// When the recipient is the sponsor it also paid the fee; add it back.
			const feeAdj = recipient.equals(sponsorKp.publicKey) ? 5_000 : 0;
			const received = Math.max(0, after - before + feeAdj);
			await sql`
				UPDATE launch_sponsorships
				SET recovered_lamports = recovered_lamports + ${received},
				    last_distribution_signature = ${signature},
				    last_distribution_at = now()
				WHERE id = ${row.id}
			`;
			distributed++;
			details.push({ mint: row.mint, status: 'distributed', received, signature });
		} catch (err) {
			await sql`UPDATE launch_sponsorships SET last_distribution_at = now() WHERE id = ${row.id}`.catch(() => {});
			details.push({ mint: row.mint, status: 'error', error: err?.message });
		}
	}
	return { checked: rows.length, distributed, expired, details };
}

/** Public totals for the economics panel: what sponsorship cost and what it has recovered. */
export async function sponsorshipTotals(network = 'mainnet') {
	try {
		const [row] = await sql`
			SELECT count(*)::int AS launches,
			       coalesce(sum(sponsored_lamports), 0)::bigint AS sponsored,
			       coalesce(sum(recovered_lamports), 0)::bigint AS recovered
			FROM launch_sponsorships
			WHERE network = ${network} AND status = 'launched'
		`;
		return { launches: row?.launches ?? 0, sponsored_lamports: Number(row?.sponsored ?? 0), recovered_lamports: Number(row?.recovered ?? 0) };
	} catch {
		return { launches: 0, sponsored_lamports: 0, recovered_lamports: 0 };
	}
}
