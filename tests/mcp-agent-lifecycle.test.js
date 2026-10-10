// Agent lifecycle, run and automation tools over MCP (api/_mcp/tools/agent-lifecycle.js).
//
// Every call goes through the real /api/mcp dispatcher: the real policy gate
// (enablement, confirm flags, preview ids), the real scope check, Ajv on the
// real input schemas, and the real tool handlers. Agent edits run the real
// agents-v1 agents.js and automations run the real agents-v1 automations.js,
// so MCP is held to the exact validators the REST API uses. Only storage is
// replaced: an in-memory SQL fake for the tables these tools touch, the
// wallet-intent store, R2, and the run engine's model loop (runs are stepped
// with real chained receipts from run-receipts.js).

import { describe, it, expect, vi, beforeEach } from 'vitest';

process.env.PUBLIC_APP_ORIGIN = 'https://three.ws';
process.env.JWT_SECRET ||= 'vitest-ephemeral-jwt-secret-00000000000000';

const USER = '0a1b2c3d-0000-4000-8000-0000000000a1';
const OTHER = '0a1b2c3d-0000-4000-8000-0000000000b2';
const AGENT = '7e57a9e1-0000-4000-8000-000000000001';
const FOREIGN_AGENT = '7e57a9e1-0000-4000-8000-000000000002';
const MINT = 'THREEsynthetic11111111111111111111111111111';
const DEST = 'THREEsyntheticDest1111111111111111111111111';

const db = vi.hoisted(() => ({ agents: new Map(), automations: new Map(), runs: new Map(), steps: new Map(), seq: 0 }));

vi.mock('../api/_lib/db.js', () => {
	const norm = (strings) => (Array.isArray(strings) ? strings.join('?') : String(strings)).replace(/\s+/g, ' ').trim();
	const uuid = () => `00000000-0000-4000-8000-${String(++db.seq).padStart(12, '0')}`;
	const json = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
	function run(text, v) {
		if (/^SELECT \* FROM agent_identities WHERE id = \? AND deleted_at IS NULL/.test(text)) {
			const a = db.agents.get(v[0]);
			return a && !a.deleted_at ? [a] : [];
		}
		if (/^SELECT status, deleted_at FROM agent_identities WHERE id = \?/.test(text)) {
			const a = db.agents.get(v[0]);
			return a ? [{ status: a.status, deleted_at: a.deleted_at }] : [];
		}
		if (/^UPDATE agent_identities SET name = COALESCE/.test(text)) {
			const a = db.agents.get(v[9]);
			if (v[0] != null) a.name = v[0];
			if (v[1]) a.description = v[2];
			if (v[3]) a.persona_prompt = v[4];
			if (v[5] != null) a.skills = v[5];
			a.meta = { ...a.meta, ...JSON.parse(v[8]) };
			return [a];
		}
		if (/^UPDATE agent_identities SET status = \?/.test(text)) {
			const a = db.agents.get(v[1]);
			a.status = v[0];
			return [a];
		}
		if (/^UPDATE agent_identities SET deleted_at = now\(\)/.test(text)) {
			db.agents.get(v[0]).deleted_at = new Date().toISOString();
			return [];
		}
		if (/^UPDATE agent_identities SET avatar_id = \?/.test(text)) {
			db.agents.get(v[1]).avatar_id = v[0];
			return [];
		}
		if (/^UPDATE agent_identities SET profile_image_url = \?/.test(text)) {
			db.agents.get(v[1]).profile_image_url = v[0];
			return [];
		}
		if (/count\(\*\)::int FROM agent_runs WHERE agent_id = \? AND status IN/.test(text)) {
			return [{ open_runs: 1, enabled_automations: 2, automations: 3, memories: 14, actions: 9 }];
		}
		if (/^SELECT count\(\*\)::int AS n FROM agent_automations WHERE agent_id = \?/.test(text)) {
			return [{ n: [...db.automations.values()].filter((r) => r.agent_id === v[0]).length }];
		}
		if (/^INSERT INTO agent_automations/.test(text)) {
			const row = {
				id: uuid(), agent_id: v[0], user_id: v[1], title: v[2], trigger_type: v[3], trigger_config: json(v[4]),
				action_type: v[5], action_config: json(v[6]), trigger_once: v[7], intent_id: v[8], source: v[9],
				enabled: true, fire_count: 0, created_at: new Date().toISOString(), updated_at: null,
			};
			db.automations.set(row.id, row);
			return [row];
		}
		if (/^SELECT \* FROM agent_automations WHERE id = \? AND user_id = \?/.test(text)) {
			const r = db.automations.get(v[0]);
			return r && r.user_id === v[1] ? [r] : [];
		}
		if (/^SELECT \* FROM agent_automations WHERE id = \?$/.test(text)) {
			const r = db.automations.get(v[0]);
			return r ? [r] : [];
		}
		if (/^SELECT \* FROM agent_automations WHERE agent_id = \?/.test(text)) {
			return [...db.automations.values()].filter((r) => r.agent_id === v[0]);
		}
		if (/^SELECT \* FROM agent_automations WHERE user_id = \?/.test(text)) {
			return [...db.automations.values()].filter((r) => r.user_id === v[0]);
		}
		if (/^UPDATE agent_automations SET title = \?/.test(text)) {
			const r = db.automations.get(v[9]);
			Object.assign(r, {
				title: v[0], trigger_type: v[1], trigger_config: json(v[2]), action_type: v[3], action_config: json(v[4]),
				trigger_once: v[5], enabled: v[6], intent_id: v[7], updated_at: new Date().toISOString(),
			});
			return [r];
		}
		if (/^DELETE FROM agent_automations WHERE id = \? AND user_id = \?/.test(text)) {
			const r = db.automations.get(v[0]);
			if (!r || r.user_id !== v[1]) return [];
			db.automations.delete(v[0]);
			return [{ agent_id: r.agent_id, intent_id: r.intent_id }];
		}
		return [];
	}
	const sql = (strings, ...values) => Promise.resolve(run(norm(strings), values));
	sql.transaction = (queries) => Promise.all(queries);
	return { sql, isDbUnavailableError: () => false, isDbCapacityError: () => false, isStoragePressured: () => false };
});

