/**
 * External skill import: browse public SKILL.md registries, scan a skill,
 * install it after the owner approves, check for upstream updates, fork and
 * publish. Logic lives in api/_lib/skill-import-store.js; docs in
 * docs/skill-import.md.
 *
 * Routes (vercel.json rewrites /api/skill-imports/<route> → ?route=<route>):
 *   GET    browse?registry=&category=&q=        listed skills, categories, install counts,
 *                                               and what was excluded and why (public)
 *   GET    registries                           built-in + your added registries
 *   POST   registries { registry, label? }      add a GitHub repo or manifest URL
 *   DELETE registries?key=                      remove one you added
 *   POST   scan { agent_id, registry, skill }   fetch at the pin, scan, open a request
 *   GET    requests[?status=]                   your import requests
 *   GET    requests/:id                         one request with the full scan
 *   POST   requests/:id { decision, acknowledge_gated? }
 *                                               approve installs the scanned bytes;
 *                                               refuse closes it
 *   POST   updates { agent_id, skill_id, open_request? }
 *                                               diff an installed skill against upstream
 *   POST   fork { agent_id, skill_id | published_slug, name? }
 *   POST   publish { agent_id, skill_id, license, category, confirm_publish: true }
 *   GET    publications                         what you have published
 *   DELETE publications?slug=                   unpublish
 *   GET    published/manifest.json              the three.ws registry manifest (public)
 *   GET    published/:slug/SKILL.md             one published skill (public)
 *
 * Owner routes accept the session cookie (mutations carry CSRF) or a bearer
 * token with agents:read / agents:write.
 */

import { getRequestUser, hasScope } from './_lib/auth.js';
import { cors, json, text, wrap, error, readJson, rateLimited } from './_lib/http.js';
import { limits, clientIp } from './_lib/rate-limit.js';
import { requireCsrf } from './_lib/csrf.js';
import { CustomSkillError } from './_lib/agent-custom-skills.js';
import { CATEGORIES } from './_lib/skill-import-sources.js';
import {
	registryAddSchema,
	scanSchema,
	decideSchema,
	forkSchema,
	publishSchema,
	listRegistries,
	addRegistry,
	removeRegistry,
	browse,
	scanForInstall,
	getRequest,
	listRequests,
	decideRequest,
	updateDiff,
	forkSkill,
	publishSkill,
	unpublishSkill,
	listMyPublications,
	publishedManifest,
	publishedSkillFile,
} from './_lib/skill-import-store.js';

const PUBLIC_CACHE = { 'cache-control': 'public, max-age=60, s-maxage=60' };

