// Builder competitions.
//
//   GET  /api/competitions                    every configured competition, with its phase
//   GET  /api/competitions/:slug              one competition, its ranked entries, and the viewer's entries
//   GET  /api/competitions/:slug/entries      the ranked public entries
//   POST /api/competitions/:slug/entries      register one of the caller's agents (session or key, CSRF-guarded)
//
// The competitions come from data/competitions.json (empty until the owner adds
// one). Docs: docs/competitions.md.

import { z } from 'zod';
import { cors, json, error, wrap, method, readJson, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { getRequestUser, getSessionUser } from './_lib/auth.js';
import { requireCsrf } from './_lib/csrf.js';
import { parse } from './_lib/validate.js';
import {
	loadCompetitions,
	describeCompetition,
	listEntries,
	rankingMethod,
	registerEntry,
	viewerEntries,
	RegistrationError,
} from './_lib/competitions.js';

const entrySchema = z.object({
	agent_id: z.string().uuid(),
	team_name: z.string().trim().max(80).optional(),
	x_handle: z
		.string()
		.trim()
		.regex(/^@?[A-Za-z0-9_]{1,15}$/, 'x_handle must be a valid X handle')
		.transform((h) => h.replace(/^@/, ''))
		.optional(),
	track: z.string().trim().max(80).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', origins: '*' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const url = new URL(req.url, 'http://x');
	const slug = url.searchParams.get('slug');
	const part = url.searchParams.get('part');

	let competitions;
	try {
		competitions = loadCompetitions();
	} catch (e) {
		return error(res, 500, 'competitions_config_invalid', e.message);
	}

	if (!slug) {
		if (req.method !== 'GET') return error(res, 405, 'method_not_allowed', 'use GET');
		res.setHeader('cache-control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
		return json(res, 200, { competitions: competitions.map((c) => describeCompetition(c)) });
	}

	const comp = competitions.find((c) => c.slug === slug);
	if (!comp) return error(res, 404, 'not_found', 'competition not found');

	if (req.method === 'POST') {
		if (part !== 'entries') return error(res, 405, 'method_not_allowed', 'POST to /entries');
		const rl = await limits.authIp(clientIp(req));
		if (!rl.success) return rateLimited(res, rl);
		const user = await getRequestUser(req, res);
		if (!user) return error(res, 401, 'unauthorized', 'sign in to enter');
		if (!(await requireCsrf(req, res, user.id))) return;
		const body = parse(entrySchema, await readJson(req));
		try {
			const row = await registerEntry(comp, user.id, body);
			return json(res, 201, { entry: { id: row.id, competition: comp.slug, agent_id: body.agent_id, registered_at: row.created_at } });
		} catch (e) {
			if (e instanceof RegistrationError) return error(res, e.status, e.code, e.message);
			throw e;
		}
	}

	const { entries, refreshed_at } = await listEntries(comp);
	if (part === 'entries') {
		res.setHeader('cache-control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
		return json(res, 200, { competition: comp.slug, entries, refreshed_at, method: rankingMethod(comp) });
	}

	const viewer = await getSessionUser(req).catch(() => null);
	const mine = viewer ? await viewerEntries(comp.slug, viewer.id) : [];
	res.setHeader('cache-control', viewer ? 'private, no-store' : 'public, max-age=30, s-maxage=60, stale-while-revalidate=120');
	return json(res, 200, {
		competition: describeCompetition(comp),
		entries,
		refreshed_at,
		method: rankingMethod(comp),
		viewer: viewer ? { signed_in: true, entered_agent_ids: mine } : { signed_in: false, entered_agent_ids: [] },
	});
});