vi.mock('../api/_lib/usage.js', () => ({
	recordEvent: vi.fn(),
	logger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
}));

vi.mock('../api/_lib/webhook-dispatch.js', () => ({ dispatchWebhooks: vi.fn(async () => ({ queued: 0 })) }));

vi.mock('../api/_lib/wallet-intents.js', async (importOriginal) => ({
	...(await importOriginal()),
	createIntent: vi.fn(async () => ({ id: '1e7e0000-0000-4000-8000-0000000000f1' })),
	getIntent: vi.fn(async () => ({ limits: { per_action_usd: 25, daily_usd: 50 } })),
	updateIntent: vi.fn(async () => ({ ok: true })),
	deleteIntent: vi.fn(async () => ({ ok: true })),
	listIntents: vi.fn(async () => []),
}));

vi.mock('../api/_lib/r2.js', async (importOriginal) => ({
	...(await importOriginal()),
	putObject: vi.fn(async () => ({})),
	publicUrl: (key) => `https://cdn.three.ws/${key}`,
}));

vi.mock('../api/_lib/avatars.js', async (importOriginal) => ({
	...(await importOriginal()),
	createAvatar: vi.fn(async ({ storageKey, input }) => ({
		id: 'a7a7a7a7-0000-4000-8000-000000000001',
		storage_key: storageKey,
		model_url: `https://cdn.three.ws/${storageKey}`,
		visibility: input.visibility,
	})),
	defaultAvatarVisibilityFor: vi.fn(async () => 'unlisted'),
}));

vi.mock('../api/_lib/auto-rig.js', async (importOriginal) => ({
	...(await importOriginal()),
	maybeAutoRigAvatar: vi.fn(async () => ({ queued: true })),
}));

vi.mock('../api/_lib/agent-wallet.js', async (importOriginal) => ({
	...(await importOriginal()),
	getSolanaAddressBalances: vi.fn(async () => ({ sol: 0.5, usdc: 0 })),
}));

// The signed real-funds agreements are a database read; each test decides
// whether the owner has signed (the default) or not.
const signatureMock = vi.fn();
vi.mock('../api/_lib/real-funds-agreement.js', async (importOriginal) => ({
	...(await importOriginal()),
	currentSignatureFor: (...a) => signatureMock(...a),
}));

vi.mock('../api/_lib/ssrf-guard.js', async (importOriginal) => ({
	...(await importOriginal()),
	fetchSafePublicUrl: vi.fn(),
}));

