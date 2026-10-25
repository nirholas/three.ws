/**
 * Persona wallet spend ledger — the durable record `persona_tip` / `persona_send`
 * check BEFORE moving any USDC, so the per-call and per-session caps are real
 * limits and not just numbers in a description.
 *
 * Mirrors the storage tiering already established by persona-store.js: a
 * Postgres table in production, a JSON-on-disk fallback for local/dev/test so
 * "the cap actually blocks a second call in the same session" is provable
 * without a live database. Same shape either way.
 *
 * A "session" is caller-scoped (the `session_id` a client passes), not a
 * three.ws account — persona wallets are addressable by id alone, so the spend
 * cap follows the same no-account posture as the persona itself. Callers that
 * omit session_id are bucketed by persona_id + UTC calendar day, which still
 * bounds a runaway/looped caller even with no session id supplied.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sql } from './db.js';
import { databaseConfigured } from './env.js';

const dbConfigured = () => databaseConfigured();

function envNumber(key, fallback) {
	const raw = process.env[key];
	if (raw === undefined || String(raw).trim() === '') return fallback;
	const n = Number(raw);
	return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// ── guardrail configuration (env-tunable, conservative defaults) ─────────────
export const PERSONA_SPEND_CAPS = Object.freeze({
	// Hard ceiling on a SINGLE persona_tip/persona_send call.
	maxPerCallUsdc: envNumber('PERSONA_MAX_TIP_USDC', 1),
	// Cumulative ceiling across every call sharing one session_id (or the daily
	// fallback bucket for callers that don't pass one).
	maxPerSessionUsdc: envNumber('PERSONA_MAX_SESSION_USDC', 5),
	// Above this amount, the tool call must carry confirm:true — the same
	// confirmation-gate shape used by the SOL wallet_send tool.
	confirmAboveUsdc: envNumber('PERSONA_CONFIRM_ABOVE_USDC', 0.25),
});

export function utcDateBucket(d = new Date()) {
	return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

/** Deterministic fallback session key for callers that omit session_id. */
export function defaultSessionId(personaId) {
	return `${personaId}:${utcDateBucket()}`;
}

// ── Postgres backend ──────────────────────────────────────────────────────────

let _schemaReady = null;
async function ensureSchema() {
	if (_schemaReady) return _schemaReady;
	_schemaReady = sql`
		create table if not exists persona_wallet_spend_events (
			id            bigserial primary key,
			persona_id    text not null,
			session_id    text not null,
			usdc          numeric not null,
			tool          text not null,
			to_address    text,
			signature     text,
			created_at    timestamptz not null default now()
		)
	`.then(() => sql`
		create index if not exists persona_wallet_spend_events_session_idx
		on persona_wallet_spend_events (persona_id, session_id)
	`).then(() => true);
	return _schemaReady;
}

async function dbSessionTotal(personaId, sessionId) {
	await ensureSchema();
	const [row] = await sql`
		select coalesce(sum(usdc), 0)::float8 as total
		from persona_wallet_spend_events
		where persona_id = ${personaId} and session_id = ${sessionId}
	`;
	return Number(row?.total || 0);
}

async function dbRecordSpend({ personaId, sessionId, usdc, tool, toAddress, signature }) {
	await ensureSchema();
	await sql`
		insert into persona_wallet_spend_events (persona_id, session_id, usdc, tool, to_address, signature)
		values (${personaId}, ${sessionId}, ${usdc}, ${tool}, ${toAddress || null}, ${signature || null})
	`;
}

// ── filesystem backend (local/dev/test fallback) ──────────────────────────────

