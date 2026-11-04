// threews-agent MCP: the human-tasks escrow marketplace.
//
// An agent posts a real-world job (photograph a storefront, check a price on
// the shelf, run an errand) with a USDC bounty held in a per-task escrow on
// Solana. A person accepts it, submits proof, and is paid when the poster
// approves. Every tool is a thin adapter over api/_lib/human-tasks/service.js,
// the same layer the REST API and the /tasks pages use.
//
// Money gates: human_task_post spends (escrow funding) and needs a fresh
// human_task_quote id plus confirm_spend. human_task_approve releases escrow and
// needs the preview id human_task_approve_preview issued. human_task_cancel
// refunds escrow and needs confirm_cancel. The service enforces each of these
// itself; the policy layer enforces enablement and the confirm flag.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import * as svc from '../_lib/human-tasks/service.js';

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

function ok(text, data) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: true, ...data } };
}

async function enforce(limiter, auth) {
	const rl = await limiter(auth.userId || auth.rateKey || 'anon');
	if (!rl.success) {
		throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
	}
}

async function run(auth, { scope = null, signIn = true, pay = false }, fn) {
	await enforce(pay ? limits.mcpAgentPay : limits.mcpAgent, auth);
	if (signIn && !auth.userId) return refusal('Sign in to three.ws to use human tasks.', 'auth_required', { signed_in: false });
	if (scope && !hasScope(auth.scope, scope)) {
		return refusal(`This action needs the ${scope} scope. Re-authorize with it granted.`, 'insufficient_scope', { required: scope });
	}
	try {
		return await fn(auth.userId ? { id: auth.userId } : null);
	} catch (err) {
		if (err?.expose && err.code) return refusal(err.message, err.code, err.requirement ? { requirement: err.requirement } : {});
		throw err;
	}
}

const ann = (readOnly, destructive, idempotent) => ({
	readOnlyHint: readOnly, destructiveHint: destructive, idempotentHint: idempotent, openWorldHint: true,
});

const uuid = { type: 'string', format: 'uuid' };

const taskLine = (t) =>
	`${t.title}: ${t.bounty_usdc} USDC, ${t.status_label}${t.location?.label ? `, ${t.location.label}` : ''}\n   task ${t.id}  https://three.ws/tasks/${t.id}`;

const postArgs = {
	agent_id: { ...uuid, description: 'Your agent that funds the task from its Solana wallet.' },
	title: { type: 'string', minLength: 3, maxLength: 120 },
	instructions: { type: 'string', minLength: 10, maxLength: 4000, description: 'Exactly what the person must do.' },
	category: { type: 'string', enum: [...svc.CATEGORIES] },
	bounty_usdc: { type: ['string', 'number'], description: 'Decimal USDC paid to the worker, e.g. "12.50".' },
	deadline_hours: { type: 'number', minimum: svc.MIN_DEADLINE_HOURS, maximum: svc.MAX_DEADLINE_HOURS, description: 'Hours until the task expires unclaimed or unfinished.' },
	location_kind: { type: 'string', enum: ['remote', 'onsite'] },
	location_label: { type: 'string', maxLength: 160 },
	lat: { type: 'number', minimum: -90, maximum: 90 },
	lng: { type: 'number', minimum: -180, maximum: 180 },
	radius_m: { type: 'integer', minimum: 25, maximum: 50000, description: 'How close to the point the proof photo must be taken (on-site tasks).' },
	min_verification: { type: 'integer', enum: [0, 1, 2], description: 'Minimum worker level. Defaults by bounty size.' },
	proof_requirements: { type: 'string', maxLength: 1000 },
};

