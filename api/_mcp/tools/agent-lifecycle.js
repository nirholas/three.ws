// Agent lifecycle, runs and automations over MCP.
//
// Everything an owner can do to an agent from the dashboard, as tools: edit
// it, start and stop it, give it a body or a portrait, delete it, hand it a
// goal to pursue on its own (a run), watch that run step by step with a
// receipt per tool call, and wire it to triggers (automations).
//
// These tools are a thin MCP skin over api/_lib/agents-v1: update_agent calls
// updateAgent and automation_create calls createAutomation, so the REST path
// and MCP validate with the same code and can never disagree about what a
// valid agent or automation is.
//
// Money: runs use a read-only tool registry and can never sign. A swap or
// transfer automation spends from the agent wallet later, on its own, so
// creating, editing or firing one refuses a connector key, needs wallet:write,
// and needs confirm_spend: true after the tool has shown the recipient, amount,
// asset and chain. Execution still passes the wallet-intent spend policy.

import { sql } from '../../_lib/db.js';
import { limits } from '../../_lib/rate-limit.js';
import { logAudit } from '../../_lib/audit.js';
import { hasScope } from '../../_lib/auth.js';
import { env } from '../../_lib/env.js';
import { putObject, publicUrl } from '../../_lib/r2.js';
import { fetchSafePublicUrl, SsrfBlockedError } from '../../_lib/ssrf-guard.js';
import { isValidGlbHeader, inspectGlb } from '../../_lib/glb-inspect.js';
import { storageKeyFor, createAvatar, defaultAvatarVisibilityFor, isPlanLimitError } from '../../_lib/avatars.js';
import { maybeAutoRigAvatar } from '../../_lib/auto-rig.js';
import { getSolanaAddressBalances } from '../../_lib/agent-wallet.js';
import { ApiError } from '../../_lib/agents-v1/http.js';
import { loadOwnedAgent, updateAgent, deleteAgent, setAgentStatus, serializeAgent } from '../../_lib/agents-v1/agents.js';
import {
	createRun,
	getOwnedRun,
	listRunSteps,
	cancelRun,
	updateRun,
	driveRun,
	serializeRun,
	TERMINAL_RUN_STATUSES,
} from '../../_lib/agents-v1/runs.js';
import { toolTraces, verifyReceiptChain } from '../../_lib/agents-v1/run-receipts.js';
import {
	TRIGGER_TYPES,
	ACTION_TYPES,
	normalizeAutomation,
	createAutomation,
	getAutomation,
	updateAutomation,
	deleteAutomation,
	triggerAutomation,
	listAgentAutomations,
	listUserAutomations,
} from '../../_lib/agents-v1/automations.js';
import { connectorSpendError } from '../policy.js';
import { currentSignatureFor, agreementRequirement } from '../../_lib/real-funds-agreement.js';

const SPEND_ACTIONS = new Set(['swap', 'transfer']);
const MAX_GLB_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_WAIT_SECONDS = 25;
const SOLANA_MAINNET = 'Solana mainnet';

const UUID = { type: 'string', format: 'uuid' };
const AGENT_ID = { ...UUID, description: 'The agent id (from list_my_agents or create_agent).' };
const RUN_ID = { ...UUID, description: 'The run id (from create_agent_run).' };
const AUTOMATION_ID = { ...UUID, description: 'The automation id (from automation_list or automation_create).' };
const WAIT = {
	type: 'integer',
	minimum: 0,
	maximum: MAX_WAIT_SECONDS,
	default: 15,
	description: `Seconds to drive the run inline before returning (0 to ${MAX_WAIT_SECONDS}). A run that is not done keeps going on the per-minute run cron; read it back with get_agent_run_steps.`,
};

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const IDEMPOTENT_WRITE = { ...WRITE, idempotentHint: true };
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

const TRIGGER_DOC =
	'trigger.type is one of: price_threshold { mint, operator: "above"|"below", priceUsd }, schedule { cron (5-field UTC, at most every 5 minutes) }, ' +
	'balance_below { thresholdSol }, tip_received { minSol? }, launch_matching { creator?, maxMcapUsd?, minMcapUsd? } (creator or maxMcapUsd required), ' +
	'graduation { mint? }, whale_buy { mint, minSol }. Any trigger takes cooldownMinutes.';
const ACTION_DOC =
	'action.type is one of: agent_prompt { prompt, maxSteps? (1-30), budgetCreditsUsd? (0-100) } which starts a run, ' +
	'swap { mint (omit on launch_matching/graduation to buy the coin the event names), amountSol, slippagePct? } and transfer { destination (address or .sol name), amountSol } which spend from the agent wallet, ' +
	'and notify { message? } which emails the owner.';

function toolResult(structured, { isError = false, text = null } = {}) {
	return {
		content: [{ type: 'text', text: text ? `${text}\n\n${JSON.stringify(structured, null, 2)}` : JSON.stringify(structured, null, 2) }],
		structuredContent: structured,
		...(isError ? { isError: true } : {}),
	};
}

function designedError(status, message, extra = {}) {
	return toolResult({ status, error: status, message, ...extra }, { isError: true, text: message });
}

