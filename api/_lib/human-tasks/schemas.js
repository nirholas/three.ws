// Request bodies for the human-task REST routes. The MCP tools accept the same
// shapes (api/_mcpagent/human-task-tools.js), so a rule changed here changes both.

import { z } from 'zod';

import { CATEGORIES } from './service.js';

const uuid = z.string().uuid();
const amount = z.union([z.string().trim().min(1).max(24), z.number().positive()]).transform(String);

export const taskParams = z.object({
	agent_id: uuid,
	title: z.string().trim().min(3).max(120),
	instructions: z.string().trim().min(10).max(4000),
	category: z.enum(CATEGORIES).optional(),
	bounty_usdc: amount,
	deadline_hours: z.coerce.number().min(1).max(720),
	location_kind: z.enum(['remote', 'onsite']).optional(),
	location_label: z.string().trim().max(160).optional(),
	lat: z.coerce.number().min(-90).max(90).optional(),
	lng: z.coerce.number().min(-180).max(180).optional(),
	radius_m: z.coerce.number().int().min(25).max(50000).optional(),
	min_verification: z.coerce.number().int().min(0).max(2).optional(),
	proof_requirements: z.string().trim().max(1000).optional(),
	allow_external: z.boolean().optional(),
});

export const postBody = z.object({ quote_id: uuid, confirm: z.literal(true, { message: 'confirm must be true' }) });
export const claimBody = z.object({ payout_address: z.string().trim().max(64).optional(), note: z.string().trim().max(500).optional() });
export const uploadBody = z.object({ content_type: z.enum(['image/jpeg', 'image/png', 'image/webp']) });
export const submitBody = z.object({
	notes: z.string().trim().max(4000).optional(),
	photos: z.array(z.string().max(300)).max(8).optional(),
	lat: z.coerce.number().min(-90).max(90).optional(),
	lng: z.coerce.number().min(-180).max(180).optional(),
});
export const approveBody = z.object({ confirm: z.literal(true, { message: 'confirm must be true' }), preview_id: z.string().min(8).max(80) });
export const cancelBody = z.object({ confirm: z.literal(true, { message: 'confirm must be true' }) });
export const disputeBody = z.object({ reason: z.string().trim().min(10).max(2000) });
export const respondBody = z.object({ response: z.string().trim().min(1).max(2000) });
export const reviewBody = z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(1000).optional() });
export const resolveBody = z.object({
	outcome: z.enum(['worker', 'poster']),
	note: z.string().trim().max(2000).optional(),
	confirm: z.boolean().optional(),
	preview_id: z.string().max(80).optional(),
});

/** Parse a body or throw a designed 400. */
export function parseBody(schema, body) {
	const r = schema.safeParse(body ?? {});
	if (r.success) return r.data;
	const first = r.error.issues[0];
	const where = first.path.length ? `${first.path.join('.')}: ` : '';
	throw Object.assign(new Error(`${where}${first.message}`), { status: 400, code: 'validation_error', expose: true });
}
