// One tick of the content queue, shared by the Cloud Scheduler cron and the
// CLI: validate, pick the due item, then either preview it or publish it.

import { loadQueue, validateQueue } from './queue.js';
import { pickDue } from './schedule.js';
import { previewClient, publishItem, xClientFromEnv } from './publisher.js';

export async function runTick({ root, store, now = Date.now(), dryRun = true, requestedId = null, env = process.env }) {
	const queue = loadQueue(root);
	const state = await store.load();
	const { problems } = validateQueue(queue, root, { state });

	const blocked = (queue.items || [])
		.filter((item) => item.status === 'approved' && problems[item.id]?.length)
		.map((item) => ({ id: item.id, problems: problems[item.id] }));
	// A named preview shows the calls even for an item that still fails review,
	// so the operator sees exactly what they are fixing.
	const publishable = (queue.items || []).filter((item) => !problems[item.id]?.length || (dryRun && item.id === requestedId));

	const decision = pickDue({
		items: publishable,
		state,
		now,
		cadence: queue.cadence,
		quality: queue.quality,
		requestedId,
		anyStatus: dryRun,
	});
	if (!decision.item) return { published: null, reason: decision.reason, blocked };

	const item = decision.item;
	if (dryRun) {
		const client = previewClient();
		// Preview against a scratch copy: the real ledger must not change.
		const scratch = structuredClone(state);
		await publishItem({ item, client, root, state: scratch, store: { save: async () => {} }, account: queue.account });
		return { preview: { id: item.id, kind: item.kind, dueAt: new Date(decision.dueAt).toISOString(), calls: client.calls }, blocked };
	}

	const client = await xClientFromEnv(env);
	if (!client) return { published: null, skipped: 'not_configured', reason: 'X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET are required', blocked };
	const row = await publishItem({ item, client, root, state, store, account: queue.account });
	return { published: row, resumed: Boolean(decision.resuming), blocked };
}
