import { sql } from '../_lib/db.js';
import { env } from '../_lib/env.js';
import { cors, json, method, wrap, error, readJson } from '../_lib/http.js';
import { z } from 'zod';

const DEFAULTS = {
	name: 'three.ws chat',
	logo_url: null,
	accent_color: '#6366f1',
	tagline: 'Chat with any AI model',
	default_model: 'meta-llama/llama-3.3-70b-instruct:free',
	agent_id: null,
};

const bodySchema = z.object({
	name: z.string().trim().min(1).max(100),
	logo_url: z.string().url().max(500).nullable().optional(),
	accent_color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366f1'),
	tagline: z.string().trim().max(200).optional(),
	default_model: z.string().trim().min(1).max(100).optional(),
	agent_id: z.string().trim().max(100).nullable().optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS' })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	// GET — fully public, returns current brand config
	if (req.method === 'GET') {
		const [row] = await sql`SELECT name, logo_url, accent_color, tagline, default_model, agent_id FROM chat_brand_config WHERE key = 'global'`;
		return json(res, 200, { data: row ?? DEFAULTS });
	}

	// POST — admin key required
	const adminKey = env.CHAT_ADMIN_KEY;
	if (!adminKey) return error(res, 503, 'not_configured', 'CHAT_ADMIN_KEY is not set');

	const provided = (req.headers['x-admin-key'] || '').trim();
	if (!provided || provided !== adminKey)
		return error(res, 403, 'forbidden', 'invalid admin key');

	let body;
	try {
		const raw = await readJson(req);
		const result = bodySchema.safeParse(raw);
		if (!result.success) return error(res, 400, 'validation_error', result.error.issues[0]?.message ?? 'invalid body');
		body = result.data;
	} catch (err) {
		return error(res, err.status ?? 400, 'bad_request', err.message);
	}

	const [row] = await sql`
		UPDATE chat_brand_config
		SET
			name          = ${body.name},
			logo_url      = ${body.logo_url ?? null},
			accent_color  = ${body.accent_color},
			tagline       = ${body.tagline ?? DEFAULTS.tagline},
			default_model = ${body.default_model ?? DEFAULTS.default_model},
			agent_id      = ${body.agent_id ?? null},
			updated_at    = now()
		WHERE key = 'global'
		RETURNING name, logo_url, accent_color, tagline, default_model, agent_id, updated_at
	`;

	return json(res, 200, { data: row });
});