// The run engine: the real serializers and receipt chain, with the model loop
// replaced by a deterministic two-tool step sequence.
vi.mock('../api/_lib/agents-v1/runs.js', async (importOriginal) => {
	const real = await importOriginal();
	const { stepReceipt, summarizeRun } = await import('../api/_lib/agents-v1/run-receipts.js');
	const { apiError } = await import('../api/_lib/agents-v1/http.js');
	const now = () => new Date().toISOString();
	function addStep(runId, s) {
		const list = db.steps.get(runId) || [];
		const seq = list.length + 1;
		const prev = list.at(-1)?.receipt || null;
		const row = { seq, kind: s.kind, provider: null, model: null, tool_name: s.tool || null, input: s.input ?? null, output: s.output ?? null, latency_ms: 5, created_at: now() };
		row.receipt = stepReceipt({ prev, runId, seq, kind: row.kind, tool: row.tool_name, input: row.input, output: row.output });
		list.push(row);
		db.steps.set(runId, list);
	}
	const owned = (runId, userId) => {
		const r = db.runs.get(runId);
		if (!r || r.user_id !== userId) throw apiError(404, 'run_not_found', 'Run not found.');
		return r;
	};
	return {
		...real,
		createRun: vi.fn(async (o) => {
			const a = db.agents.get(o.agentId);
			if (a.status === 'stopped') throw apiError(409, 'agent_stopped', 'This agent is stopped. Start it before creating a run.');
			const id = `00000000-0000-4000-8000-${String(++db.seq).padStart(12, '0')}`;
			const row = {
				id, agent_id: o.agentId, user_id: o.userId, goal: o.goal, status: o.scheduledFor ? 'scheduled' : 'queued',
				max_steps: o.maxSteps ?? 12, step_count: 0, budget_credits_usd: o.budgetCreditsUsd ?? 0, spent_credits_usd: 0,
				budget_usd: 0, spent_usd: 0, source: o.source, automation_id: o.automationId ?? null, created_at: now(),
			};
			db.runs.set(id, row);
			addStep(id, { kind: 'status', output: { status: row.status, note: 'run created' } });
			return row;
		}),
		getOwnedRun: vi.fn(async (runId, userId) => owned(runId, userId)),
		listRunSteps: vi.fn(async (runId, userId, { after = 0, limit = 200 } = {}) => {
			owned(runId, userId);
			return (db.steps.get(runId) || []).filter((s) => s.seq > after).slice(0, limit).map(real.serializeStep);
		}),
		driveRun: vi.fn(async (runId) => {
			const r = db.runs.get(runId);
			if (real.TERMINAL_RUN_STATUSES.has(r.status) || r.status === 'paused') return r;
			r.status = 'running';
			r.started_at = now();
			addStep(runId, { kind: 'model_call', output: { finish: 'tool_calls' } });
			addStep(runId, { kind: 'tool_call', tool: 'get_price', input: { mint: MINT } });
			addStep(runId, { kind: 'tool_result', tool: 'get_price', input: { mint: MINT }, output: { priceUsd: 0.0021 } });
			addStep(runId, { kind: 'tool_call', tool: 'get_holders', input: { mint: MINT } });
			addStep(runId, { kind: 'tool_result', tool: 'get_holders', input: { mint: MINT }, output: { error: 'upstream timeout' } });
			addStep(runId, { kind: 'model_call', output: { finish: 'stop' } });
			Object.assign(r, { status: 'completed', step_count: 2, result: 'Price is $0.0021.', finished_at: now() });
			r.summary = summarizeRun(r, [
				{ kind: 'model_call', tool_name: null, n: 2, failed: 0 },
				{ kind: 'tool_call', tool_name: 'get_price', n: 1, failed: 0 },
				{ kind: 'tool_call', tool_name: 'get_holders', n: 1, failed: 0 },
				{ kind: 'tool_result', tool_name: null, n: 2, failed: 1 },
			]);
			return r;
		}),
		cancelRun: vi.fn(async (runId, userId) => {
			const r = owned(runId, userId);
			if (real.TERMINAL_RUN_STATUSES.has(r.status)) return r;
			r.cancel_requested_at = now();
			if (['queued', 'scheduled', 'paused'].includes(r.status)) Object.assign(r, { status: 'cancelled', finished_at: now(), summary: 'Cancelled after 0 model turns.' });
			return r;
		}),
		updateRun: vi.fn(async (runId, userId, { action, budgetCreditsUsd }) => {
			const r = owned(runId, userId);
			if (real.TERMINAL_RUN_STATUSES.has(r.status)) throw apiError(409, 'run_finished', `This run already ${r.status}.`);
			if (budgetCreditsUsd != null && budgetCreditsUsd < r.budget_credits_usd) throw apiError(400, 'budget_decrease', 'A budget can only be raised.');
			if (budgetCreditsUsd != null) r.budget_credits_usd = budgetCreditsUsd;
			if (action === 'pause') r.status = 'paused';
			if (action === 'resume' && r.status === 'paused') r.status = 'queued';
			return r;
		}),
	};
});

