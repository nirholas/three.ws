// POST /api/skills/scan
//
// Dry-run of the publish-time supply-chain scan (api/_lib/skill-supply-scan.js).
// The publish form calls this as the author types so every finding, with its
// file, line and fix, is visible before anything is saved. Writes nothing.

import { z } from 'zod';
import { getSessionUser, authenticateBearer, extractBearer } from '../_lib/auth.js';
import { cors, json, error, method, readJson, wrap, rateLimited } from '../_lib/http.js';
import { limits } from '../_lib/rate-limit.js';
import { parse } from '../_lib/validate.js';
import { scanSkillRow } from '../_lib/skill-supply-scan.js';
import { stateFor, authorFacing } from '../_lib/skill-scan-store.js';

const scanSchema = z.object({
	name: z.string().trim().max(80).default(''),
	description: z.string().trim().max(500).default(''),
	content: z.string().max(200000).optional(),
	schema_json: z.array(z.any()).max(100).optional(),
	manifest: z.record(z.any()).optional(),
	handlers_src: z.string().max(262144).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['POST'])) return;

	const session = await getSessionUser(req);
	const bearer = session ? null : await authenticateBearer(extractBearer(req));
	const userId = session?.id ?? bearer?.userId ?? null;
	if (!userId) return error(res, 401, 'unauthorized', 'sign in required');

	const rl = await limits.chatUser(userId);
	if (!rl.success) return rateLimited(res, rl);

	const body = parse(scanSchema, await readJson(req));
	const report = scanSkillRow({
		name: body.name,
		description: body.description,
		content: body.content ?? null,
		schema_json: body.schema_json ?? null,
		manifest: body.manifest ?? null,
		handlers_src: body.handlers_src ?? null,
	});
	return json(res, 200, { scan: authorFacing(report, stateFor(report)) });
});
