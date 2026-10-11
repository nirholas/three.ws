// Durable launch records for the EVM lanes (paired and Uniswap).
//
// runLaunch() wraps a lane's launch function so that:
//   - the launch is written to evm_launch_records BEFORE anything is signed,
//   - a retry with the same Idempotency-Key returns the same record instead of
//     launching twice (the same key with a different body is refused),
//   - every step the launch passes is appended to `stages`, and
//   - a launch whose transaction landed after the request died is settled by
//     settleLaunch(), which GET /api/launches/:id calls.
//
// The key is scoped to the caller. See docs/launch-lanes.md.

import { createHash } from 'node:crypto';
import { sql } from './db.js';
import { EvmLegError } from './evm-leg/chains.js';

export const LAUNCH_STATUS = Object.freeze({
	pending: 'pending',
	submitted: 'submitted',
	confirmed: 'confirmed',
	finalized: 'finalized',
	failed: 'failed',
});

/** Statuses a record can still leave. */
export const OPEN_STATUSES = new Set(['pending', 'submitted', 'confirmed']);

const KEY_PATTERN = /^[\x21-\x7e]{8,128}$/;

/** The header value, trimmed, or a 400 when it cannot be a usable key. */
export function readIdempotencyKey(req) {
	const raw = req.headers?.['idempotency-key'];
	if (raw == null || String(raw).trim() === '') return null;
	const key = String(raw).trim();
	if (!KEY_PATTERN.test(key)) {
		throw new EvmLegError('invalid_idempotency_key', 'Idempotency-Key must be 8 to 128 printable ASCII characters with no spaces.', 400);
	}
	return key;
}

function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
	if (value && typeof value === 'object') {
		return `{${Object.keys(value)
			.filter((k) => value[k] !== undefined)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(',')}}`;
	}
	return JSON.stringify(value ?? null);
}

/** Same lane, agent and body gives the same fingerprint, whatever the key order. */
export function fingerprintOf({ lane, agentId, body }) {
	return createHash('sha256').update(`${lane}\n${agentId}\n${canonical(body)}`).digest('hex');
}

/** The public shape of a record. */
export function publicRecord(row) {
	return {
		id: row.id,
		lane: row.lane,
		chain: row.chain,
		agent_id: row.agent_id,
		status: row.status,
		finalized: row.status === 'finalized',
		stages: row.stages,
		tx_hash: row.tx_hash,
		token: row.token,
		result: row.result,
		error: row.error,
		idempotency_key: row.idempotency_key,
		created_at: row.created_at,
		updated_at: row.updated_at,
	};
}

export async function getLaunchRecord(id, userId) {
	const [row] = await sql`SELECT * FROM evm_launch_records WHERE id = ${id} AND user_id = ${userId} LIMIT 1`;
	return row || null;
}

async function claim({ lane, chain, userId, agentId, key, fingerprint }) {
	const stages = JSON.stringify([{ stage: 'accepted', at: new Date().toISOString() }]);
	const [created] = await sql`
		INSERT INTO evm_launch_records (user_id, agent_id, lane, chain, idempotency_key, fingerprint, stages)
		VALUES (${userId}, ${agentId}, ${lane}, ${chain}, ${key}, ${fingerprint}, ${stages}::jsonb)
		ON CONFLICT (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
		RETURNING *
	`;
	if (created) return { row: created, replayed: false };
	const [existing] = await sql`SELECT * FROM evm_launch_records WHERE user_id = ${userId} AND idempotency_key = ${key} LIMIT 1`;
	if (!existing) throw new EvmLegError('launch_record_unavailable', 'The launch record could not be created. Retry with the same Idempotency-Key.', 503);
	if (existing.fingerprint !== fingerprint) {
		throw new EvmLegError(
			'idempotency_key_reused',
			'This Idempotency-Key was already used for a different launch. Send a new key for a different coin or lane.',
			422,
			{ launch_id: existing.id },
		);
	}
	return { row: existing, replayed: true };
}

