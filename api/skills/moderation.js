// GET  /api/skills/moderation   the queue of skills the scanner held for review
// POST /api/skills/moderation   { id, decision: 'approve' | 'reject', note? }
//
// Admin only. A skill lands here when its supply-chain scan verdict is
// `review` (api/_lib/skill-supply-scan.js). The queue carries the findings
// with file, line and fix guidance and the handler source, so a moderator
// decides on the evidence. Blocked skills never appear and cannot be approved.

import { z } from 'zod';
import { requireAdmin } from '../_lib/admin.js';
import { cors, json, error, method, readJson, wrap } from '../_lib/http.js';
import { parse, isUuid } from '../_lib/validate.js';
import { reviewQueue, moderate } from '../_lib/skill-scan-store.js';

const decisionSchema = z.object({
	id: z.string().refine(isUuid, 'id must be a skill uuid'),
	decision: z.enum(['approve', 'reject']),
	note: z.string().trim().max(1000).optional(),
});

export default wrap(async (req, res) => {
	if (cors(req, res, { methods: 'GET,POST,OPTIONS', credentials: true })) return;
	if (!method(req, res, ['GET', 'POST'])) return;

	const admin = await requireAdmin(req, res);
	if (!admin) return;

	if (req.method === 'GET') {
		const limit = Number(new URL(req.url, 'http://x').searchParams.get('limit')) || 50;
		const queue = await reviewQueue({ limit });
		return json(res, 200, { queue, count: queue.length });
	}

	const body = parse(decisionSchema, await readJson(req));
	const out = await moderate({ id: body.id, moderatorId: admin.id, decision: body.decision, note: body.note ?? null });
	if (out.status !== 200) return error(res, out.status, out.code, out.message);
	return json(res, 200, { skill: out.skill });
});
