// /api/teams/:id/chat: the squad coordinator.
//
// POST   /api/teams/:id/chat                  { message, mode: 'paper'|'live' } -> SSE: run, memory, plan,
//                                             step, approval, note, summary, end
// GET    /api/teams/:id/chat                  squad, remembered preferences, recent runs
// GET    /api/teams/:id/chat/runs/:runId      one run: steps and every event so far
// POST   /api/teams/:id/chat/approve          { step_id, decision: 'approve'|'deny', payload_hash } -> SSE
// GET    /api/teams/:id/chat/stream?run=&after= SSE tail of a run's events (picks up decisions
//                                             taken in /approvals, push or Telegram)
// GET    /api/teams/:id/chat/prefs            what the coordinator remembers
// DELETE /api/teams/:id/chat/prefs/:key       forget one preference
// GET    /api/team-chat                       the squads this account can chat with
//
// :id is a team id (api/_lib/teams) or, for a single agent, its agent id. The
// coordinator itself lives in api/_lib/team-chat/runner.js; this file is auth,
// transport and the spend leash. Live mode is the only path that can sign: a
// bearer needs wallet:write and mainnet needs the signed real-funds agreement,
// at plan time and again at approval time. Launches are never signed here; the
// Launcher hands off to the launchpad, which signs from the owner's session.

import { cors, method, json, error, wrap, readJson, rateLimited } from './_lib/http.js';
import { resolveAccount } from './_lib/account-auth.js';
import { requireCsrf } from './_lib/csrf.js';
import { requireRealFundsAgreement } from './_lib/real-funds-agreement.js';
import { assertBearerMaySpend } from './_lib/spend-scope.js';
import { limits } from './_lib/rate-limit.js';
import { createRunner, publicStep, TERMINAL } from './_lib/team-chat/runner.js';
import { createSqlStore } from './_lib/team-chat/store.js';
import { createApprovalsBridge } from './_lib/team-chat/approvals-bridge.js';
import { subscribe } from './_lib/team-chat/bus.js';
import { resolveSquad, listSquadsForUser, publicSquad, isUuid } from './_lib/team-chat/squad.js';
import { loadPrefs, forgetPref } from './_lib/team-chat/prefs.js';
import { PREF_KEYS } from './_lib/team-chat/plan.js';
import * as specialists from './_lib/team-chat/specialists.js';

export const maxDuration = 300;

const HEARTBEAT_MS = 15_000;
const TAIL_POLL_MS = 2_500;
const TAIL_REFRESH_MS = 10_000;
const TAIL_MAX_MS = 280_000;

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST', 'DELETE'])) return;

	const url = new URL(req.url, 'http://x');
	const parts = url.pathname.split('/').filter(Boolean);
	const auth = await resolveAccount(req, res).catch(() => null);
	if (!auth) return error(res, 401, 'unauthorized', 'Sign in to talk to your squad.');

	if (parts[1] === 'team-chat') {
		if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'GET only');
		return json(res, 200, { data: await listSquadsForUser(auth.userId) }, { 'cache-control': 'no-store' });
	}

	// ['api', 'teams', ':id', 'chat', sub?, subId?]
	const id = parts[2];
	const sub = parts[4] || null;
	const subId = parts[5] || null;
	if (!isUuid(id) || parts[3] !== 'chat') return error(res, 404, 'not_found', 'squad not found');
	const squad = await resolveSquad(id, auth.userId);
	if (!squad) return error(res, 404, 'not_found', 'squad not found');

	const store = createSqlStore();
	const runner = createRunner({
		store,
		specialists,
		bridge: createApprovalsBridge(),
		resolveSquad,
		loadPrefs,
		userId: auth.userId,
		req,
	});
	const ctx = { req, res, url, auth, squad, store, runner };

	try {
		if (sub === null && req.method === 'GET') return await overview(ctx);
		if (sub === null && req.method === 'POST') return await chat(ctx);
		if (sub === 'runs' && subId && req.method === 'GET') return await runDetail(ctx, subId);
		if (sub === 'approve' && req.method === 'POST') return await approve(ctx);
		if (sub === 'stream' && req.method === 'GET') return await tail(ctx);
		if (sub === 'prefs' && req.method === 'GET') return json(res, 200, { data: (await loadPrefs(squad.policy_agent_id, squad.id)).entries }, { 'cache-control': 'no-store' });
		if (sub === 'prefs' && subId && req.method === 'DELETE') return await forget(ctx, subId);
		return error(res, 404, 'not_found', 'not found');
	} catch (e) {
		if (res.headersSent) {
			console.error('[team-chat] stream failed', e?.stack || e?.message);
			sse(res, { kind: 'error', payload: { code: 'internal_error', message: 'The coordinator stopped unexpectedly. Nothing further was signed; reload to see where the run stands.' } });
			return res.end();
		}
		if (e?.status && e?.code) return error(res, e.status, e.code, e.message);
		throw e;
	}
});

