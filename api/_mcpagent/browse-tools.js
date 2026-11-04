// threews-agent MCP: send an agent to browse the web.
//
//   write  browse_web
//
// Queues a goal on the agent-screen pool. A real Chromium page opens the start
// URL and the agent works toward the goal one validated action at a time
// (click, type, scroll, goto, extract, done), streaming screenshots to the
// agent's screen page where the owner can watch and take over. The run is
// confined to the allowed domains, never enters credentials or payment pages,
// and stops at the step, time and token caps. Write tier: it opens pages on the
// owner's behalf and the agent may submit forms on allowed sites.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { BrowseError, enqueueBrowse, readBrowse } from '../_lib/agent-screen-browse.js';

const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const WAIT_MS = 45_000;
const POLL_MS = 1500;
const FINAL = new Set(['done', 'yielded', 'step_cap', 'time_cap', 'token_cap', 'policy_stop', 'denied', 'aborted', 'error']);

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const browseToolDefs = [
	{
		name: 'browse_web',
		title: 'Send an agent to browse the web',
		group: 'agents',
		tier: 'write',
		annotations: WRITE,
		description:
			"Have one of the user's agents browse the web toward a goal in a real browser they can watch live at three.ws/agent-screen and take over at any time. The agent reads the page, then clicks, types, scrolls, opens links and extracts text, one step at a time, and reports what it found. It stays inside the allowed domains (default: the start URL's site), never enters passwords, codes or payment details, never opens checkout or banking pages, and stops at max_steps. Use it for research and lookups on public sites. It returns the result if the run finishes within about 45 seconds, otherwise a job_id and the watch link.",
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { type: 'string', description: 'The id of the agent that will do the browsing. It must belong to the signed-in user.' },
				goal: { type: 'string', minLength: 5, maxLength: 500, description: 'What to find out or do, in one or two sentences.' },
				start_url: { type: 'string', description: 'Public http(s) page to begin on.' },
				max_steps: { type: 'integer', minimum: 1, maximum: 30, description: 'Action budget. Default 12.' },
				allowed_domains: { type: 'array', maxItems: 20, items: { type: 'string' }, description: 'Domains the agent may visit, subdomains included. Default: the start URL host.' },
			},
			required: ['agent_id', 'goal', 'start_url'],
			additionalProperties: false,
		},
		handler: async (args, auth) => {
			const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
			if (!rl.success) {
				throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
			}
			if (!auth.userId) return refusal('Sign in to three.ws to send an agent browsing.', 'auth_required', { signed_in: false });
			if (!hasScope(auth.scope, 'agents:write')) {
				return refusal('Browsing needs the agents:write scope. Re-authorize with it granted.', 'insufficient_scope', { required: 'agents:write' });
			}
			let job;
			try {
				job = await enqueueBrowse({
					userId: auth.userId, agentId: args.agent_id, goal: args.goal, startUrl: args.start_url,
					allowedDomains: args.allowed_domains, maxSteps: args.max_steps,
				});
			} catch (err) {
				if (err instanceof BrowseError) return refusal(err.message, err.code);
				throw err;
			}
			const watch = `https://three.ws/agent-screen?agentId=${encodeURIComponent(job.agentId)}`;
			const deadline = Date.now() + WAIT_MS;
			let view = null;
			while (Date.now() < deadline) {
				await sleep(POLL_MS);
				view = await readBrowse({ jobId: job.id, userId: auth.userId }).catch(() => null);
				if (view && FINAL.has(view.status)) break;
			}
			const finished = !!view && FINAL.has(view.status);
			const steps = (view?.steps || []).map((s) => ({ n: s.n, type: s.type, action: s.action, note: s.note, reason: s.reason }));
			const text = finished
				? view.status === 'done'
					? `The agent finished: ${view.result}`
					: `The run stopped (${view.status}). Steps taken: ${steps.length}.`
				: `The run is in progress. Watch it at ${watch}.`;
			return {
				content: [{ type: 'text', text }],
				structuredContent: { ok: true, job_id: job.id, status: view?.status || 'queued', finished, result: view?.result ?? null, steps, watch_url: watch },
			};
		},
	},
];