const FULL = 'agents:read agents:write avatars:write wallet:write';
const owner = (scope = FULL) => ({ userId: USER, scope, source: 'oauth', apiKeyId: null });
const ALL = { headers: { 'x-three-tools': 'all' }, url: '/api/mcp' };
const DEFAULT = { headers: {}, url: '/api/mcp' };

let dispatch;
async function call(name, args = {}, { auth = owner(), req = ALL } = {}) {
	if (!dispatch) ({ dispatch } = await import('../api/_mcp/dispatch.js'));
	const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, auth, req);
	return res;
}
const out = (res) => res.result?.structuredContent;

function seedAgent(id = AGENT, userId = USER, extra = {}) {
	db.agents.set(id, {
		id, user_id: userId, name: 'Scout', description: 'Watches launches', persona_prompt: null, skills: [],
		status: 'running', meta: { solana_address: 'THREEsyntheticWallet111111111111111111111111' }, wallet_address: null,
		avatar_id: null, is_public: true, created_at: new Date().toISOString(), deleted_at: null, ...extra,
	});
}

function glb() {
	const jsonText = JSON.stringify({ asset: { version: '2.0' }, scenes: [{ nodes: [] }] });
	const json = Buffer.from(jsonText.padEnd(Math.ceil(jsonText.length / 4) * 4, ' '));
	const header = Buffer.alloc(20);
	header.writeUInt32LE(0x46546c67, 0);
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(20 + json.length, 8);
	header.writeUInt32LE(json.length, 12);
	header.writeUInt32LE(0x4e4f534a, 16);
	return Buffer.concat([header, json]);
}

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');

beforeEach(() => {
	signatureMock.mockReset().mockResolvedValue({ signedAt: '2026-10-01T00:00:00.000Z', signatureName: 'QA Owner', context: 'agent-wallet' });
	db.agents.clear();
	db.automations.clear();
	db.runs.clear();
	db.steps.clear();
	seedAgent();
	seedAgent(FOREIGN_AGENT, OTHER);
});

