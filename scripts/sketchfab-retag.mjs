#!/usr/bin/env node
// Backfill Sketchfab's "Created With AI" tag (slug `createdwithai`) onto models the
// three.ws showcase account uploaded before commit 919e54e82 (2026-10-09), when new
// uploads started carrying it. Dry run by default; --apply performs the edits.
//
// USAGE
//   node scripts/sketchfab-retag.mjs --user <sketchfab-username>        # dry run, public listing
//   SKETCHFAB_API_TOKEN=... node scripts/sketchfab-retag.mjs             # dry run, own account (/v3/me/models)
//   SKETCHFAB_API_TOKEN=... node scripts/sketchfab-retag.mjs --apply     # make the changes
//
// The token is the same Data API token the showcase cron uses. Get it with:
//   eval "$(node scripts/read-service-env.mjs '^SKETCHFAB_API_TOKEN$')"
//
// Only the `tags` field is sent. Sketchfab's PATCH /v3/models/{uid} replaces the whole
// tag list, so the request carries every existing tag plus `createdwithai`, in the
// original order, and nothing else about the model is touched.

import { pathToFileURL } from 'node:url';

export const AI_TAG = 'createdwithai';
const API_BASE = 'https://api.sketchfab.com/v3';
const PAGE_SIZE = 24;
const MAX_RETRIES = 5;

export function tagNames(model) {
	return (model.tags || []).map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean);
}

export function hasAiTag(model) {
	return tagNames(model).some((n) => n.toLowerCase() === AI_TAG);
}

// The exact PATCH body for a model, or null when it already carries the tag.
export function buildPatch(model) {
	if (hasAiTag(model)) return null;
	return { tags: [...tagNames(model), AI_TAG] };
}

// Plan the whole backfill: what would change and what is already compliant.
export function planRetag(models) {
	const changes = [];
	let compliant = 0;
	for (const m of models) {
		const body = buildPatch(m);
		if (body) changes.push({ uid: m.uid, name: m.name, url: m.viewerUrl, body });
		else compliant++;
	}
	return { changes, compliant, total: models.length };
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

// fetch that honours Sketchfab's 429 Retry-After (seconds) with a bounded retry budget.
export async function sfFetch(url, init = {}, fetchImpl = fetch, wait = sleep) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetchImpl(url, init);
		if (res.status !== 429 || attempt >= MAX_RETRIES) return res;
		const retryAfter = Number(res.headers.get('retry-after'));
		await wait((Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000);
	}
}

export async function listModels({ token, user }, fetchImpl = fetch, wait = sleep) {
	const headers = token ? { authorization: `Token ${token}` } : {};
	let url = token && !user
		? `${API_BASE}/me/models?count=${PAGE_SIZE}`
		: `${API_BASE}/models?user=${encodeURIComponent(user)}&count=${PAGE_SIZE}`;
	const models = [];
	while (url) {
		const res = await sfFetch(url, { headers }, fetchImpl, wait);
		if (!res.ok) throw new Error(`list failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
		const body = await res.json();
		models.push(...(body.results || []));
		url = body.next || null;
	}
	return models;
}

export async function applyChange(change, token, fetchImpl = fetch, wait = sleep) {
	const res = await sfFetch(
		`${API_BASE}/models/${encodeURIComponent(change.uid)}`,
		{
			method: 'PATCH',
			headers: { authorization: `Token ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify(change.body),
		},
		fetchImpl,
		wait,
	);
	if (res.status !== 200 && res.status !== 204) {
		throw new Error(`patch ${change.uid} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
	}
}

async function main() {
	const argv = process.argv.slice(2);
	const apply = argv.includes('--apply');
	const ui = argv.indexOf('--user');
	const user = ui >= 0 ? argv[ui + 1] : null;
	const token = process.env.SKETCHFAB_API_TOKEN || null;
	if (!token && !user) {
		console.error('Set SKETCHFAB_API_TOKEN (own account) or pass --user <username> (public dry run).');
		process.exit(2);
	}
	if (apply && !token) {
		console.error('--apply needs SKETCHFAB_API_TOKEN.');
		process.exit(2);
	}

	const models = await listModels({ token, user });
	const plan = planRetag(models);
	console.log(`${plan.total} models listed, ${plan.compliant} already tagged, ${plan.changes.length} to change.`);
	for (const c of plan.changes) {
		console.log(`${apply ? 'PATCH' : 'would PATCH'} ${c.uid} "${c.name}" tags -> ${JSON.stringify(c.body.tags)}`);
		if (apply) await applyChange(c, token);
	}
	if (!apply && plan.changes.length) console.log('Dry run. Re-run with --apply to make these changes.');
	if (apply) console.log(`Applied ${plan.changes.length} changes. Re-run without --apply: it should report 0 to change.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
	main().catch((e) => {
		console.error(e.message);
		process.exit(1);
	});
}