function invalid(res, parsed) {
	return error(res, 400, 'validation_error', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
}

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,DELETE,OPTIONS', credentials: true })) return;

	const url = new URL(req.url, 'http://x');
	const route = (url.searchParams.get('route') || '').replace(/^\/+|\/+$/g, '');
	const seg = route.split('/').filter(Boolean);

	try {
		// Public: the published registry, readable by any importer.
		if (seg[0] === 'published' && req.method === 'GET') {
			if (seg[1] === 'manifest.json' && seg.length === 2) {
				const origin = `https://${req.headers['x-forwarded-host'] || req.headers.host || 'three.ws'}`;
				return json(res, 200, await publishedManifest(origin.includes('localhost') ? 'https://three.ws' : origin), PUBLIC_CACHE);
			}
			if (seg.length === 3 && seg[2] === 'SKILL.md') {
				const body = await publishedSkillFile(seg[1]);
				if (body == null) return error(res, 404, 'not_found', 'no published skill with that slug');
				return text(res, 200, body, { ...PUBLIC_CACHE, 'content-type': 'text/markdown; charset=utf-8' });
			}
			return error(res, 404, 'not_found', 'unknown published path');
		}

		// Browse is public for the built-in registries; signed-in owners also see theirs.
		if (seg[0] === 'browse' && req.method === 'GET') {
			const rl = await limits.skillImportBrowseIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			const user = await getRequestUser(req, res);
			const category = url.searchParams.get('category');
			if (category && !CATEGORIES.includes(category)) return error(res, 400, 'validation_error', `category is one of ${CATEGORIES.join(', ')}`);
			const data = await browse(user?.id || null, {
				registry: url.searchParams.get('registry') || null,
				category: category || null,
				q: url.searchParams.get('q')?.slice(0, 100) || null,
			});
			return json(res, 200, { data });
		}

		const write = req.method !== 'GET';
		const user = await getRequestUser(req, res);
		if (!user) return error(res, 401, 'unauthorized', 'sign in or send a bearer token');
		if (user.source === 'bearer' && !hasScope(user.scope, write ? 'agents:write' : 'agents:read')) {
			return error(res, 403, 'insufficient_scope', `this token needs ${write ? 'agents:write' : 'agents:read'}`);
		}
		if (write) {
			const rl = await limits.authIp(clientIp(req));
			if (!rl.success) return rateLimited(res, rl);
			if (!(await requireCsrf(req, res, user.id))) return;
		}

		switch (`${req.method} ${seg[0] || ''}`) {
			case 'GET registries':
				return json(res, 200, { data: { registries: (await listRegistries(user.id)).map(publicRegistry) } });
			case 'POST registries': {
				const parsed = registryAddSchema.safeParse(await readJson(req));
				if (!parsed.success) return invalid(res, parsed);
				return json(res, 201, { data: await addRegistry(user.id, parsed.data) });
			}
			case 'DELETE registries': {
				const key = url.searchParams.get('key');
				if (!key) return error(res, 400, 'validation_error', 'key is required');
				return json(res, 200, { data: await removeRegistry(user.id, key) });
			}
			case 'POST scan': {
				const parsed = scanSchema.safeParse(await readJson(req));
				if (!parsed.success) return invalid(res, parsed);
				const rl = await limits.skillImportScanUser(user.id);
				if (!rl.success) return rateLimited(res, rl);
				const request = await scanForInstall(user.id, parsed.data);
				return json(res, 201, { data: { request } });
			}
			case 'GET requests': {
				if (seg[1]) return json(res, 200, { data: { request: await getRequest(user.id, seg[1]) } });
				const status = url.searchParams.get('status');
				if (status && !['pending', 'approved', 'refused'].includes(status)) return error(res, 400, 'validation_error', 'status is pending, approved or refused');
				return json(res, 200, { data: { requests: await listRequests(user.id, { status }) } });
			}
			case 'POST requests': {
				if (!seg[1]) return error(res, 400, 'validation_error', 'request id required');
				const parsed = decideSchema.safeParse(await readJson(req));
				if (!parsed.success) return invalid(res, parsed);
				return json(res, 200, { data: await decideRequest(user.id, seg[1], parsed.data) });
			}
			case 'POST updates': {
				const body = (await readJson(req)) || {};
				const rl = await limits.skillImportScanUser(user.id);
				if (!rl.success) return rateLimited(res, rl);
				return json(res, 200, {
					data: await updateDiff(user.id, { agent_id: body.agent_id, skill_id: body.skill_id, open_request: body.open_request !== false }),
				});
			}
			case 'POST fork': {
				const parsed = forkSchema.safeParse(await readJson(req));
				if (!parsed.success) return invalid(res, parsed);
				return json(res, 201, { data: await forkSkill(user.id, parsed.data) });
			}
			case 'POST publish': {
				const parsed = publishSchema.safeParse(await readJson(req));
				if (!parsed.success) return invalid(res, parsed);
				return json(res, 200, { data: await publishSkill(user.id, parsed.data) });
			}
			case 'GET publications':
				return json(res, 200, { data: { publications: await listMyPublications(user.id) } });
			case 'DELETE publications': {
				const slug = url.searchParams.get('slug');
				if (!slug) return error(res, 400, 'validation_error', 'slug is required');
				return json(res, 200, { data: await unpublishSkill(user.id, slug) });
			}
			default:
				return error(res, 404, 'not_found', 'unknown skill-imports route');
		}
	} catch (err) {
		if (err instanceof CustomSkillError) return error(res, err.status, err.code, err.message, err.extra);
		throw err;
	}
});

function publicRegistry(r) {
	return { key: r.key, kind: r.kind, label: r.label, url: r.url, builtin: !!r.builtin, added_at: r.added_at || null };
}
