// The public model catalog: every model an agent's brain can be set to, with
// what a picker needs to choose between them.
//
// One list feeds every surface that shows models, so they can never disagree:
//   GET /api/v1/models            (api/v1/models.js, the SDK's getModels)
//   three://models                (api/_mcp/resources.js)
//   the model picker              (src/shared/model-picker.js: agent editor,
//                                  agent chat, /pricing)
//
// A row is listed only when its id is a MODEL_CATALOG id (chat-models.js),
// because that is the id space the agent runtime honors everywhere
// (api/_lib/agent-model.js resolveMessageModel): a brain key that only the
// /brain page understands would be a pick that silently does nothing on the
// web copilot, the gateways and runs. The platform default (no model named)
// is not a row: pickers offer it as "Platform default".
//
// Per row: id, label, family, description, context window, max output, tool
// support, free-tier coverage, list price per million tokens, whether this
// deployment holds a route for it, whether it needs a signed-in caller, and
// live health from llm-health.js (open-model roster rows; other rows are not
// probed and report null).

import { MODEL_CATALOG, isFreeTierModel, resolveModelId } from './chat-models.js';
import { rosterModel } from './model-roster.js';
import { modelPrice } from './llm-pricing.js';

/**
 * Build catalog rows from the /brain provider list and a roster health report.
 * Pure: exported for tests.
 * @param {Array<object>} providers api/brain/chat.js getAvailableProviders()
 * @param {{ models?: Record<string, { status: string, latencyMs: number|null, lane: string|null }> }|null} health
 */
export function buildCatalogRows(providers, health = null) {
	const rows = [];
	const seen = new Set();
	for (const p of providers) {
		const id = resolveModelId(p.key);
		const meta = MODEL_CATALOG[id];
		if (!meta || seen.has(id)) continue;
		seen.add(id);
		const roster = rosterModel(id);
		const free = isFreeTierModel(id);
		const probe = health?.models?.[id] || null;
		rows.push({
			id,
			label: p.label,
			family: p.network,
			description: p.description || null,
			tier: p.tier || null,
			context: roster?.context ?? p.context ?? null,
			max_output: roster?.maxOutput ?? p.maxOutput ?? null,
			tools: meta.tools === true,
			reasoning: Boolean(roster?.reasoning),
			free,
			price_usd_per_mtok: roster ? [...roster.price] : modelPrice(id) || (p.openrouterModel ? modelPrice(p.openrouterModel) : null),
			available: Boolean(p.available),
			requires_auth: Boolean(p.requiresAuth) && !free,
			open_weights: Boolean(roster) && roster.family !== 'Google',
			health: probe ? { status: probe.status, latency_ms: probe.latencyMs ?? null, lane: probe.lane ?? null } : null,
		});
	}
	// Grouped by family, free first inside a family, then cheapest input.
	const priceOf = (r) => (r.price_usd_per_mtok ? r.price_usd_per_mtok[0] : Number.POSITIVE_INFINITY);
	rows.sort((a, b) => a.family.localeCompare(b.family) || Number(b.free) - Number(a.free) || priceOf(a) - priceOf(b));
	return rows;
}

/**
 * The live catalog.
 * @param {{ health?: 'cached'|'live'|'none' }} [opts] `live` probes the roster
 *   (cached five minutes, llm-health.js); `cached` reads the last probe only.
 */
export async function listCatalogModels({ health = 'cached' } = {}) {
	const [{ getAvailableProviders }, llmHealth] = await Promise.all([
		import('../brain/chat.js'),
		import('./llm-health.js'),
	]);
	let report = null;
	if (health === 'live') report = await llmHealth.probeRosterHealth().catch(() => null);
	else if (health === 'cached') report = await llmHealth.cachedRosterHealth().catch(() => null);
	return {
		models: buildCatalogRows(getAvailableProviders(), report),
		health_checked_at: report?.checkedAt || null,
	};
}

/**
 * The free-tier allowance as the public sees it: messages per UTC day for a
 * signed-in account and for a signed-out visitor, and which models draw on it.
 */
export async function freeTierAllowance() {
	const [{ getFreeTierSettings }, { freeRosterIds }] = await Promise.all([
		import('./free-tier.js'),
		import('./model-roster.js'),
	]);
	const settings = await getFreeTierSettings();
	return {
		daily_messages: settings.daily_messages,
		anon_daily_messages: settings.anon_daily_messages,
		resets: '00:00 UTC',
		models: freeRosterIds(),
	};
}
