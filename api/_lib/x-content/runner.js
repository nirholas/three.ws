// One tick of the content queue, shared by the Cloud Scheduler cron and the
// CLI: validate, open a slot, fill it with the highest-priority ready post,
// then either preview it or publish it.
//
// A tick never ends on a failed post. If the best post cannot go out right now
// (a link is down, a feature probe fails, X rejects the content), that post is
// put on hold with the reason and a backoff, and the slot goes to the next-best
// post in the same tick. Only failures that are not the post's fault (X is
// down, rate-limited, or rejecting our credentials) stop the tick, because
// every post would fail the same way; the next tick retries.

import { loadQueue, validateQueue } from './queue.js';
import { TIERS, pickDue, tierOf } from './schedule.js';
import { loadLifts } from './priority.js';
import { loadReview, contentHash } from './review.js';
import { previewClient, publishItem, xClientFromEnv } from './publisher.js';
import { itemTexts, linkChecks, probeChecks } from './verify.js';
import { loadTrialSpec } from './trial.js';

const HOUR = 60 * 60_000;
// Tries per tick before giving up the slot: enough to skip a few broken posts,
// bounded so one tick cannot spend an hour on pre-flight checks.
const MAX_ATTEMPTS_PER_TICK = 5;
const HOLD_BACKOFF_MS = [2 * HOUR, 6 * HOUR, 24 * HOUR];

// A hold lasts until its backoff ends, or until the post itself changes (a new
// content hash means someone fixed it, so it may go again at once).
export function activeHolds(state, items, root, now = Date.now()) {
	const held = new Set();
	for (const item of items) {
		const hold = state.holds?.[item.id];
		if (hold && hold.hash === contentHash(item, root) && Date.parse(hold.until) > now) held.add(item.id);
	}
	return held;
}

export function placeHold(state, item, root, reason, now = Date.now()) {
	state.holds ||= {};
	const previous = state.holds[item.id];
	const hash = contentHash(item, root);
	const attempts = previous?.hash === hash ? previous.attempts + 1 : 1;
	const backoff = HOLD_BACKOFF_MS[Math.min(attempts, HOLD_BACKOFF_MS.length) - 1];
	state.holds[item.id] = { reason, attempts, hash, heldAt: new Date(now).toISOString(), until: new Date(now + backoff).toISOString() };
	return state.holds[item.id];
}

// Whether an X API error is about this post (hold it, try the next) or about
// the account or the platform (stop, retry the same post next tick).
export function isPostSpecific(err) {
	const status = Number(err?.code ?? err?.status);
	if (!status || status === 429 || status >= 500 || status === 401) return false;
	const text = JSON.stringify(err?.data || err?.message || '').toLowerCase();
	if (status === 403) return /duplicate|not allowed to create/.test(text);
	return status >= 400 && status < 500;
}

// Nothing of this post exists on X yet, so skipping it cannot leave a thread
// or an Article half-published.
const untouched = (state, item) => {
	const progress = state.inflight?.[item.id];
	return !progress || (!progress.postIds?.length && !progress.articleDraftId && !progress.articlePostId);
};

// The trial's api steps run again seconds before sending: a trial proves the
// feature worked when it ran, this proves it still answers now.
async function preflight(item, root) {
	const trialSteps = (loadTrialSpec(root, item.id)?.steps || []).filter((step) => step.type === 'api');
	const checks = [
		...(await linkChecks(itemTexts(item))),
		...(await probeChecks(item, { root, where: 'publish' })),
		...(await probeChecks({ probes: trialSteps }, { root, where: 'publish' })),
	];
	return checks.filter((check) => !check.ok);
}

// ── Inventory ───────────────────────────────────────────────────────────────
// Days of approved, ready stock per tier (one slot per tier per day). Anything
// under INVENTORY_WARN_DAYS is raised once a day through the platform's ops
// alerts, so the queue asks for more posts before it goes quiet, instead of
// after.
export const INVENTORY_WARN_DAYS = 3;

export function inventory(items, state, root, now = Date.now()) {
	const publishedIds = new Set((state.published || []).map((row) => row.id));
	const held = activeHolds(state, items, root, now);
	const counts = new Map(TIERS.map((tier) => [tier, 0]));
	for (const item of items) {
		if (item.status !== 'approved' || publishedIds.has(item.id) || held.has(item.id)) continue;
		if (item.expiresAt && Date.parse(item.expiresAt) <= now) continue;
		counts.set(tierOf(item), counts.get(tierOf(item)) + 1);
	}
	return TIERS.map((tier) => ({ tier, days: counts.get(tier), low: counts.get(tier) < INVENTORY_WARN_DAYS }));
}

