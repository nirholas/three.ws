// GET /api/v1/runs/:id/events: a run's steps as server-sent events.
//
// The stream replays every step after the client's cursor (`Last-Event-ID`
// header, or `?after=<seq>`), then follows the run live. While a watcher is
// connected the stream also drives the run itself, one leased step at a time
// (the same lease the every-minute cron takes, so the two never step a run
// twice), which is why a streamed run starts in seconds instead of waiting for
// the next cron tick.
//
// Events:
//   step    one agent_run_steps row (serializeStep); `id` is its seq
//   status  the run's status changed (serializeRun)
//   done    the run reached a terminal status (serializeRun); the stream ends
//   reconnect  the stream hit its time limit; resume with Last-Event-ID
//
// A comment line goes out every 15 seconds so proxies keep the socket open.

import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { apiError, intParam } from './http.js';
import { getOwnedRun, serializeRun, serializeStep, stepRun, TERMINAL_RUN_STATUSES } from './runs.js';

const STREAM_MAX_MS = 5 * 60_000;
const POLL_MS = 1000;
const HEARTBEAT_MS = 15_000;
const DRIVABLE = new Set(['queued', 'scheduled', 'running']);

function cursorFrom(req, query) {
	const header = req.headers['last-event-id'];
	const raw = typeof header === 'string' && header.trim() ? header.trim() : query.after;
	if (raw == null || raw === '') return 0;
	if (!/^\d+$/.test(String(raw))) {
		throw apiError(400, 'invalid_parameter', 'Last-Event-ID / after must be a step seq from a previous event.', { parameter: 'after' });
	}
	return Number(raw);
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function agentRunning(agentId) {
	const [a] = await sql`SELECT status FROM agent_identities WHERE id = ${agentId} AND deleted_at IS NULL`;
	return a?.status !== 'stopped';
}

/** The route handler body: writes the stream itself and returns nothing. */
export async function streamRunEvents({ req, res, params, query, principal }) {
	const run = await getOwnedRun(params.id, principal.userId);
	let after = cursorFrom(req, query);
	const drive = query.drive !== 'false';
	const maxMs = intParam(query.maxSeconds, { name: 'maxSeconds', min: 5, max: STREAM_MAX_MS / 1000, fallback: STREAM_MAX_MS / 1000 }) * 1000;

	res.writeHead(200, {
		'content-type': 'text/event-stream; charset=utf-8',
		'cache-control': 'no-cache, no-transform',
		'x-accel-buffering': 'no',
		connection: 'keep-alive',
	});
	let closed = false;
	req.on('close', () => {
		closed = true;
	});
	const send = (event, data, id = null) => {
		if (closed || res.writableEnded) return;
		res.write(`${id == null ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
	};

	const owner = `sse:${randomUUID()}`;
	const stop = Date.now() + maxMs;
	let lastStatus = null;
	let lastBeat = Date.now();
	let current = run;

	while (!closed && Date.now() < stop) {
		const steps = await sql`
			SELECT * FROM agent_run_steps WHERE run_id = ${run.id} AND seq > ${after} ORDER BY seq ASC LIMIT 200
		`;
		for (const s of steps) {
			send('step', serializeStep(s), s.seq);
			after = s.seq;
		}
		[current] = await sql`SELECT * FROM agent_runs WHERE id = ${run.id}`;
		if (current.status !== lastStatus) {
			lastStatus = current.status;
			send('status', serializeRun(current));
		}
		if (TERMINAL_RUN_STATUSES.has(current.status)) {
			// Steps written by the finalize that made the run terminal.
			const tail = await sql`SELECT * FROM agent_run_steps WHERE run_id = ${run.id} AND seq > ${after} ORDER BY seq ASC`;
			for (const s of tail) {
				send('step', serializeStep(s), s.seq);
				after = s.seq;
			}
			send('done', serializeRun(current));
			break;
		}
		if (steps.length === 200) continue;

		let stepped = null;
		if (drive && DRIVABLE.has(current.status) && (await agentRunning(current.agent_id))) {
			stepped = await stepRun(run.id, { owner }).catch((err) => {
				send('error', { message: String(err?.message || err).slice(0, 300) });
				return null;
			});
		}
		if (!stepped) await pause(POLL_MS);
		if (Date.now() - lastBeat >= HEARTBEAT_MS && !closed) {
			res.write(': keepalive\n\n');
			lastBeat = Date.now();
		}
	}
	if (!closed && !TERMINAL_RUN_STATUSES.has(current?.status)) send('reconnect', { after, status: current?.status ?? null });
	if (!res.writableEnded) res.end();
}