describe('agent lifecycle tools', () => {
	it('lists all sixteen tools on the main server', async () => {
		if (!dispatch) ({ dispatch } = await import('../api/_mcp/dispatch.js'));
		const res = await dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, owner(), ALL);
		const names = new Set(res.result.tools.map((t) => t.name));
		for (const n of [
			'get_agent', 'update_agent', 'delete_agent', 'start_agent', 'stop_agent', 'upload_agent_avatar',
			'create_agent_run', 'update_agent_run', 'cancel_agent_run', 'get_agent_run_steps',
			'automation_list', 'automation_get', 'automation_create', 'automation_update', 'automation_delete', 'automation_trigger',
		]) {
			expect(names.has(n), n).toBe(true);
		}
	});

	it('get_agent reports what a delete would destroy and mints a preview id', async () => {
		const res = await call('get_agent', { agent_id: AGENT });
		expect(out(res).agent).toMatchObject({ id: AGENT, name: 'Scout', status: 'running' });
		expect(out(res).counts).toMatchObject({ open_runs: 1, memories: 14 });
		expect(out(res).delete_impact).toContain('permanently erases 14 memories');
		expect(out(res).delete_impact).toContain('withdraw them first');
		expect(res.result._meta['three.ws/preview'].preview_id).toMatch(/^p_/);
	});

	it('refuses an agent on another account with the REST error code', async () => {
		const res = await call('get_agent', { agent_id: FOREIGN_AGENT });
		expect(res.result.isError).toBe(true);
		expect(out(res)).toMatchObject({ error: 'forbidden', http_status: 403 });
	});

	it('update_agent maps snake_case onto the REST body and validates with the REST code', async () => {
		const ok = await call('update_agent', { agent_id: AGENT, name: 'Scout Prime', system_prompt: 'Be terse.', temperature: 0.4 });
		expect(out(ok)).toMatchObject({ status: 'updated', agent: { name: 'Scout Prime', systemPrompt: 'Be terse.', temperature: 0.4 } });
		expect(db.agents.get(AGENT).persona_prompt).toBe('Be terse.');

		const bad = await call('update_agent', { agent_id: AGENT, model: 'not-a-real-model' });
		expect(bad.result.isError).toBe(true);
		expect(out(bad).error).toBe('unknown_model');

		const badStrategy = await call('update_agent', { agent_id: AGENT, strategy: 'no-such-strategy' });
		expect(out(badStrategy).error).toBe('unknown_strategy');

		const empty = await call('update_agent', { agent_id: AGENT });
		expect(out(empty).error).toBe('nothing_to_update');
	});

	it('stop_agent and start_agent flip the status', async () => {
		expect(out(await call('stop_agent', { agent_id: AGENT })).agent.status).toBe('stopped');
		expect(db.agents.get(AGENT).status).toBe('stopped');
		expect(out(await call('start_agent', { agent_id: AGENT })).agent.status).toBe('running');
	});

	it('delete_agent is off unless the session enables the financial tier', async () => {
		const res = await call('delete_agent', { agent_id: AGENT, confirm_delete: true }, { req: DEFAULT });
		expect(res.result.isError).toBe(true);
		expect(out(res).reason).toBe('tool_disabled');
		expect(db.agents.get(AGENT).deleted_at).toBeNull();
	});

	it('refuses delete_agent without confirm_delete', async () => {
		const preview = await call('get_agent', { agent_id: AGENT });
		const preview_id = preview.result._meta['three.ws/preview'].preview_id;
		const res = await call('delete_agent', { agent_id: AGENT, preview_id });
		expect(res.result.isError).toBe(true);
		expect(out(res)).toMatchObject({ reason: 'confirmation_required', confirm_flag: 'confirm_delete', preview_tool: 'get_agent' });
		expect(db.agents.get(AGENT).deleted_at).toBeNull();
	});

	it('refuses delete_agent without a preview, and with a preview of a different agent', async () => {
		const none = await call('delete_agent', { agent_id: AGENT, confirm_delete: true });
		expect(out(none).reason).toBe('preview_required');

		seedAgent('7e57a9e1-0000-4000-8000-000000000003');
		const other = await call('get_agent', { agent_id: '7e57a9e1-0000-4000-8000-000000000003' });
		const res = await call('delete_agent', { agent_id: AGENT, confirm_delete: true, preview_id: other.result._meta['three.ws/preview'].preview_id });
		expect(out(res).reason).toBe('preview_mismatch');
		expect(db.agents.get(AGENT).deleted_at).toBeNull();
	});

	it('deletes with confirm_delete and a fresh preview, and burns the preview', async () => {
		const preview = await call('get_agent', { agent_id: AGENT });
		const preview_id = preview.result._meta['three.ws/preview'].preview_id;
		const res = await call('delete_agent', { agent_id: AGENT, preview_id, confirm_delete: true });
		expect(out(res)).toEqual({ status: 'deleted', agent_id: AGENT });
		expect(db.agents.get(AGENT).deleted_at).not.toBeNull();
		seedAgent();
		const replay = await call('delete_agent', { agent_id: AGENT, preview_id, confirm_delete: true });
		expect(out(replay).reason).toBe('preview_unknown');
	});

	it('needs agents:write to edit', async () => {
		const res = await call('stop_agent', { agent_id: AGENT }, { auth: owner('agents:read') });
		expect(res.error.code).toBe(-32002);
	});

	it('asks an anonymous caller to sign in', async () => {
		const res = await call('get_agent', { agent_id: AGENT }, { auth: { userId: null, scope: FULL } });
		expect(out(res).error).toBe('sign_in_required');
	});
});

describe('upload_agent_avatar', () => {
	it('ingests an inline GLB, attaches it as the 3D body, and queues the auto-rig', async () => {
		const { maybeAutoRigAvatar } = await import('../api/_lib/auto-rig.js');
		const { putObject } = await import('../api/_lib/r2.js');
		const res = await call('upload_agent_avatar', { agent_id: AGENT, data: `data:model/gltf-binary;base64,${glb().toString('base64')}` });
		expect(out(res)).toMatchObject({ status: 'attached', kind: 'glb', avatar_id: 'a7a7a7a7-0000-4000-8000-000000000001', rigged: false });
		expect(db.agents.get(AGENT).avatar_id).toBe('a7a7a7a7-0000-4000-8000-000000000001');
		expect(putObject).toHaveBeenCalledWith(expect.objectContaining({ contentType: 'model/gltf-binary', key: expect.stringMatching(new RegExp(`^u/${USER}/agent-`)) }));
		await new Promise((r) => setTimeout(r, 0));
		expect(maybeAutoRigAvatar).toHaveBeenCalledWith(expect.objectContaining({ rigInfo: { is_rigged: false, skeleton_joint_count: expect.anything() } }));
	});

	it('fetches a GLB by url through the SSRF guard', async () => {
		const { fetchSafePublicUrl } = await import('../api/_lib/ssrf-guard.js');
		fetchSafePublicUrl.mockResolvedValueOnce(new Response(glb(), { status: 200 }));
		const res = await call('upload_agent_avatar', { agent_id: AGENT, url: 'https://example.com/body.glb' });
		expect(out(res).kind).toBe('glb');
		expect(fetchSafePublicUrl).toHaveBeenCalledWith('https://example.com/body.glb', {}, { allowHttp: false });
	});

	it('sets an image as the portrait', async () => {
		const res = await call('upload_agent_avatar', { agent_id: AGENT, data: PNG.toString('base64') });
		expect(out(res)).toMatchObject({ status: 'attached', kind: 'image' });
		expect(db.agents.get(AGENT).profile_image_url).toMatch(new RegExp(`^https://cdn\\.three\\.ws/u/${USER}/agent-images/${AGENT}/.+\\.png$`));
	});

	it('refuses an unknown file type and a call with both url and data', async () => {
		const junk = await call('upload_agent_avatar', { agent_id: AGENT, data: Buffer.from('hello world, not a model').toString('base64') });
		expect(out(junk).error).toBe('unsupported_file');
		const both = await call('upload_agent_avatar', { agent_id: AGENT, data: 'AAAA', url: 'https://example.com/a.glb' });
		expect(out(both).error).toBe('invalid_request');
	});

	it('needs avatars:write to save a GLB to the library', async () => {
		const res = await call('upload_agent_avatar', { agent_id: AGENT, data: glb().toString('base64') }, { auth: owner('agents:read agents:write') });
		expect(out(res).error).toBe('insufficient_scope');
	});
});