// ── transport ──────────────────────────────────────────────────────────────────

function openSse(res) {
	res.writeHead(200, {
		'Content-Type': 'text/event-stream; charset=utf-8',
		'Cache-Control': 'no-cache, no-transform',
		'X-Accel-Buffering': 'no',
		Connection: 'keep-alive',
	});
	const hb = setInterval(() => {
		try { res.write(':hb\n\n'); } catch { clearInterval(hb); }
	}, HEARTBEAT_MS);
	res.on('close', () => clearInterval(hb));
	return () => clearInterval(hb);
}

function sse(res, ev) {
	try {
		res.write(`${ev.id ? `id: ${ev.id}\n` : ''}data: ${JSON.stringify({ id: ev.id || null, kind: ev.kind, step_id: ev.step_id || null, payload: ev.payload, created_at: ev.created_at || null })}\n\n`);
	} catch {
		// the socket closed; the run continues and the page reloads its events
	}
}

/** Shared gate for every write: CSRF for cookie sessions, then the chat budget. */
async function writeGate({ req, res, auth }) {
	if (auth.source === 'session' && !(await requireCsrf(req, res, auth.userId))) return false;
	const rl = await limits.chatUser(auth.userId);
	if (!rl.success) {
		rateLimited(res, rl, 'Too many squad messages. Give it a minute.');
		return false;
	}
	return true;
}

/** The live-mode leash: wallet:write for bearers, the signed agreement on mainnet. */
async function liveGate({ req, res, auth, squad }) {
	if (auth.source !== 'session') assertBearerMaySpend({ scope: auth.scope }, req);
	return requireRealFundsAgreement(req, res, { userId: auth.userId, network: squad.network, context: 'team-chat' });
}

// ── handlers ───────────────────────────────────────────────────────────────────

async function overview({ res, auth, squad, store }) {
	const [prefs, runs] = await Promise.all([loadPrefs(squad.policy_agent_id, squad.id), store.listRuns(auth.userId, squad.id, 12)]);
	return json(res, 200, {
		data: {
			squad: publicSquad(squad),
			prefs: prefs.entries,
			pref_keys: PREF_KEYS,
			runs: runs.map((r) => ({ id: r.id, utterance: r.utterance, mode: r.mode, status: r.status, summary: r.summary, created_at: r.created_at })),
		},
	}, { 'cache-control': 'no-store' });
}

async function chat(ctx) {
	const { req, res, squad, runner } = ctx;
	const body = (await readJson(req)) || {};
	const message = typeof body.message === 'string' ? body.message.trim() : '';
	if (!message) return error(res, 400, 'empty_message', 'Tell the squad what you want, for example "research $THREE and buy 0.05 SOL if it looks safe".');
	if (message.length > 2000) return error(res, 400, 'message_too_long', 'Keep it under 2,000 characters.');
	const mode = body.mode === 'live' ? 'live' : 'paper';
	if (squad.status !== 'active') {
		return error(res, 409, 'squad_inactive', squad.status === 'paused' ? 'This team is paused. Resume it on the team page, then ask again.' : `This team is ${squad.status}.`);
	}
	if (mode === 'live' && !(await liveGate(ctx))) return;
	if (!(await writeGate(ctx))) return;

	const close = openSse(res);
	let unsubscribe = () => {};
	try {
		const out = await runner.start({
			squad,
			utterance: message,
			mode,
			onCreated: (run) => {
				unsubscribe = subscribe(run.id, (ev) => sse(res, ev));
			},
		});
		sse(res, { kind: 'end', payload: { run_id: out.run.id, status: out.run.status } });
	} finally {
		unsubscribe();
		close();
		if (!res.writableEnded) res.end();
	}
}