function storeDir() {
	return process.env.PERSONA_SPEND_STORE_DIR || path.join(process.cwd(), '.data', 'persona-spend');
}
async function fsDir() {
	const dir = storeDir();
	try {
		await fs.mkdir(dir, { recursive: true });
		return dir;
	} catch {
		const tmp = path.join(os.tmpdir(), 'threews-persona-spend');
		await fs.mkdir(tmp, { recursive: true });
		return tmp;
	}
}
function fsKey(personaId, sessionId) {
	// Both ids are already constrained (persona_id regex, session_id clamped
	// below), but slice+strip defensively before it touches a filename.
	const safe = (s) => String(s).replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 120);
	return `${safe(personaId)}__${safe(sessionId)}.json`;
}
async function fsFile(personaId, sessionId) {
	return path.join(await fsDir(), fsKey(personaId, sessionId));
}

async function fsSessionEvents(personaId, sessionId) {
	try {
		const raw = await fs.readFile(await fsFile(personaId, sessionId), 'utf8');
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function fsRecordSpend({ personaId, sessionId, usdc, tool, toAddress, signature }) {
	const events = await fsSessionEvents(personaId, sessionId);
	events.push({ usdc, tool, to_address: toAddress || null, signature: signature || null, created_at: new Date().toISOString() });
	await fs.writeFile(await fsFile(personaId, sessionId), JSON.stringify(events, null, 2), 'utf8');
}

// ── public API ────────────────────────────────────────────────────────────────

/** Sum of USDC already spent in this persona+session, real data either backend. */
export async function sessionSpentUsdc(personaId, sessionId) {
	if (dbConfigured()) return dbSessionTotal(personaId, sessionId);
	const events = await fsSessionEvents(personaId, sessionId);
	return events.reduce((sum, e) => sum + Number(e.usdc || 0), 0);
}

/**
 * Check every guardrail BEFORE a transfer is signed. Returns
 * `{ ok: true }` when the call may proceed, or `{ ok: false, code, message, ... }`
 * describing exactly which cap blocked it — never throws, so a handler can
 * return the refusal directly as a designed result.
 */
export async function checkPersonaSpend({ personaId, sessionId, usdc }) {
	const amount = Number(usdc);
	if (!(amount > 0)) {
		return { ok: false, code: 'invalid_amount', message: 'Amount must be a positive number of USDC.' };
	}
	if (amount > PERSONA_SPEND_CAPS.maxPerCallUsdc) {
		return {
			ok: false,
			code: 'over_call_cap',
			message: `$${amount} exceeds the per-call cap of $${PERSONA_SPEND_CAPS.maxPerCallUsdc} USDC.`,
			cap_usdc: PERSONA_SPEND_CAPS.maxPerCallUsdc,
		};
	}
	// The session id is caller-chosen, so a fresh one must not reset the cap:
	// every spend is also booked to the persona's UTC-day bucket, and that
	// bucket is held to the same ceiling whatever session_id the caller sends.
	const daily = await sessionSpentUsdc(personaId, defaultSessionId(personaId));
	const spent = Math.max(await sessionSpentUsdc(personaId, sessionId), daily);
	if (spent + amount > PERSONA_SPEND_CAPS.maxPerSessionUsdc) {
		return {
			ok: false,
			code: 'over_session_cap',
			message: `This session has already spent $${spent.toFixed(4)} of its $${PERSONA_SPEND_CAPS.maxPerSessionUsdc} USDC cap — $${amount} would exceed it.`,
			cap_usdc: PERSONA_SPEND_CAPS.maxPerSessionUsdc,
			spent_usdc: spent,
		};
	}
	return { ok: true, spent_usdc: spent, remaining_usdc: PERSONA_SPEND_CAPS.maxPerSessionUsdc - spent - amount };
}

/** Record a SETTLED spend (call only after the on-chain transfer confirms). */
export async function recordPersonaSpend({ personaId, sessionId, usdc, tool, toAddress, signature }) {
	const row = { personaId, sessionId, usdc: Number(usdc), tool, toAddress, signature };
	const record = dbConfigured() ? dbRecordSpend : fsRecordSpend;
	await record(row);
	const dailyId = defaultSessionId(personaId);
	if (sessionId !== dailyId) await record({ ...row, sessionId: dailyId });
}