describe('run tools', () => {
	it('creates a run with a step and dollar budget, drives it, and returns its summary', async () => {
		const res = await call('create_agent_run', { agent_id: AGENT, goal: 'Price the coin', max_steps: 6, budget_usd: 0.5, wait_seconds: 5 });
		const body = out(res);
		expect(body.status).toBe('created');
		expect(body.run).toMatchObject({ status: 'completed', maxSteps: 6, budget: { creditsUsd: 0.5 } });
		expect(body.live).toBe(false);
		expect(body.run.summary).toContain('Made 2 tool calls');
		expect(body.next).toBe(body.run.summary);
		expect(body.replay_url).toBe(`https://three.ws/agents/${AGENT}?view=runs&run=${body.run.id}`);
	});

	it('refuses a run on a stopped agent', async () => {
		db.agents.get(AGENT).status = 'stopped';
		const res = await call('create_agent_run', { agent_id: AGENT, goal: 'x' });
		expect(out(res).error).toBe('agent_stopped');
	});

	it('returns each tool call paired with its result and a receipt chain that verifies', async () => {
		const created = out(await call('create_agent_run', { agent_id: AGENT, goal: 'Price the coin' }));
		const res = out(await call('get_agent_run_steps', { run_id: created.run.id }));
		expect(res.steps.length).toBe(7);
		expect(res.tool_traces).toEqual([
			expect.objectContaining({ tool: 'get_price', status: 'ok', input: { mint: MINT }, output: { priceUsd: 0.0021 }, receipt: expect.stringMatching(/^[0-9a-f]{64}$/) }),
			expect.objectContaining({ tool: 'get_holders', status: 'error', output: { error: 'upstream timeout' } }),
		]);
		expect(res.receipt_chain).toEqual({ verified: true, checked: 7, brokenAt: null });
		expect(res.next_after).toBe(7);
	});

	it('detects a tampered step', async () => {
		const created = out(await call('create_agent_run', { agent_id: AGENT, goal: 'Price the coin' }));
		db.steps.get(created.run.id)[2].output = { priceUsd: 99 };
		const res = out(await call('get_agent_run_steps', { run_id: created.run.id }));
		expect(res.receipt_chain).toMatchObject({ verified: false, brokenAt: 3 });
	});

	it('pauses, raises the budget, resumes, and refuses a budget cut', async () => {
		const created = out(await call('create_agent_run', { agent_id: AGENT, goal: 'Watch', wait_seconds: 0, budget_usd: 1 }));
		const paused = out(await call('update_agent_run', { run_id: created.run.id, action: 'pause' }));
		expect(paused.run.status).toBe('paused');
		const raised = out(await call('update_agent_run', { run_id: created.run.id, budget_usd: 2 }));
		expect(raised.run.budget.creditsUsd).toBe(2);
		const cut = await call('update_agent_run', { run_id: created.run.id, budget_usd: 0.5 });
		expect(out(cut).error).toBe('budget_decrease');
		const resumed = out(await call('update_agent_run', { run_id: created.run.id, action: 'resume', wait_seconds: 3 }));
		expect(resumed.run.status).toBe('completed');
	});

	it('cancels a queued run at once and reports a running one as cancel_requested', async () => {
		const queued = out(await call('create_agent_run', { agent_id: AGENT, goal: 'Watch', wait_seconds: 0 }));
		expect(out(await call('cancel_agent_run', { run_id: queued.run.id })).status).toBe('cancelled');

		const live = out(await call('create_agent_run', { agent_id: AGENT, goal: 'Watch', wait_seconds: 0 }));
		db.runs.get(live.run.id).status = 'running';
		const res = out(await call('cancel_agent_run', { run_id: live.run.id }));
		expect(res).toMatchObject({ status: 'cancel_requested', note: 'The run stops before its next step.' });
		expect(res.run.cancelRequested).toBe(true);
	});

	it('hides another account\'s run', async () => {
		const created = out(await call('create_agent_run', { agent_id: AGENT, goal: 'x', wait_seconds: 0 }));
		const res = await call('get_agent_run_steps', { run_id: created.run.id }, { auth: { ...owner(), userId: OTHER } });
		expect(out(res).error).toBe('run_not_found');
	});
});