async function runDetail({ res, auth, squad, store }, runId) {
	if (!isUuid(runId)) return error(res, 404, 'not_found', 'run not found');
	const run = await store.getRun(runId, auth.userId);
	if (!run || run.squad_id !== squad.id) return error(res, 404, 'not_found', 'run not found');
	const [steps, events] = await Promise.all([store.getSteps(run.id), store.listEvents(run.id, 0, 1000)]);
	return json(res, 200, {
		data: {
			run: { id: run.id, utterance: run.utterance, mode: run.mode, network: run.network, status: run.status, summary: run.summary, plan: { notes: run.plan?.notes || [], clarify: run.plan?.clarify || null, planner: run.planner }, created_at: run.created_at },
			steps: steps.map(publicStep),
			events,
			last_event_id: events.length ? events[events.length - 1].id : 0,
		},
	}, { 'cache-control': 'no-store' });
}

async function approve(ctx) {
	const { req, res, auth, squad, store, runner } = ctx;
	const body = (await readJson(req)) || {};
	if (!isUuid(body.step_id)) return error(res, 400, 'bad_step', 'step_id required');
	if (body.decision !== 'approve' && body.decision !== 'deny') return error(res, 400, 'bad_decision', 'decision must be "approve" or "deny"');
	const step = await store.getStep(body.step_id);
	const run = step ? await store.getRun(step.run_id, auth.userId) : null;
	if (!step || !run || run.squad_id !== squad.id) return error(res, 404, 'not_found', 'step not found');
	if (body.decision === 'approve') {
		if (typeof body.payload_hash !== 'string' || !/^[0-9a-f]{64}$/.test(body.payload_hash)) {
			return error(res, 400, 'payload_hash_required', 'Approving needs the payload_hash of the action you were shown.');
		}
		if (body.payload_hash !== step.approval?.payload_hash) {
			return error(res, 409, 'payload_mismatch', 'The action on file differs from the one you approved, so nothing was executed. Reload and review it again.');
		}
		if (step.approval?.payload?.mode === 'live' && !(await liveGate(ctx))) return;
	}
	if (!(await writeGate(ctx))) return;

	const close = openSse(res);
	const unsubscribe = subscribe(run.id, (ev) => sse(res, ev));
	try {
		const out = await runner.decide({ stepId: step.id, decision: body.decision, payloadHash: body.payload_hash || null });
		const after = await store.getRunById(run.id);
		sse(res, { kind: 'end', payload: { run_id: run.id, status: after.status, step: out.step, idempotent: out.idempotent } });
	} catch (e) {
		if (!e?.status || !e?.code) throw e;
		sse(res, { kind: 'error', step_id: step.id, payload: { code: e.code, message: e.message } });
	} finally {
		unsubscribe();
		close();
		if (!res.writableEnded) res.end();
	}
}

async function tail({ req, res, url, auth, squad, store, runner }) {
	const runId = url.searchParams.get('run');
	if (!isUuid(runId)) return error(res, 400, 'bad_run', 'run is required');
	const run = await store.getRun(runId, auth.userId);
	if (!run || run.squad_id !== squad.id) return error(res, 404, 'not_found', 'run not found');
	let cursor = Number(req.headers['last-event-id'] || url.searchParams.get('after') || 0) || 0;

	const close = openSse(res);
	let stopped = false;
	let lastRefresh = 0;
	const stop = () => {
		if (stopped) return;
		stopped = true;
		clearInterval(timer);
		clearTimeout(deadline);
		close();
		if (!res.writableEnded) res.end();
	};
	const pump = async () => {
		if (stopped) return;
		try {
			if (Date.now() - lastRefresh > TAIL_REFRESH_MS) {
				lastRefresh = Date.now();
				await runner.refresh(run.id);
			}
			const events = await store.listEvents(run.id, cursor, 200);
			for (const ev of events) {
				cursor = ev.id;
				sse(res, ev);
			}
			const cur = await store.getRunById(run.id);
			const steps = await store.getSteps(run.id);
			if (['done', 'failed', 'cancelled'].includes(cur.status) && steps.every((s) => TERMINAL.includes(s.status)) && !events.length) {
				sse(res, { kind: 'end', payload: { run_id: run.id, status: cur.status } });
				stop();
			}
		} catch (e) {
			console.warn('[team-chat] tail poll failed', e?.message);
		}
	};
	const timer = setInterval(pump, TAIL_POLL_MS);
	const deadline = setTimeout(stop, TAIL_MAX_MS);
	req.on('close', stop);
	await pump();
}

async function forget(ctx, key) {
	const { res, squad } = ctx;
	if (!PREF_KEYS.includes(key)) return error(res, 400, 'bad_key', `key must be one of ${PREF_KEYS.join(', ')}`);
	if (!(await writeGate(ctx))) return;
	await forgetPref(squad.policy_agent_id, squad.id, key);
	return json(res, 200, { data: (await loadPrefs(squad.policy_agent_id, squad.id)).entries });
}
