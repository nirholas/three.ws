/**
 * On-chain tournament-standings attestor (server-side).
 *
 * At close, the Arena commits the FINAL standings to Solana as a single SPL-Memo
 * attestation signed by the platform attester, mirrored into `solana_attestations`
 * (kind `threews.tournament.v1`). Anyone can then verify "these standings were
 * published by three.ws at this slot" without trusting our database — and each
 * entrant's underlying PnL is independently re-derivable from the on-chain buy/sell
 * signatures the standings reference.
 *
 * Same best-effort contract as trader-score-attest.js:
 *   - No attester key (ATTEST_AGENT_SECRET_KEY) → throws `attester_key_not_configured`;
 *     the close path catches it and reports the attestation as unavailable rather
 *     than failing the whole close. No fake proof link is ever produced.
 *   - Idempotent per tournament: a second close returns the existing signature
 *     instead of broadcasting a duplicate.
 */

import { PublicKey, Transaction } from '@solana/web3.js';
import { sendAndConfirm } from './solana/confirm.js';
import { attestationMemoInstructions } from './solana/memo-attest.js';

import { sql } from './db.js';
import { solanaConnection } from './solana/connection.js';
import { RPC } from './solana-attestations.js';
import { loadAttesterKeypair } from './attest-event.js';

export const TOURNAMENT_KIND = 'threews.tournament.v1';
const TX_TIMEOUT_MS = 15_000;
// Keep the memo well under Solana's ~1232-byte tx size ceiling: attest the podium
// (top finishers) on-chain; the full board stays in the DB + is recomputable from
// the same on-chain trades.
const MAX_ATTESTED_RANKS = 10;

class TournamentAttestError extends Error {
	constructor(code, message) {
		super(message);
		this.name = 'TournamentAttestError';
		this.code = code;
	}
}

function withTimeout(promise, ms) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(
			() => reject(Object.assign(new Error(`rpc timeout after ${ms}ms`), { code: 'RPC_TIMEOUT' })),
			ms,
		);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function isValidPubkey(addr) {
	try {
		new PublicKey(addr);
		return true;
	} catch {
		return false;
	}
}

/**
 * Attest a tournament's final standings on-chain.
 *
 * @param {object} p
 * @param {object} p.tournament  the tournament row (id, name, network, scoring, window).
 * @param {Array}  p.standings   computeStandings output rows (ranked, with wallet/score).
 * @param {number} [p.now]
 * @returns {Promise<{ status:'minted'|'deduped', signature:string, kind:string, subject:string }>}
 */
export async function attestTournamentStandings({ tournament, standings, now = Date.now() }) {
	const network = tournament.network;
	if (network !== 'mainnet' && network !== 'devnet') {
		throw new TournamentAttestError('unsupported_network', `unsupported network ${network}`);
	}

	let attester;
	try {
		attester = loadAttesterKeypair();
	} catch {
		throw new TournamentAttestError('attester_key_not_configured', 'ATTEST_AGENT_SECRET_KEY is not set.');
	}
	const validator = attester.publicKey.toBase58();

	// Idempotency: one attestation per tournament id.
	const [existing] = await sql`
		select signature from solana_attestations
		where kind = ${TOURNAMENT_KIND} and network = ${network}
		  and payload->>'tournament_id' = ${tournament.id}
		limit 1
	`;
	if (existing) {
		return { status: 'deduped', signature: existing.signature, kind: TOURNAMENT_KIND, subject: validator };
	}

	const podium = standings
		.filter((s) => s.rank != null)
		.slice(0, MAX_ATTESTED_RANKS)
		.map((s) => ({
			rank: s.rank,
			agent_id: s.agent_id,
			wallet: s.wallet || null,
			score: s.score_value,
			realized_pnl_sol: s.metrics?.realized_pnl_sol ?? null,
			closed: s.in_window_trades,
			eligible: !!s.eligible,
		}));

	// Subject (attestation referent): the champion's wallet if it's a valid pubkey,
	// else the attester itself — the memo still carries the full podium either way.
	const champ = podium.find((p) => p.wallet && isValidPubkey(p.wallet));
	const subject = champ ? champ.wallet : validator;

	const payload = {
		v: 1,
		kind: TOURNAMENT_KIND,
		tournament_id: tournament.id,
		name: tournament.name,
		network,
		scoring: tournament.scoring,
		bracket: tournament.bracket,
		starts_at: tournament.starts_at,
		ends_at: tournament.ends_at,
		ts: Math.floor(now / 1000),
		entrants: standings.length,
		podium,
		source: 'threews.arena',
	};

	const conn = solanaConnection({ url: RPC[network] || RPC.devnet, commitment: 'confirmed' });
	// Subject rides on a ComputeBudget carrier, not the memo: SPL Memo v2
	// rejects any non-signer account (see solana/memo-attest.js).
	const ixs = attestationMemoInstructions({ signer: attester.publicKey, subject: subject, data: JSON.stringify(payload) });

	let signature;
	try {
		signature = await withTimeout(
			sendAndConfirm(conn, new Transaction().add(...ixs), [attester], { commitment: 'confirmed' }),
			TX_TIMEOUT_MS,
		);
	} catch (err) {
		throw new TournamentAttestError('record_failed', `tournament memo failed: ${err.message}`);
	}

	try {
		await sql`
			insert into solana_attestations (
				signature, network, slot, block_time, agent_asset, attester, kind, payload, verified
			) values (
				${signature}, ${network}, null, now(), ${subject}, ${validator},
				${TOURNAMENT_KIND}, ${JSON.stringify(payload)}::jsonb, true
			)
			on conflict (signature) do nothing
		`;
	} catch (err) {
		if (err?.code !== '23505') throw err;
	}

	return { status: 'minted', signature, kind: TOURNAMENT_KIND, subject };
}

export function attestationUrl(sig, network) {
	if (!sig) return null;
	return network === 'devnet' ? `https://solscan.io/tx/${sig}?cluster=devnet` : `https://solscan.io/tx/${sig}`;
}

export { TournamentAttestError };