async function alertLowInventory(state, store, stock, now) {
	const today = new Date(now).toISOString().slice(0, 10);
	if (!stock.some((row) => row.low) || state.inventoryAlertedOn === today) return null;
	const { sendOpsAlert } = await import('../alerts.js');
	const summary = stock.map((row) => `T${row.tier}: ${row.days} day(s)`).join(', ');
	await sendOpsAlert('x-content: approved post stock is low', `${summary}. Draft, review, and approve more posts: npm run x:content -- plan`);
	state.inventoryAlertedOn = today;
	await store.save(state);
	return summary;
}

// `client` and `checks` default to the real X client and the real pre-flight;
// tests pass their own to drive the hold-and-fall-through path.
export async function runTick({ root, store, now = Date.now(), dryRun = true, requestedId = null, env = process.env, client: injectedClient = null, checks = preflight }) {
	const queue = loadQueue(root);
	const state = await store.load();
	const { problems } = validateQueue(queue, root, { state });

	const blocked = (queue.items || [])
		.filter((item) => item.status === 'approved' && problems[item.id]?.length)
		.map((item) => ({ id: item.id, problems: problems[item.id] }));
	// A named preview shows the calls even for an item that still fails review,
	// so the operator sees exactly what they are fixing.
	const publishable = (queue.items || []).filter((item) => !problems[item.id]?.length || (dryRun && item.id === requestedId));
	const reviews = new Map(publishable.map((item) => [item.id, loadReview(root, item.id)]));
	const context = {
		items: publishable,
		state,
		now,
		cadence: queue.cadence,
		quality: queue.quality,
		requestedId,
		anyStatus: dryRun,
		// The queue is public; the minute a slot opens is not. See schedule.js.
		seed: env.X_CONTENT_SCHEDULE_SEED || null,
		lifts: loadLifts(root),
		reviews,
	};

	if (dryRun) {
		const decision = pickDue({ ...context, exclude: activeHolds(state, publishable, root, now) });
		if (!decision.item) return { published: null, reason: decision.reason, blocked };
		const client = previewClient();
		// Preview against a scratch copy: the real ledger must not change.
		const scratch = structuredClone(state);
		await publishItem({ item: decision.item, client, root, state: scratch, store: { save: async () => {} }, account: queue.account });
		return { preview: { id: decision.item.id, kind: decision.item.kind, score: decision.score, parts: decision.parts, ranking: decision.ranking, calls: client.calls }, blocked };
	}

	const client = injectedClient || (await xClientFromEnv(env));
	if (!client) return { published: null, skipped: 'not_configured', reason: 'X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET are required', blocked };

	const stock = inventory(publishable, state, root, now);
	const lowStock = requestedId ? null : await alertLowInventory(state, store, stock, now).catch(() => null);

	const exclude = requestedId ? new Set() : activeHolds(state, publishable, root, now);
	const held = [];
	for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_TICK; attempt++) {
		const decision = pickDue({ ...context, exclude });
		if (!decision.item) return { published: null, reason: decision.reason, held, blocked, stock, lowStock };
		const item = decision.item;

		// A resumed thread must finish what it started, so it skips pre-flight.
		if (!decision.resuming) {
			const failures = await checks(item, root);
			if (failures.length) {
				const reason = failures.map((check) => `${check.kind} ${check.target}: ${check.detail}`).join('; ');
				held.push({ id: item.id, reason, hold: placeHold(state, item, root, reason, now) });
				await store.save(state);
				exclude.add(item.id);
				continue;
			}
		}

		try {
			const meta = decision.slot ? { slot: decision.slot.key, tier: decision.tier, slotTier: decision.slot.tier } : {};
			const row = await publishItem({ item, client, root, state, store, account: queue.account, meta, now });
			if (state.holds?.[item.id]) {
				delete state.holds[item.id];
				await store.save(state);
			}
			return { published: row, stock, lowStock, score: decision.score, tier: decision.tier, filledDown: Boolean(decision.filledDown), resumed: Boolean(decision.resuming), held, blocked };
		} catch (err) {
			if (!isPostSpecific(err) || !untouched(state, item)) throw err;
			const reason = `X rejected the post: ${err.message}`;
			held.push({ id: item.id, reason, hold: placeHold(state, item, root, reason, now) });
			delete state.inflight?.[item.id];
			await store.save(state);
			exclude.add(item.id);
		}
	}
	return { published: null, reason: `${MAX_ATTEMPTS_PER_TICK} posts were held this tick; the slot stays open for the next tick`, held, blocked };
}