function signInRequired(what) {
	return designedError('sign_in_required', `Sign in to three.ws to ${what}. Connect with an account (OAuth) or an API key.`);
}

/**
 * Run a lib call and turn its ApiError into a designed tool error, so the
 * model reads the same stable code and message a REST client would get.
 */
async function api(fn) {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof ApiError) {
			return { __error: designedError(err.code, err.message, { http_status: err.status, ...(err.details ? { details: err.details } : {}) }) };
		}
		throw err;
	}
}

const failed = (r) => r && typeof r === 'object' && '__error' in r;

/** Optional fields from MCP snake_case onto the REST body's camelCase. */
function pick(args, map) {
	const out = {};
	for (const [from, to] of Object.entries(map)) {
		if (Object.hasOwn(args, from)) out[to] = args[from];
	}
	return out;
}

// ── spend gate ───────────────────────────────────────────────────────────────

/**
 * Refuse a connector key, a bearer without wallet:write, or an account that has
 * not signed the real-funds agreements, before any spend config is touched.
 * A failed agreement lookup refuses too: nothing is armed on an unverified signature.
 */
async function assertMaySpend(auth, toolName) {
	if (auth?.connector) throw connectorSpendError(toolName);
	if (!hasScope(auth?.scope, 'wallet:write')) {
		return designedError(
			'insufficient_scope',
			'This automation spends from the agent wallet, so the connection needs the wallet:write scope. Reconnect with wallet access, or use an agent_prompt or notify action.',
		);
	}
	let signature;
	try {
		signature = await currentSignatureFor(auth.userId);
	} catch {
		return designedError('agreement_check_unavailable', 'Could not verify the signed real-funds agreements, so nothing was armed. Try again in a moment.');
	}
	if (!signature) {
		const requirement = agreementRequirement();
		return toolResult(
			{ status: 'risk_ack_required', error: 'risk_ack_required', ...requirement },
			{ isError: true, text: `Sign the real-funds agreements before an agent can spend on its own. Nothing was armed. Sign at ${requirement.sign_url}` },
		);
	}
	return null;
}

/** The recipient, amount, asset and chain a spend action will move, for the owner to approve. */
function spendTerms(action, trigger, limitsCfg = {}) {
	const terms = {
		action: action.type,
		recipient:
			action.type === 'transfer'
				? action.destination
				: action.mint
					? `Swap into token ${action.mint} (the agent wallet receives the tokens)`
					: 'Swap into the coin named by each matching trigger event (the agent wallet receives the tokens)',
		amount: `${action.amountSol} SOL per fire`,
		asset: 'SOL',
		chain: SOLANA_MAINNET,
		when: trigger,
	};
	if (action.type === 'swap') terms.slippage = `${action.slippagePct ?? 5}%`;
	const caps = Object.entries(limitsCfg || {}).map(([k, v]) => `${k} $${v}`);
	if (caps.length) terms.caps = caps.join(', ');
	return terms;
}

function spendConfirmation(toolName, terms, extra = {}) {
	const lines = [
		`${toolName} would let this agent spend on its own. Show the owner these terms and call again with confirm_spend: true only after they clearly say yes:`,
		`  Recipient: ${terms.recipient}`,
		`  Amount:    ${terms.amount}`,
		`  Asset:     ${terms.asset}`,
		`  Chain:     ${terms.chain}`,
	];
	if (terms.slippage) lines.push(`  Slippage:  ${terms.slippage}`);
	if (terms.caps) lines.push(`  Caps:      ${terms.caps}`);
	return toolResult(
		{ status: 'confirmation_required', error: 'confirmation_required', confirm_flag: 'confirm_spend', terms, ...extra },
		{ isError: true, text: lines.join('\n') },
	);
}

/** Resolve a transfer destination for display only; createAutomation resolves it again for real. */
async function displayDestination(action) {
	if (action.type !== 'transfer') return action;
	try {
		const { resolveSolanaRecipient } = await import('../../../src/solana/sns.js');
		const r = await resolveSolanaRecipient(action.destination);
		if (r?.address && r.address !== action.destination) return { ...action, destination: `${action.destination} (${r.address})` };
	} catch {
		// Unresolvable names are refused by createAutomation with a designed error.
	}
	return action;
}

// ── run helpers ──────────────────────────────────────────────────────────────

/** Drive a run inline for up to `seconds`, then return its fresh row. */
async function driveFor(runId, userId, seconds) {
	const s = Math.min(MAX_WAIT_SECONDS, Math.max(0, Number(seconds) || 0));
	if (s > 0) await driveRun(runId, { deadlineMs: s * 1000 });
	return getOwnedRun(runId, userId);
}

function runView(row) {
	const run = serializeRun(row);
	const live = !TERMINAL_RUN_STATUSES.has(row.status);
	return {
		run,
		live,
		replay_url: `${env.APP_ORIGIN}/agents/${row.agent_id}?view=runs&run=${row.id}`,
		next: live
			? 'The run keeps going on the per-minute run cron. Read progress with get_agent_run_steps; stop it with cancel_agent_run (it stops before its next step).'
			: run.summary || `The run ${row.status}.`,
	};
}