async function patch(id, { status, stage, detail, txHash, token, result, error, context }) {
	const entry = stage ? JSON.stringify([{ stage, at: new Date().toISOString(), ...(detail ? { detail } : {}) }]) : '[]';
	const [row] = await sql`
		UPDATE evm_launch_records SET
			status = COALESCE(${status ?? null}, status),
			stages = stages || ${entry}::jsonb,
			tx_hash = COALESCE(${txHash ?? null}, tx_hash),
			token = COALESCE(${token ?? null}, token),
			result = COALESCE(${result ? JSON.stringify(result) : null}::jsonb, result),
			error = COALESCE(${error ? JSON.stringify(error) : null}::jsonb, error),
			context = context || ${JSON.stringify(context || {})}::jsonb,
			updated_at = now()
		WHERE id = ${id}
		RETURNING *
	`;
	return row;
}

const DEFINITIVE_FAILURES = new Set(['send_failed', 'launch_reverted', 'launch_unreadable', 'launch_blocked', 'simulation_failed']);

/**
 * Run `execute` under a launch record. `execute({ record, stage })` returns the
 * launch result; calling `stage(name, { status, detail, txHash, token, context })`
 * appends a stage and, optionally, moves the record's status.
 *
 * Returns { record, replayed, result }. A replay never calls `execute`: it
 * returns the record as it stands (in flight, finalized or failed).
 */
export async function runLaunch({ lane, chain, userId, agentId, key, body, execute }) {
	const fingerprint = fingerprintOf({ lane, agentId, body });
	let row;
	let replayed = false;
	if (key) {
		({ row, replayed } = await claim({ lane, chain, userId, agentId, key, fingerprint }));
	} else {
		[row] = await sql`
			INSERT INTO evm_launch_records (user_id, agent_id, lane, chain, fingerprint, stages)
			VALUES (${userId}, ${agentId}, ${lane}, ${chain}, ${fingerprint},
				${JSON.stringify([{ stage: 'accepted', at: new Date().toISOString() }])}::jsonb)
			RETURNING *
		`;
	}
	if (replayed) return { record: row, replayed: true, result: row.result };

	const stage = async (name, opts = {}) => {
		row = await patch(row.id, { stage: name, detail: opts.detail, status: opts.status, txHash: opts.txHash, token: opts.token, context: opts.context });
	};
	try {
		const result = await execute({ record: row, stage });
		row = await patch(row.id, { status: 'finalized', stage: 'finalized', result, token: result?.token });
		return { record: row, replayed: false, result };
	} catch (err) {
		const sent = Boolean(row.tx_hash);
		// A transaction that was sent and has no verdict yet stays 'submitted';
		// settleLaunch() reads its receipt later. Anything else is a failure.
		const unresolved = sent && !DEFINITIVE_FAILURES.has(err?.code);
		if (unresolved) {
			await patch(row.id, { stage: 'awaiting_confirmation', detail: { reason: String(err?.shortMessage || err?.message || err).slice(0, 300) } }).catch(() => {});
		} else {
			await patch(row.id, {
				status: 'failed',
				stage: 'failed',
				error: { code: err?.code || 'launch_failed', message: String(err?.message || err).slice(0, 500), ...(err?.detail ? { detail: err.detail } : {}) },
			}).catch(() => {});
		}
		err.launchId = row.id;
		throw err;
	}
}

/**
 * Settle a record that is still open: when its transaction has a receipt, finish
 * it through the lane's settler. A record with no transaction that has sat
 * unsigned past `STALE_MS` is failed so a client polling it is not left waiting
 * on a launch that died before it sent anything.
 */
const STALE_MS = 10 * 60 * 1000;

export async function settleLaunch(row, settlers) {
	if (!OPEN_STATUSES.has(row.status)) return row;
	if (!row.tx_hash) {
		if (Date.now() - new Date(row.updated_at).getTime() < STALE_MS) return row;
		return patch(row.id, {
			status: 'failed',
			stage: 'failed',
			error: { code: 'abandoned', message: 'The launch stopped before anything was sent. No funds moved. Start a new launch with a new Idempotency-Key.' },
		});
	}
	const settle = settlers[row.lane];
	if (!settle) return row;
	let outcome;
	try {
		outcome = await settle(row);
	} catch (err) {
		console.error('[launch-record] settle failed', row.id, err?.message);
		return row;
	}
	if (!outcome) return row;
	if (outcome.error) {
		return patch(row.id, { status: 'failed', stage: 'failed', error: outcome.error });
	}
	return patch(row.id, { status: 'finalized', stage: 'finalized', result: outcome.result, token: outcome.result?.token, detail: { settled_by: 'status_read' } });
}