export const humanTaskToolDefs = [
	{
		name: 'human_task_list',
		title: 'Browse human tasks',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'List real-world tasks that agents have posted with an escrowed USDC bounty, each with its category, bounty, location, deadline and the minimum worker level. Read-only. Use this to see open work, or pass mine: true to list the tasks your own agents posted.',
		inputSchema: {
			type: 'object',
			properties: {
				q: { type: 'string', maxLength: 80 },
				category: { type: 'string', enum: [...svc.CATEGORIES] },
				lat: { type: 'number' },
				lng: { type: 'number' },
				radius_km: { type: 'number', minimum: 0.1, maximum: 20000 },
				mine: { type: 'boolean', description: 'List the tasks you posted instead of the public board.' },
				limit: { type: 'integer', minimum: 1, maximum: 48 },
			},
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { signIn: Boolean(args.mine) }, async (user) => {
				if (args.mine) {
					const mine = await svc.myPostedTasks(user, { limit: args.limit || 50 });
					return ok(mine.items.length ? mine.items.map((t, i) => `${i + 1}. ${taskLine(t)}`).join('\n') : 'You have not posted any tasks yet. Price one with human_task_quote.', mine);
				}
				const r = await svc.browseTasks({ q: args.q || '', category: args.category || null, lat: args.lat ?? null, lng: args.lng ?? null, radius_km: args.radius_km ?? null, limit: args.limit || 24 });
				return ok(r.items.length ? r.items.map((t, i) => `${i + 1}. ${taskLine(t)}`).join('\n') : 'No open tasks right now. Price one with human_task_quote.', r);
			});
		},
	},
	{
		name: 'human_task_status',
		title: 'Get a human task',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(true, false, false),
		description: 'Full detail for one task: state, bounty, escrow address, the worker\'s submitted proof and notes, the dispute if any, the settlement signatures, and the event timeline. Read-only. Use this before approving, disputing or cancelling, and to follow a task you posted.',
		inputSchema: { type: 'object', properties: { task_id: uuid }, required: ['task_id'], additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { signIn: false }, async (user) => {
				const d = await svc.getTaskDetail(args.task_id, user?.id || null);
				const acts = [...(d.viewer?.poster_actions || []), ...(d.viewer?.worker_actions || [])];
				return ok(`${taskLine(d)}\nYour role: ${d.viewer?.role}. Actions available to you: ${acts.join(', ') || 'none'}`, { task: d });
			});
		},
	},
	{
		name: 'human_task_quote',
		title: 'Price a human task',
		group: 'marketplace',
		tier: 'read',
		annotations: ann(false, false, false),
		description: 'Price a task before posting it: returns the confirmation table (bounty, platform fee, total locked in escrow, refund terms, deadline) and a quote_id valid ten minutes. Moves no funds. Show the table to the user, then call human_task_post with confirm_spend: true and the quote_id only after a clear yes.',
		inputSchema: { type: 'object', properties: postArgs, required: ['agent_id', 'title', 'instructions', 'bounty_usdc', 'deadline_hours'], additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { scope: 'agents:read' }, async (user) => {
				const q = await svc.quoteTask(user, args);
				return ok(`${q.text}\n\nQuote ${q.quote_id} expires ${q.expires_at}. Nothing has been spent.`, q);
			});
		},
	},
	{
		name: 'human_task_post',
		title: 'Post a human task',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_spend',
		previewTool: 'human_task_quote',
		annotations: ann(false, false, false),
		description: 'Post the task and lock its bounty plus fee in escrow from your agent\'s Solana wallet. Spends real USDC. Refuses unless confirm_spend is exactly true and quote_id is a fresh id from human_task_quote that the user has seen and approved. The escrow refunds in full if nobody completes the task.',
		inputSchema: {
			type: 'object',
			properties: {
				quote_id: { type: 'string', description: 'The quote_id human_task_quote returned (valid ten minutes, single use).' },
				confirm_spend: { type: 'boolean', description: 'Must be exactly true, only after the user approved the quote table.' },
			},
			required: ['quote_id', 'confirm_spend'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'wallet:write', pay: true }, async (user) => {
				if (args.confirm_spend !== true) {
					return refusal('This locks real USDC in escrow. Call human_task_quote first, show the user its table, and only after a clear yes call again with confirm_spend: true and the quote_id.', 'confirmation_required', { confirm_flag: 'confirm_spend', preview_tool: 'human_task_quote' });
				}
				const r = await svc.postTask(user, { quote_id: args.quote_id, confirm: true });
				return ok(`Task posted and funded: https://three.ws/tasks/${r.task?.id || ''}`, r);
			});
		},
	},
	{
		name: 'human_task_approve_preview',
		title: 'Preview a task payout',
		group: 'marketplace',
		tier: 'write',
		annotations: ann(false, false, false),
		description: 'Show the payout table for a task whose proof was submitted: who gets the bounty, the platform fee, and the escrow it releases. Moves no funds. Issues a preview_id valid ten minutes. Show the table to the user, then call human_task_approve with confirm_release: true and that preview_id only after a clear yes.',
		inputSchema: { type: 'object', properties: { task_id: uuid }, required: ['task_id'], additionalProperties: false },
		async handler(args, auth) {
			return run(auth, { scope: 'agents:write' }, async (user) => {
				const p = await svc.previewApprove(user, args.task_id);
				return ok(`${p.text}\n\nPreview ${p.preview_id} expires ${p.expires_at}. Nothing has been paid.`, p);
			});
		},
	},
	{
		name: 'human_task_approve',
		title: 'Approve a human task',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_release',
		previewTool: 'human_task_approve_preview',
		annotations: ann(false, true, false),
		description: 'Approve the submitted proof and pay the worker from escrow. Moves real USDC and cannot be undone. Refuses unless confirm_release is exactly true and preview_id is the fresh id human_task_approve_preview issued for this task. If the proof is wrong, call human_task_dispute instead.',
		inputSchema: {
			type: 'object',
			properties: { task_id: uuid, preview_id: { type: 'string' }, confirm_release: { type: 'boolean', description: 'Must be exactly true, only after the user approved the payout table.' } },
			required: ['task_id', 'preview_id', 'confirm_release'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'wallet:write', pay: true }, async (user) => {
				if (args.confirm_release !== true) {
					return refusal('This releases escrow to the worker. Call human_task_approve_preview, show the user the table, and only after a clear yes call again with confirm_release: true and the preview_id.', 'confirmation_required', { confirm_flag: 'confirm_release', preview_tool: 'human_task_approve_preview' });
				}
				const r = await svc.approveTask(user, args.task_id, { confirm: true, preview_id: args.preview_id });
				return ok(`Approved. Payout is settling: https://three.ws/tasks/${args.task_id}`, r);
			});
		},
	},
	{
		name: 'human_task_cancel',
		title: 'Cancel a human task',
		group: 'marketplace',
		tier: 'financial',
		confirmFlag: 'confirm_cancel',
		previewTool: 'human_task_status',
		annotations: ann(false, true, false),
		description: 'Cancel a task nobody has accepted yet and refund the whole escrow (bounty plus fee) to the funding wallet. Moves real USDC. Refuses unless confirm_cancel is exactly true. A task someone already accepted cannot be cancelled: dispute it after proof is submitted instead.',
		inputSchema: {
			type: 'object',
			properties: { task_id: uuid, confirm_cancel: { type: 'boolean', description: 'Must be exactly true, only after the user agreed to cancel.' } },
			required: ['task_id', 'confirm_cancel'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'wallet:write', pay: true }, async (user) => {
				if (args.confirm_cancel !== true) {
					return refusal('Cancelling refunds the escrow. Show the user the task from human_task_status, and only after a clear yes call again with confirm_cancel: true.', 'confirmation_required', { confirm_flag: 'confirm_cancel', preview_tool: 'human_task_status' });
				}
				const r = await svc.cancelTask(user, args.task_id, { confirm: true });
				return ok('Task cancelled. The escrow refund is settling to the funding wallet.', r);
			});
		},
	},
	{
		name: 'human_task_dispute',
		title: 'Dispute a human task',
		group: 'marketplace',
		tier: 'write',
		annotations: ann(false, false, false),
		description: 'Dispute submitted proof inside the review window. Freezes the payout until an admin resolves it; moves no funds itself. State plainly what is wrong with the proof. Use this instead of approving when the work does not match the instructions.',
		inputSchema: {
			type: 'object',
			properties: { task_id: uuid, reason: { type: 'string', minLength: 10, maxLength: 2000 } },
			required: ['task_id', 'reason'],
			additionalProperties: false,
		},
		async handler(args, auth) {
			return run(auth, { scope: 'agents:write' }, async (user) => {
				const r = await svc.disputeTask(user, args.task_id, { reason: args.reason });
				return ok('Dispute opened. The payout is frozen until it is resolved.', r);
			});
		},
	},
];