describe('automation tools', () => {
	const prompt = { agent_id: AGENT, trigger: { type: 'schedule', cron: '0 * * * *' }, action: { type: 'agent_prompt', prompt: 'Summarize new launches', maxSteps: 4 } };

	it('creates, lists, reads and edits an agent_prompt automation through the REST validator', async () => {
		const created = out(await call('automation_create', prompt));
		expect(created.automation).toMatchObject({ agentId: AGENT, trigger: { type: 'schedule', cron: '0 * * * *' }, action: { type: 'agent_prompt' }, enabled: true });
		const id = created.automation.id;

		const listed = out(await call('automation_list', { agent_id: AGENT }));
		expect(listed.items.map((i) => i.id)).toContain(id);
		expect(listed.trigger_types).toContain('whale_buy');

		const got = await call('automation_get', { automation_id: id });
		expect(out(got).automation).toMatchObject({ id, nextFireAt: expect.any(String), recentRuns: [] });

		const updated = out(await call('automation_update', { automation_id: id, trigger: { cron: '30 * * * *' }, title: 'Hourly digest' }));
		expect(updated.automation).toMatchObject({ title: 'Hourly digest', trigger: { type: 'schedule', cron: '30 * * * *' } });

		const off = out(await call('automation_update', { automation_id: id, enabled: false }));
		expect(off.automation.enabled).toBe(false);
	});

	it('refuses an invalid config with the shared validator', async () => {
		const res = await call('automation_create', { ...prompt, trigger: { type: 'price_threshold', mint: MINT, operator: 'sideways', priceUsd: 1 } });
		expect(res.result.isError).toBe(true);
		expect(out(res).error).toBe('invalid_parameter');
		expect(db.automations.size).toBe(0);
	});

	it('shows spend terms and refuses a swap automation without confirm_spend', async () => {
		const res = await call('automation_create', {
			agent_id: AGENT,
			trigger: { type: 'price_threshold', mint: MINT, operator: 'below', priceUsd: 0.001 },
			action: { type: 'swap', mint: MINT, amountSol: 0.25 },
			limits: { dailyUsd: 50 },
		});
		expect(res.result.isError).toBe(true);
		expect(out(res)).toMatchObject({
			status: 'confirmation_required',
			confirm_flag: 'confirm_spend',
			terms: { amount: '0.25 SOL per fire', asset: 'SOL', chain: 'Solana mainnet', recipient: expect.stringContaining(MINT), caps: 'dailyUsd $50' },
		});
		expect(res.result.content[0].text).toContain('Recipient:');
		expect(db.automations.size).toBe(0);
	});

	it('refuses a spend automation from an owner who has not signed the real-funds agreements', async () => {
		signatureMock.mockResolvedValue(null);
		const res = await call('automation_create', {
			agent_id: AGENT,
			trigger: { type: 'tip_received' },
			action: { type: 'transfer', destination: DEST, amountSol: 0.01 },
			confirm_spend: true,
		});
		expect(res.result.isError).toBe(true);
		expect(out(res)).toMatchObject({ status: 'risk_ack_required', sign_url: expect.stringContaining('http') });
		expect(db.automations.size).toBe(0);
	});

	it('refuses to arm a spend automation when the agreement lookup fails', async () => {
		signatureMock.mockRejectedValue(new Error('db down'));
		const res = await call('automation_create', {
			agent_id: AGENT,
			trigger: { type: 'tip_received' },
			action: { type: 'transfer', destination: DEST, amountSol: 0.01 },
			confirm_spend: true,
		});
		expect(out(res).status).toBe('agreement_check_unavailable');
		expect(db.automations.size).toBe(0);
	});

	it('creates a transfer automation once confirm_spend is true', async () => {
		const res = await call('automation_create', {
			agent_id: AGENT,
			trigger: { type: 'balance_below', thresholdSol: 0.1 },
			action: { type: 'transfer', destination: DEST, amountSol: 0.05 },
			confirm_spend: true,
		});
		expect(out(res).status).toBe('created');
		expect(out(res).automation.action).toMatchObject({ type: 'transfer', destination: DEST, amountSol: 0.05 });
	});

	it('refuses a spending automation to a connector key and to a bearer without wallet:write', async () => {
		const spend = { agent_id: AGENT, trigger: { type: 'tip_received' }, action: { type: 'transfer', destination: DEST, amountSol: 0.01 }, confirm_spend: true };
		const connector = await call('automation_create', spend, { auth: { ...owner('agents:read agents:write'), connector: true, apiKeyId: 'k' } });
		expect(connector.error.code).toBe(-32003);
		const narrow = await call('automation_create', spend, { auth: owner('agents:read agents:write') });
		expect(out(narrow).error).toBe('insufficient_scope');
		expect(db.automations.size).toBe(0);
	});

	it('lets a connector key create a non-spending automation', async () => {
		const res = await call('automation_create', prompt, { auth: { ...owner('agents:read agents:write'), connector: true, apiKeyId: 'k' } });
		expect(out(res).status).toBe('created');
	});

	it('needs confirm_spend to edit a spend automation but not to switch it off', async () => {
		const created = out(await call('automation_create', {
			agent_id: AGENT,
			trigger: { type: 'balance_below', thresholdSol: 0.1 },
			action: { type: 'transfer', destination: DEST, amountSol: 0.05 },
			confirm_spend: true,
		}));
		const id = created.automation.id;
		const raise = await call('automation_update', { automation_id: id, action: { amountSol: 1 } });
		expect(out(raise)).toMatchObject({ status: 'confirmation_required', terms: { amount: '1 SOL per fire', recipient: DEST } });
		expect(db.automations.get(id).action_config.amountSol).toBe(0.05);
		const off = out(await call('automation_update', { automation_id: id, enabled: false }));
		expect(off.automation.enabled).toBe(false);
		const confirmed = out(await call('automation_update', { automation_id: id, action: { amountSol: 1 }, enabled: true, confirm_spend: true }));
		expect(confirmed.automation.action.amountSol).toBe(1);
	});

	it('fires an agent_prompt automation on demand and drives the run it starts', async () => {
		const id = out(await call('automation_create', prompt)).automation.id;
		const res = out(await call('automation_trigger', { automation_id: id, wait_seconds: 2 }));
		expect(res.status).toBe('run_started');
		expect(res.run).toMatchObject({ status: 'completed', automationId: id });
		expect(res.run.summary).toContain('Completed');
	});

	it('refuses to fire on a stopped agent and to fire a spend automation without confirm_spend', async () => {
		const id = out(await call('automation_create', prompt)).automation.id;
		db.agents.get(AGENT).status = 'stopped';
		expect(out(await call('automation_trigger', { automation_id: id })).error).toBe('agent_stopped');
		db.agents.get(AGENT).status = 'running';

		const spend = out(await call('automation_create', {
			agent_id: AGENT,
			trigger: { type: 'balance_below', thresholdSol: 0.1 },
			action: { type: 'transfer', destination: DEST, amountSol: 0.05 },
			confirm_spend: true,
		})).automation.id;
		const res = await call('automation_trigger', { automation_id: spend });
		expect(out(res)).toMatchObject({ status: 'confirmation_required', terms: { recipient: DEST, chain: 'Solana mainnet' } });
	});

	it('refuses automation_delete without confirm_delete, then deletes with a preview', async () => {
		const id = out(await call('automation_create', prompt)).automation.id;
		const refused = await call('automation_delete', { automation_id: id });
		expect(out(refused)).toMatchObject({ reason: 'confirmation_required', confirm_flag: 'confirm_delete' });
		expect(db.automations.has(id)).toBe(true);

		const preview = await call('automation_get', { automation_id: id });
		const preview_id = preview.result._meta['three.ws/preview'].preview_id;
		const res = out(await call('automation_delete', { automation_id: id, preview_id, confirm_delete: true }));
		expect(res).toMatchObject({ status: 'deleted', id, source: 'automation' });
		expect(db.automations.has(id)).toBe(false);
	});

	it('answers an unknown automation with not_found', async () => {
		const res = await call('automation_get', { automation_id: '00000000-0000-4000-8000-00000000dead' });
		expect(out(res).error).toBe('not_found');
	});
});