// ── avatar ingest ────────────────────────────────────────────────────────────

/** Bytes from a data: URI or bare base64 string. */
function decodeData(data) {
	const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(data);
	if (m) return { buf: m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8'), declared: m[1] || null };
	return { buf: Buffer.from(data.replace(/\s+/g, ''), 'base64'), declared: null };
}

/** The image type of a buffer from its magic bytes, or null. */
function sniffImage(buf) {
	if (buf.length < 12) return null;
	if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return { ext: 'png', type: 'image/png' };
	if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
	if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
	if (buf.toString('ascii', 0, 4) === 'GIF8') return { ext: 'gif', type: 'image/gif' };
	return null;
}

async function fetchUpload(url) {
	let resp;
	try {
		resp = await fetchSafePublicUrl(url, {}, { allowHttp: false });
	} catch (err) {
		if (err instanceof SsrfBlockedError) return { error: designedError('invalid_url', 'url must be a public https URL.') };
		return { error: designedError('fetch_failed', 'Could not fetch that URL. Check the link and try again.') };
	}
	if (!resp.ok) return { error: designedError('fetch_failed', `That URL answered ${resp.status}.`) };
	const declared = Number(resp.headers.get('content-length') || 0);
	if (declared > MAX_GLB_BYTES) return { error: designedError('payload_too_large', `That file is ${declared} bytes; the limit is ${MAX_GLB_BYTES}.`) };
	const buf = Buffer.from(await resp.arrayBuffer());
	if (buf.length > MAX_GLB_BYTES) return { error: designedError('payload_too_large', `That file is ${buf.length} bytes; the limit is ${MAX_GLB_BYTES}.`) };
	return { buf };
}

async function attachGlb({ auth, agent, buf, sourceUrl, name, visibility }) {
	if (!hasScope(auth.scope, 'avatars:write')) {
		return designedError('insufficient_scope', 'Saving a 3D body to your library needs the avatars:write scope.');
	}
	const info = inspectGlb(buf) || {};
	const slug = `agent-${Math.random().toString(36).slice(2, 8)}`;
	const storageKey = storageKeyFor({ userId: auth.userId, slug });
	let avatar;
	try {
		await putObject({ key: storageKey, body: buf, contentType: 'model/gltf-binary', metadata: { source: 'mcp', user_id: auth.userId } });
		avatar = await createAvatar({
			userId: auth.userId,
			storageKey,
			input: {
				slug,
				name: (name || agent.name || 'Agent body').slice(0, 80),
				description: null,
				size_bytes: buf.length,
				content_type: 'model/gltf-binary',
				source: 'mcp',
				source_meta: {
					source_glb_url: sourceUrl,
					uploaded_for_agent: agent.id,
					is_rigged: typeof info.isRigged === 'boolean' ? info.isRigged : null,
					mesh_count: info.meshCount ?? null,
					animation_count: info.animationCount ?? null,
				},
				visibility: visibility || (await defaultAvatarVisibilityFor(auth.userId, 'unlisted')),
				tags: [],
				checksum_sha256: null,
				parent_avatar_id: null,
			},
		});
	} catch (err) {
		if (isPlanLimitError(err)) return designedError(err.code, err.message, { upgrade_url: `${env.APP_ORIGIN}/pricing` });
		throw err;
	}
	await sql`UPDATE agent_identities SET avatar_id = ${avatar.id}, updated_at = now() WHERE id = ${agent.id}`;
	// A static mesh is rigged in the background so the body can animate; the
	// rig decision reads the server-side inspection, never the caller.
	queueMicrotask(() =>
		maybeAutoRigAvatar({
			userId: auth.userId,
			avatar,
			rigInfo: { is_rigged: info.isRigged === true, skeleton_joint_count: info.skeletonJointCount ?? null },
			source: 'mcp',
			visibility: avatar.visibility,
			prompt: null,
		}),
	);
	logAudit({ userId: auth.userId, action: 'upload_agent_avatar', resourceId: agent.id, meta: { kind: 'glb', avatar_id: avatar.id, bytes: buf.length } });
	return toolResult({
		status: 'attached',
		kind: 'glb',
		agent_id: agent.id,
		avatar_id: avatar.id,
		model_url: avatar.model_url,
		rigged: info.isRigged === true,
		auto_rig: info.isRigged === true ? 'not needed' : 'queued: the body is rigged in the background so it can animate',
		agent_url: `${env.APP_ORIGIN}/agents/${agent.id}`,
		avatar_url: `${env.APP_ORIGIN}/avatars/${avatar.id}`,
	});
}

async function attachImage({ auth, agent, buf, kind }) {
	if (buf.length > MAX_IMAGE_BYTES) return designedError('payload_too_large', `Portrait images are capped at ${MAX_IMAGE_BYTES} bytes.`);
	const key = `u/${auth.userId}/agent-images/${agent.id}/${Date.now().toString(36)}.${kind.ext}`;
	await putObject({ key, body: buf, contentType: kind.type, metadata: { source: 'mcp', user_id: auth.userId, agent_id: agent.id } });
	const url = publicUrl(key);
	await sql`UPDATE agent_identities SET profile_image_url = ${url}, updated_at = now() WHERE id = ${agent.id}`;
	logAudit({ userId: auth.userId, action: 'upload_agent_avatar', resourceId: agent.id, meta: { kind: 'image', bytes: buf.length } });
	return toolResult({
		status: 'attached',
		kind: 'image',
		agent_id: agent.id,
		profile_image_url: url,
		agent_url: `${env.APP_ORIGIN}/agents/${agent.id}`,
		note: 'The image is now the agent portrait (cards, leaderboards, share images). To give the agent a 3D body, upload a GLB.',
	});
}

// ── tools ────────────────────────────────────────────────────────────────────

export const toolDefs = [
	{
		name: 'get_agent',
		title: 'Get one agent you own',
		annotations: READ,
		description:
			"Read one of your agents: its settings, status, wallet, and everything deleting it would destroy (open runs, automations, memories, logged actions, wallet balance). Call this before delete_agent and show the user the result: its preview_id authorizes the delete.",
		inputSchema: {
			type: 'object',
			properties: { agent_id: AGENT_ID },
			required: ['agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:read',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('read your agents');
			const row = await api(() => loadOwnedAgent(args.agent_id, auth.userId));
			if (failed(row)) return row.__error;
			const agent = serializeAgent(row);
			const [[counts], recent] = await Promise.all([
				sql`
					SELECT
						(SELECT count(*)::int FROM agent_runs WHERE agent_id = ${row.id} AND status IN ('scheduled', 'queued', 'running', 'paused')) AS open_runs,
						(SELECT count(*)::int FROM agent_automations WHERE agent_id = ${row.id} AND enabled) AS enabled_automations,
						(SELECT count(*)::int FROM agent_automations WHERE agent_id = ${row.id}) AS automations,
						(SELECT count(*)::int FROM agent_memories WHERE agent_id = ${row.id}) AS memories,
						(SELECT count(*)::int FROM agent_actions WHERE agent_id = ${row.id}) AS actions
				`,
				sql`SELECT id, goal, status, summary, created_at FROM agent_runs WHERE agent_id = ${row.id} ORDER BY created_at DESC LIMIT 5`,
			]);
			const balance = agent.wallet.solana ? await getSolanaAddressBalances(agent.wallet.solana, 'mainnet') : null;
			const funded = balance && ((balance.sol || 0) > 0 || (balance.usdc || 0) > 0);
			return toolResult({
				agent,
				counts,
				wallet_balance: balance,
				recent_runs: recent.map((r) => ({ id: r.id, goal: r.goal.slice(0, 200), status: r.status, summary: r.summary, created_at: r.created_at })),
				delete_impact:
					`Deleting ${agent.name} cancels ${counts.open_runs} open run(s), switches off ${counts.enabled_automations} automation(s), and permanently erases ${counts.memories} memories and ${counts.actions} logged actions.` +
					(funded ? ' Its wallet still holds funds: withdraw them first from the agent wallet page.' : ''),
			});
		},
	},
	{
		name: 'update_agent',
		title: 'Edit an agent you own',
		annotations: IDEMPOTENT_WRITE,
		description:
			'Change an agent\'s settings. Pass only the fields to change. Validated by the same code as the REST API: name (1-80 chars), persona (public one-liner, up to 500), system_prompt (up to 8000), model (an id from the model catalog that supports tools), temperature (0-2), skills (up to 30 skill ids), strategy (a strategy preset id, or null to clear), inference_budget ({ daily, monthly } credit caps in USD, or null to remove). Use this to rename an agent or change its persona, prompt, model, skills, strategy or inference budget.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				name: { type: 'string', minLength: 1, maxLength: 80 },
				persona: { type: ['string', 'null'], maxLength: 500 },
				system_prompt: { type: ['string', 'null'], maxLength: 8000 },
				model: { type: ['string', 'null'] },
				temperature: { type: ['number', 'null'], minimum: 0, maximum: 2 },
				skills: { type: 'array', items: { type: 'string' }, maxItems: 30 },
				strategy: { type: ['string', 'null'] },
				inference_budget: {
					type: ['object', 'null'],
					properties: { daily: { type: ['number', 'null'], minimum: 0 }, monthly: { type: ['number', 'null'], minimum: 0 } },
					additionalProperties: false,
				},
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('edit your agents');
			const body = pick(args, {
				name: 'name',
				persona: 'persona',
				system_prompt: 'systemPrompt',
				model: 'model',
				temperature: 'temperature',
				skills: 'skills',
				strategy: 'strategy',
				inference_budget: 'inferenceBudget',
			});
			if (!Object.keys(body).length) return designedError('nothing_to_update', 'Pass at least one field to change.');
			const out = await api(async () => updateAgent(await loadOwnedAgent(args.agent_id, auth.userId), body));
			if (failed(out)) return out.__error;
			logAudit({ userId: auth.userId, action: 'update_agent', resourceId: args.agent_id, meta: { fields: Object.keys(body) } });
			return toolResult({ status: 'updated', agent: out, changed: Object.keys(args).filter((k) => k !== 'agent_id') });
		},
	},
	{
		name: 'delete_agent',
		title: 'Delete an agent you own',
		annotations: DESTRUCTIVE,
		description:
			'Delete an agent. Its open runs are cancelled, its automations are switched off, and its memories and logged actions are erased for good. Call get_agent first, show the user its delete_impact, and only after they clearly say yes call this with the preview_id and confirm_delete: true. Without confirm_delete the call is refused. Use this when the owner wants an agent gone for good; to pause it instead, use stop_agent.',
		inputSchema: {
			type: 'object',
			properties: { agent_id: AGENT_ID },
			required: ['agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('delete your agents');
			const out = await api(async () => deleteAgent(await loadOwnedAgent(args.agent_id, auth.userId)));
			if (failed(out)) return out.__error;
			logAudit({ userId: auth.userId, action: 'delete_agent', resourceId: args.agent_id, meta: { via: 'mcp' } });
			return toolResult({ status: 'deleted', agent_id: args.agent_id });
		},
	},
	{
		name: 'start_agent',
		title: 'Start an agent',
		annotations: IDEMPOTENT_WRITE,
		description:
			'Set an agent to running. Its automations fire again, its strategy loop ticks again, and its paused runs can be resumed. Starting a running agent is a no-op. Use this to bring a stopped agent back online after stop_agent.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('start your agents');
			const out = await api(async () => setAgentStatus(await loadOwnedAgent(args.agent_id, auth.userId), 'running'));
			if (failed(out)) return out.__error;
			logAudit({ userId: auth.userId, action: 'start_agent', resourceId: args.agent_id, meta: { via: 'mcp' } });
			return toolResult({ status: 'running', agent: out });
		},
	},
	{
		name: 'stop_agent',
		title: 'Stop an agent',
		annotations: IDEMPOTENT_WRITE,
		description:
			'Set an agent to stopped. Its automations stop firing, its strategy loop stops ticking, and its runs hold before their next step until it is started again. Nothing is deleted. Use this to pause an agent without losing anything; start_agent resumes it.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID }, required: ['agent_id'], additionalProperties: false },
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('stop your agents');
			const out = await api(async () => setAgentStatus(await loadOwnedAgent(args.agent_id, auth.userId), 'stopped'));
			if (failed(out)) return out.__error;
			logAudit({ userId: auth.userId, action: 'stop_agent', resourceId: args.agent_id, meta: { via: 'mcp' } });
			return toolResult({ status: 'stopped', agent: out });
		},
	},
	{
		name: 'upload_agent_avatar',
		title: 'Give an agent a 3D body or a portrait',
		annotations: { ...WRITE, openWorldHint: true },
		description:
			'Upload a GLB or an image for an agent, from a public https url or inline data (a data: URI or base64, up to about 1.4 MB; use url for anything bigger). A GLB is saved to your avatar library through the normal avatar ingest, attached as the agent\'s 3D body, and auto-rigged in the background if it arrived static. A PNG, JPEG, WebP or GIF becomes the agent\'s portrait image. Pass exactly one of url or data. Use this when the owner has a 3D model or a picture to give an agent its body or portrait.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				url: { type: 'string', format: 'uri', maxLength: 2048, description: 'Public https URL of a .glb or an image.' },
				data: { type: 'string', maxLength: 2_000_000, description: 'The file inline, as a data: URI or base64.' },
				name: { type: 'string', maxLength: 80, description: 'Name for the saved avatar (GLB only). Defaults to the agent name.' },
				visibility: { type: 'string', enum: ['public', 'unlisted', 'private'], description: 'Avatar visibility (GLB only). Defaults to your account default.' },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('upload an agent avatar');
			if (!args.url === !args.data) return designedError('invalid_request', 'Pass exactly one of url or data.');
			const agent = await api(() => loadOwnedAgent(args.agent_id, auth.userId));
			if (failed(agent)) return agent.__error;
			const rl = await limits.upload(auth.userId);
			if (!rl.success) return designedError('rate_limited', 'Too many uploads this hour. Try again shortly.');

			let buf;
			if (args.url) {
				const got = await fetchUpload(args.url);
				if (got.error) return got.error;
				buf = got.buf;
			} else {
				buf = decodeData(args.data).buf;
				if (!buf.length) return designedError('invalid_data', 'data decoded to zero bytes. Send a data: URI or base64.');
			}
			if (isValidGlbHeader(buf)) return attachGlb({ auth, agent, buf, sourceUrl: args.url || null, name: args.name, visibility: args.visibility });
			const kind = sniffImage(buf);
			if (kind) return attachImage({ auth, agent, buf, kind });
			return designedError('unsupported_file', 'That file is not a binary glTF (.glb) or a PNG, JPEG, WebP or GIF image.');
		},
	},
	{
		name: 'create_agent_run',
		title: 'Give an agent a goal to pursue on its own',
		annotations: WRITE,
		description:
			'Start an autonomous run: the agent works the goal through its read-only tool loop, one checkpointed step at a time. A run has a step budget (max_steps) and a dollar budget (budget_usd, credits spent on paid models; 0 keeps it on free model lanes and it can never spend a cent). Cancel takes effect between steps. When it ends it writes a plain-language summary, and every tool call it made is logged with a chained receipt (read them with get_agent_run_steps, or watch the replay on the agent page). Runs never sign or move funds. Use this when the owner wants an agent to work toward a goal on its own over several steps.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				goal: { type: 'string', minLength: 1, maxLength: 8000, description: 'What the agent should accomplish, in plain language.' },
				max_steps: { type: 'integer', minimum: 1, maximum: 60, default: 12, description: 'Step budget: model turns the run may take.' },
				budget_usd: { type: 'number', minimum: 0, maximum: 100, default: 0, description: 'Dollar budget for paid model calls, charged to your credits. 0 means free lanes only.' },
				tools_allowed: { type: 'array', items: { type: 'string' }, maxItems: 64, description: 'Restrict the run to these tools from the agent tool registry. Omit for all.' },
				model: { type: 'string', maxLength: 120, description: 'Preferred model id. Omit to use the agent\'s brain.' },
				temperature: { type: 'number', minimum: 0, maximum: 2 },
				scheduled_for: { type: 'string', format: 'date-time', description: 'Start later, at this ISO time. Omit to start now.' },
				wait_seconds: WAIT,
			},
			required: ['agent_id', 'goal'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('start agent runs');
			const row = await api(async () => {
				await loadOwnedAgent(args.agent_id, auth.userId);
				return createRun({
					agentId: args.agent_id,
					userId: auth.userId,
					goal: args.goal,
					model: args.model ?? null,
					temperature: args.temperature ?? null,
					toolsAllowed: args.tools_allowed ?? null,
					maxSteps: args.max_steps,
					budgetCreditsUsd: args.budget_usd,
					scheduledFor: args.scheduled_for ?? null,
					source: 'mcp',
				});
			});
			if (failed(row)) return row.__error;
			if (!row) return designedError('run_not_created', 'The run was not created. Try again.');
			const fresh = row.status === 'scheduled' ? row : await driveFor(row.id, auth.userId, args.wait_seconds);
			return toolResult({ status: 'created', ...runView(fresh) });
		},
	},
	{
		name: 'update_agent_run',
		title: 'Pause, resume, or raise the budget of a run',
		annotations: WRITE,
		description:
			'Pause a live run, resume a paused one, or raise its dollar budget (budget_usd; a budget can only be raised). A finished run cannot be changed. Use this to pause or resume a run in progress, or to give a run that is running out of budget more room.',
		inputSchema: {
			type: 'object',
			properties: {
				run_id: RUN_ID,
				action: { type: 'string', enum: ['pause', 'resume'] },
				budget_usd: { type: 'number', minimum: 0, maximum: 100, description: 'The new, higher dollar budget for paid model calls.' },
				wait_seconds: { ...WAIT, default: 0 },
			},
			required: ['run_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('manage agent runs');
			if (!args.action && args.budget_usd == null) return designedError('nothing_to_update', 'Pass action (pause or resume) or a higher budget_usd.');
			const row = await api(() => updateRun(args.run_id, auth.userId, { action: args.action ?? null, budgetCreditsUsd: args.budget_usd ?? null }));
			if (failed(row)) return row.__error;
			const fresh = args.action === 'resume' ? await driveFor(row.id, auth.userId, args.wait_seconds) : row;
			return toolResult({ status: 'updated', ...runView(fresh) });
		},
	},
	{
		name: 'cancel_agent_run',
		title: 'Cancel a run',
		annotations: IDEMPOTENT_WRITE,
		description:
			'Cancel a run. A queued, scheduled or paused run ends now; a running one ends before its next step, so the cancel lands within one step. The run keeps its steps, receipts and summary. Use this when a run should stop for good; to hold it and continue later, pause it with update_agent_run.',
		inputSchema: { type: 'object', properties: { run_id: RUN_ID }, required: ['run_id'], additionalProperties: false },
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('manage agent runs');
			const row = await api(() => cancelRun(args.run_id, auth.userId));
			if (failed(row)) return row.__error;
			const run = serializeRun(row);
			return toolResult({
				status: TERMINAL_RUN_STATUSES.has(row.status) ? row.status : 'cancel_requested',
				run,
				note: TERMINAL_RUN_STATUSES.has(row.status) ? run.summary || `The run ${row.status}.` : 'The run stops before its next step.',
			});
		},
	},
	{
		name: 'get_agent_run_steps',
		title: 'Read a run step by step',
		annotations: READ,
		description:
			'Read a run and its step trace: every model call, and every tool call paired with its result and a receipt. Receipts are sha256 digests chained step to step, and receipt_chain reports whether the chain recomputes cleanly (it does whenever no step was edited, dropped or reordered). Page with after (the last seq you have). Use this to see what a run did, check its receipts, or follow a live run step by step.',
		inputSchema: {
			type: 'object',
			properties: {
				run_id: RUN_ID,
				after: { type: 'integer', minimum: 0, default: 0, description: 'Return steps after this seq.' },
				limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 },
			},
			required: ['run_id'],
			additionalProperties: false,
		},
		scope: 'agents:read',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('read agent runs');
			const out = await api(async () => {
				const row = await getOwnedRun(args.run_id, auth.userId);
				const steps = await listRunSteps(args.run_id, auth.userId, { after: args.after, limit: args.limit });
				return { row, steps };
			});
			if (failed(out)) return out.__error;
			const { row, steps } = out;
			const full = args.after === 0 && steps.length < args.limit;
			return toolResult({
				...runView(row),
				steps,
				tool_traces: toolTraces(steps),
				receipt_chain: full ? verifyReceiptChain(row.id, steps) : { verified: null, note: 'Read from after: 0 in one page to verify the full chain.' },
				next_after: steps.length ? steps.at(-1).seq : args.after,
				has_more: steps.length === args.limit,
			});
		},
	},
	{
		name: 'automation_list',
		title: 'List automations',
		annotations: READ,
		description:
			'List automations: one agent\'s (pass agent_id) or every automation across your agents plus your account alert rules. Wallet rules and alert rules appear as the same shape with source wallet_intent or alert_rule. Call this first to find the automation id that automation_get, automation_update, automation_delete and automation_trigger take.',
		inputSchema: { type: 'object', properties: { agent_id: AGENT_ID }, additionalProperties: false },
		scope: 'agents:read',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('read your automations');
			const items = await api(async () => {
				if (args.agent_id) {
					const agent = await loadOwnedAgent(args.agent_id, auth.userId);
					return listAgentAutomations(agent.id);
				}
				return listUserAutomations(auth.userId);
			});
			if (failed(items)) return items.__error;
			return toolResult({ items, count: items.length, trigger_types: TRIGGER_TYPES, action_types: ACTION_TYPES });
		},
	},
	{
		name: 'automation_get',
		title: 'Get one automation',
		annotations: READ,
		description:
			'Read one automation: its trigger, action, spend limits, fire stats, next scheduled fire, and the runs it started. Call this before automation_delete and show the user the result: its preview_id authorizes the delete.',
		inputSchema: { type: 'object', properties: { automation_id: AUTOMATION_ID }, required: ['automation_id'], additionalProperties: false },
		scope: 'agents:read',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('read your automations');
			const a = await api(() => getAutomation(auth.userId, args.automation_id));
			if (failed(a)) return a.__error;
			return toolResult({ automation: a });
		},
	},
	{
		name: 'automation_create',
		title: 'Create an automation',
		annotations: WRITE,
		description:
			`Wire an agent to a trigger. Validated by the same code as the REST API. ${TRIGGER_DOC} ${ACTION_DOC} ` +
			'limits caps spend actions in USD: { perActionUsd, dailyUsd, totalUsd }. trigger_once switches it off after the first fire. ' +
			'A swap or transfer spends from the agent wallet on its own: the first call returns the recipient, amount, asset and chain for the owner to approve, then call again with confirm_spend: true. Connector keys cannot create spending automations. Use this when the owner wants an agent to act on its own when a price, schedule, balance, tip, launch or whale event happens.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: AGENT_ID,
				title: { type: 'string', maxLength: 80 },
				trigger: { type: 'object', properties: { type: { type: 'string', enum: [...TRIGGER_TYPES] } }, required: ['type'] },
				action: { type: 'object', properties: { type: { type: 'string', enum: [...ACTION_TYPES] } }, required: ['type'] },
				trigger_once: { type: 'boolean', default: false },
				limits: {
					type: 'object',
					properties: { perActionUsd: { type: 'number' }, dailyUsd: { type: 'number' }, totalUsd: { type: 'number' } },
					additionalProperties: false,
				},
				confirm_spend: { type: 'boolean', description: 'Required for swap and transfer, only after the owner approved the terms.' },
			},
			required: ['agent_id', 'trigger', 'action'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('create automations');
			const body = { title: args.title, trigger: args.trigger, action: args.action, triggerOnce: args.trigger_once === true, limits: args.limits };
			const norm = await api(async () => normalizeAutomation(body));
			if (failed(norm)) return norm.__error;
			if (SPEND_ACTIONS.has(norm.action.type)) {
				const refused = await assertMaySpend(auth, 'automation_create');
				if (refused) return refused;
				if (args.confirm_spend !== true) {
					return spendConfirmation('automation_create', spendTerms(await displayDestination(norm.action), norm.trigger, norm.limits), { title: norm.title });
				}
			}
			const created = await api(async () => {
				const agent = await loadOwnedAgent(args.agent_id, auth.userId);
				return createAutomation({ agent, userId: auth.userId, body: { ...body, confirm: args.confirm_spend === true }, source: 'mcp' });
			});
			if (failed(created)) return created.__error;
			logAudit({ userId: auth.userId, action: 'automation_create', resourceId: args.agent_id, meta: { automation_id: created.id, trigger: created.trigger.type, action: created.action.type } });
			return toolResult({ status: 'created', automation: created });
		},
	},
	{
		name: 'automation_update',
		title: 'Edit an automation',
		annotations: IDEMPOTENT_WRITE,
		description:
			'Change an automation. trigger and action patches merge over the stored config (send a new type to replace it), and the result is re-validated with the same rules as automation_create. enabled switches it on or off. Changing a swap or transfer automation (anything but switching it off) shows the spend terms first and needs confirm_spend: true. Use this to retune or switch an existing automation on or off instead of deleting and recreating it.',
		inputSchema: {
			type: 'object',
			properties: {
				automation_id: AUTOMATION_ID,
				title: { type: 'string', maxLength: 80 },
				trigger: { type: 'object' },
				action: { type: 'object' },
				trigger_once: { type: 'boolean' },
				limits: {
					type: 'object',
					properties: { perActionUsd: { type: 'number' }, dailyUsd: { type: 'number' }, totalUsd: { type: 'number' } },
					additionalProperties: false,
				},
				enabled: { type: 'boolean' },
				confirm_spend: { type: 'boolean' },
			},
			required: ['automation_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('edit automations');
			const current = await api(() => getAutomation(auth.userId, args.automation_id));
			if (failed(current)) return current.__error;
			const body = pick(args, { title: 'title', trigger: 'trigger', action: 'action', trigger_once: 'triggerOnce', limits: 'limits', enabled: 'enabled' });
			if (!Object.keys(body).length) return designedError('nothing_to_update', 'Pass at least one field to change.');
			// Wallet rules and alert rules listed as automations are edited on their own pages; the lib refuses them with not_editable.
			const nextType = current.source === 'automation' ? args.action?.type || current.action?.type : null;
			const onlyDisabling = args.enabled === false && Object.keys(body).length === 1;
			if (SPEND_ACTIONS.has(nextType) && !onlyDisabling) {
				const refused = await assertMaySpend(auth, 'automation_update');
				if (refused) return refused;
				if (args.confirm_spend !== true) {
					const action = args.action && args.action.type && args.action.type !== current.action.type ? args.action : { ...current.action, ...(args.action || {}) };
					const trigger = args.trigger ? { ...current.trigger, ...args.trigger } : current.trigger;
					return spendConfirmation('automation_update', spendTerms(await displayDestination(action), trigger, { ...current.limits, ...(args.limits || {}) }), { automation_id: args.automation_id });
				}
			}
			const out = await api(() => updateAutomation({ userId: auth.userId, id: args.automation_id, body: { ...body, confirm: args.confirm_spend === true } }));
			if (failed(out)) return out.__error;
			logAudit({ userId: auth.userId, action: 'automation_update', resourceId: out.agentId, meta: { automation_id: out.id, fields: Object.keys(body) } });
			return toolResult({ status: 'updated', automation: out });
		},
	},
	{
		name: 'automation_delete',
		title: 'Delete an automation',
		annotations: DESTRUCTIVE,
		description:
			'Delete an automation (or a wallet rule or alert rule listed as one). Call automation_get first, show the user what it does, and only after they say yes call this with the preview_id and confirm_delete: true. Runs it already started keep going; cancel them with cancel_agent_run. Use this when an automation should be removed for good; to pause it, use automation_update with enabled: false.',
		inputSchema: { type: 'object', properties: { automation_id: AUTOMATION_ID }, required: ['automation_id'], additionalProperties: false },
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('delete automations');
			const out = await api(() => deleteAutomation(auth.userId, args.automation_id));
			if (failed(out)) return out.__error;
			logAudit({ userId: auth.userId, action: 'automation_delete', resourceId: args.automation_id, meta: { source: out.source } });
			return toolResult({ status: 'deleted', ...out });
		},
	},
	{
		name: 'automation_trigger',
		title: 'Fire an automation now',
		annotations: { ...WRITE, destructiveHint: true, openWorldHint: true },
		description:
			'Run an automation\'s action right now, outside its trigger, once per call. It still passes every guard a real fire does (the agent must be running, spend policy and caps apply). An agent_prompt automation starts a run (driven inline for wait_seconds). A swap or transfer shows the spend terms first and needs confirm_spend: true. Use this to test an automation, or to fire it once on demand without waiting for its trigger.',
		inputSchema: {
			type: 'object',
			properties: { automation_id: AUTOMATION_ID, confirm_spend: { type: 'boolean' }, wait_seconds: WAIT },
			required: ['automation_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		async handler(args, auth) {
			if (!auth.userId) return signInRequired('fire automations');
			const current = await api(() => getAutomation(auth.userId, args.automation_id));
			if (failed(current)) return current.__error;
			if (current.source === 'automation' && SPEND_ACTIONS.has(current.action?.type)) {
				const refused = await assertMaySpend(auth, 'automation_trigger');
				if (refused) return refused;
				if (args.confirm_spend !== true) {
					return spendConfirmation('automation_trigger', spendTerms(current.action, { type: 'manual', note: 'fires once, now' }, current.limits), { automation_id: args.automation_id });
				}
			}
			const out = await api(() => triggerAutomation({ userId: auth.userId, id: args.automation_id, confirm: args.confirm_spend === true }));
			if (failed(out)) return out.__error;
			logAudit({ userId: auth.userId, action: 'automation_trigger', resourceId: out.automation.agentId, meta: { automation_id: args.automation_id, status: out.result.status } });
			const payload = { status: out.result.status, result: out.result, automation: out.automation };
			if (out.result.runId) Object.assign(payload, runView(await driveFor(out.result.runId, auth.userId, args.wait_seconds)));
			return toolResult(payload);
		},
	},
];
