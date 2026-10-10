// External skill import over MCP: browse public SKILL.md registries, scan a
// skill, install it once the owner approves, diff an installed import against
// upstream, fork a skill and publish one.
//
// Every call goes through api/_lib/skill-import-store.js, the same store the
// REST routes (/api/skill-imports/*) and /skills/import use, so a scan or an
// install from a model lands exactly as it would from the browser.
//
// Tool policy: browsing is `read`. Scanning, installing, update checks, forks
// and publishing are `write` (each is undone by deleting the skill, refusing
// the request or unpublishing). Installing still never happens on the model's
// say-so alone: install_external_skill takes the request_id of a scan the
// owner has seen and refuses without `owner_approved: true`, and a skill that
// asks to spend, sign or message also needs `acknowledge_gated: true`.
// skill_publish refuses without `confirm_publish: true`.

import { limits } from '../../_lib/rate-limit.js';
import { CustomSkillError } from '../../_lib/agent-custom-skills.js';
import { CATEGORIES } from '../../_lib/skill-import-sources.js';
import {
	browse,
	scanForInstall,
	decideRequest,
	getRequest,
	updateDiff,
	forkSkill,
	publishSkill,
	forkSchema,
	publishSchema,
} from '../../_lib/skill-import-store.js';

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const policy = (tier, extra = {}) => ({ 'three.ws/policy': { group: 'skills', tier, ...extra } });
const PAGE = 'https://three.ws/skills/import';

function toolResult(structured, { isError = false } = {}) {
	return {
		content: [{ type: 'text', text: JSON.stringify(structured, null, 2) }],
		structuredContent: structured,
		...(isError ? { isError: true } : {}),
	};
}

function designedError(status, message, extra = {}) {
	return toolResult({ status, error: status, message, ...extra }, { isError: true });
}

function rpcError(code, message, data) {
	const e = new Error(message);
	e.code = code;
	e.data = data;
	return e;
}

function ownerTool(fn) {
	return async (args, auth) => {
		if (!auth.userId) {
			return designedError(
				'sign_in_required',
				'Skills install onto an agent you own. Connect with your three.ws account (run `npx three-ws setup`, or OAuth in your client) and retry.',
			);
		}
		const rl = await limits.mcpUser(auth.userId);
		if (!rl.success) throw rpcError(-32000, 'rate_limited', { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) });
		try {
			return await fn(args, auth);
		} catch (err) {
			if (err instanceof CustomSkillError) return designedError(err.code, err.message, err.extra);
			throw err;
		}
	};
}

function zodMessage(result) {
	return result.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ');
}

/** The scan as a model should relay it: everything but the raw bytes up front. */
function scanSummary(r, { includeContent = false } = {}) {
	return {
		request_id: r.id,
		status: r.status,
		verdict: r.verdict,
		gated: r.gated,
		skill: { key: r.skill.key, name: r.skill.name, description: r.skill.description, category: r.skill.category },
		provenance: {
			registry: r.provenance.registry?.label,
			repo_url: r.provenance.repo_url,
			source_url: r.provenance.source_url,
			path: r.provenance.path,
			commit: r.provenance.commit,
			sha256: r.provenance.sha256,
			license: r.provenance.license?.spdx || null,
			author: r.provenance.author,
		},
		capabilities: Object.fromEntries(Object.entries(r.scan.capabilities).map(([k, c]) => [k, c.requested ? c.evidence.slice(0, 3) : false])),
		requested_tools: r.skill.requested_tools || [],
		findings: r.scan.findings.map((f) => ({ severity: f.severity, rule: f.rule, message: f.message, line: f.line })),
		guardian: r.scan.guardian?.status === 'ok' ? r.scan.guardian.decision : r.scan.guardian?.status,
		tokens: r.scan.tokens,
		expires_at: r.expires_at,
		review_url: `${PAGE}?view=requests&request=${r.id}`,
		...(includeContent ? { content: r.content } : { content_preview: r.content.slice(0, 1200) }),
	};
}

const agentId = { type: 'string', format: 'uuid', description: 'Your agent id (uuid). list_my_agents lists them.' };
const skillId = { type: 'string', format: 'uuid', description: 'The skill id (uuid) from list_custom_skills.' };

export const toolDefs = [
	{
		name: 'browse_external_skills',
		title: 'Browse external skill registries',
		annotations: READ,
		_meta: policy('read'),
		description:
			'Browse SKILL.md skills from public registries: the three.ws community repository, the public Anthropic agent skills repository, skills published on three.ws, and any GitHub repository or manifest the owner added. Each skill carries its registry, pinned commit or sha256, licence, author, category (defi, intelligence, social, infrastructure, security, data) and how many agents installed it. Skills whose licence does not permit reuse are listed under `excluded` with the reason, never offered. Reads only. To install one, call scan_external_skill with its `key`. Use this when the owner wants a ready-made skill for an agent instead of writing one.',
		inputSchema: {
			type: 'object',
			properties: {
				registry: { type: 'string', maxLength: 500, description: 'Limit to one registry key (from a previous result), e.g. "github:nirholas/three.ws/community-skills/skills" or "published".' },
				category: { type: 'string', enum: CATEGORIES, description: 'Limit to one category.' },
				q: { type: 'string', maxLength: 100, description: 'Free text matched against name, description, tags and slug.' },
				limit: { type: 'integer', minimum: 1, maximum: 100, default: 25, description: 'Most skills to return, most installed first.' },
			},
			additionalProperties: false,
		},
		async handler(args, auth) {
			try {
				const out = await browse(auth.userId || null, { registry: args.registry || null, category: args.category || null, q: args.q || null });
				const limit = args.limit || 25;
				return toolResult({
					registries: out.registries,
					categories: out.categories,
					count: out.skills.length,
					skills: out.skills.slice(0, limit).map((s) => ({
						key: s.key,
						name: s.name,
						description: s.description,
						category: s.category,
						registry: s.registry.label,
						license: s.license.spdx,
						author: s.author,
						installs: s.installs,
						requested_tools: s.requested_tools,
						pin: s.pin,
						source_url: s.source_url,
					})),
					excluded: out.excluded.slice(0, 20),
					browse_url: PAGE,
				});
			} catch (err) {
				if (err instanceof CustomSkillError) return designedError(err.code, err.message, err.extra);
				throw err;
			}
		},
	},
	{
		name: 'scan_external_skill',
		title: 'Scan an external skill for install',
		annotations: WRITE,
		_meta: policy('write'),
		description:
			'Fetch one external skill at its pinned revision and scan it before install: licence, size and token budget, hidden or overriding instructions, secret harvesting, exfiltration links, hardcoded payout addresses, and whether it asks to spend, sign or send messages (which puts it under the spend gate). Opens an import request that holds the exact scanned bytes for 24 hours; nothing is installed. Show the owner the provenance, verdict, findings and capabilities, and only after they say yes call install_external_skill with the request_id. A `refused` verdict can never be installed. Call this first for any skill picked from browse_external_skills; nothing can be installed without its request_id.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentId,
				registry: { type: 'string', maxLength: 500, description: 'Registry key from browse_external_skills.' },
				skill: { type: 'string', maxLength: 300, description: 'The skill `key` from browse_external_skills (or its slug within the registry).' },
			},
			required: ['agent_id', 'registry', 'skill'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args, auth) => {
			const rl = await limits.skillImportScanUser(auth.userId);
			if (!rl.success) throw rpcError(-32000, 'rate_limited', { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) });
			const request = await scanForInstall(auth.userId, args);
			return toolResult({
				...scanSummary(request),
				next:
					request.verdict === 'refused'
						? 'The scan refused this skill. Tell the owner why (the block findings); it cannot be installed.'
						: `Show the owner this report and ask whether to install it.${request.gated ? ' It asks to spend, sign or message, so tell them it will run under the spend gate.' : ''} Then call install_external_skill with request_id and owner_approved: true.`,
			});
		}),
	},
	{
		name: 'install_external_skill',
		title: 'Install a scanned external skill',
		annotations: WRITE,
		_meta: policy('write'),
		description:
			'Install (or, for an update request, apply) exactly the bytes a scan_external_skill or external_skill_update_diff request holds, as a prompt-only skill on the agent. Only call this after the owner saw that scan and explicitly approved; pass owner_approved: true. A skill that asks to spend, sign or message also needs acknowledge_gated: true, and runs under the spend gate: any transfer the agent proposes while it is active is held unless the owner\'s own message asked for that amount and recipient. To decline instead, pass decision: "refuse". Call this once the owner has approved the scanned request, within its 24 hours.',
		inputSchema: {
			type: 'object',
			properties: {
				request_id: { type: 'string', format: 'uuid', description: 'The request_id from scan_external_skill or external_skill_update_diff.' },
				owner_approved: { type: 'boolean', description: 'Must be true: the owner saw the scan and said yes.' },
				acknowledge_gated: { type: 'boolean', default: false, description: 'Required true for a gated skill, after telling the owner it will run under the spend gate.' },
				decision: { type: 'string', enum: ['approve', 'refuse'], default: 'approve', description: 'approve installs; refuse closes the request.' },
			},
			required: ['request_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args, auth) => {
			const decision = args.decision || 'approve';
			if (decision === 'approve' && args.owner_approved !== true) {
				const current = await getRequest(auth.userId, args.request_id);
				return designedError(
					'owner_approval_required',
					'Installing needs the owner\'s explicit yes. Show them the scan below, then retry with owner_approved: true once they approve.',
					{ preview_tool: 'scan_external_skill', confirm_flag: 'owner_approved', scan: scanSummary(current) },
				);
			}
			const out = await decideRequest(auth.userId, args.request_id, { decision, acknowledge_gated: args.acknowledge_gated === true });
			return toolResult({
				status: decision === 'approve' ? (out.request.replaces_skill_id ? 'updated' : 'installed') : 'refused',
				request_id: out.request.id,
				gated: out.request.gated,
				...(out.skill ? { skill: { id: out.skill.id, slug: out.skill.slug, name: out.skill.name, injected: out.skill.injected, provenance: out.skill.external }, budget: out.budget } : {}),
			});
		}),
	},
	{
		name: 'external_skill_update_diff',
		title: 'Check an imported skill for upstream changes',
		annotations: WRITE,
		_meta: policy('write'),
		description:
			'Compare an installed external skill with its registry\'s current revision. Installed imports are pinned, so upstream changes never apply on their own. If upstream changed, returns the unified diff, line stats, whether the owner edited their copy, and a freshly scanned update request; show the owner the diff and scan, and apply it with install_external_skill only after they approve. Unchanged returns changed: false. Use this when the owner asks whether an imported skill has upstream updates.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentId,
				skill_id: skillId,
				open_request: { type: 'boolean', default: true, description: 'false previews the diff without opening an update request.' },
			},
			required: ['agent_id', 'skill_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args, auth) => {
			const rl = await limits.skillImportScanUser(auth.userId);
			if (!rl.success) throw rpcError(-32000, 'rate_limited', { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) });
			const out = await updateDiff(auth.userId, { agent_id: args.agent_id, skill_id: args.skill_id, open_request: args.open_request !== false });
			return toolResult({ ...out, request: out.request ? scanSummary(out.request) : null });
		}),
	},
	{
		name: 'skill_fork',
		title: 'Fork a skill',
		annotations: { ...WRITE, openWorldHint: false },
		_meta: policy('write'),
		description:
			'Copy a skill onto one of your agents as your own editable custom skill: any skill on any agent you own (imported, community or hand-written), or a skill published on three.ws by slug. The fork records where it came from and keeps the upstream licence; a fork of a gated skill stays gated. Edit it with update_custom_skill, then share it with skill_publish. Use this when the owner wants to change a skill they did not write, or keep their own copy of one.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: { ...agentId, description: 'The agent that receives the fork.' },
				skill_id: { type: 'string', format: 'uuid', description: 'A skill id on any agent you own. Give this or published_slug.' },
				published_slug: { type: 'string', maxLength: 80, description: 'A slug from the three.ws published registry. Give this or skill_id.' },
				name: { type: 'string', minLength: 2, maxLength: 80, description: 'Name for the fork; defaults to the original name.' },
			},
			required: ['agent_id'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args, auth) => {
			const parsed = forkSchema.safeParse(args);
			if (!parsed.success) return designedError('validation_error', zodMessage(parsed));
			const out = await forkSkill(auth.userId, parsed.data);
			return toolResult({ status: 'forked', skill: { id: out.skill.id, slug: out.skill.slug, name: out.skill.name, gated: out.skill.gated, fork: out.skill.fork }, budget: out.budget });
		}),
	},
	{
		name: 'skill_publish',
		title: 'Publish a skill to the three.ws registry',
		annotations: { ...WRITE, openWorldHint: false },
		_meta: policy('write'),
		description:
			'Publish one of your own skills (hand-written, or a fork you changed) to the public three.ws skill registry, where anyone can browse and import it with you credited as author. The skill is scanned first and a refused scan cannot be published; an unchanged import is someone else\'s work and must be forked and changed first; a fork of copyleft work keeps that licence. Publishing again replaces the public copy. Ask the owner first, then pass confirm_publish: true. Use this when the owner wants to share a skill they wrote or changed with everyone on three.ws.',
		inputSchema: {
			type: 'object',
			properties: {
				agent_id: agentId,
				skill_id: skillId,
				license: { type: 'string', enum: publishSchema.shape.license.options, description: 'The licence to publish under (SPDX id).' },
				category: { type: 'string', enum: CATEGORIES, description: 'Browse category.' },
				confirm_publish: { type: 'boolean', description: 'Must be true: the owner agreed to make this skill public.' },
			},
			required: ['agent_id', 'skill_id', 'license', 'category'],
			additionalProperties: false,
		},
		scope: 'agents:write',
		handler: ownerTool(async (args, auth) => {
			if (args.confirm_publish !== true) {
				return designedError('confirmation_required', 'Publishing makes the skill public. Ask the owner, then retry with confirm_publish: true.', { confirm_flag: 'confirm_publish' });
			}
			const parsed = publishSchema.safeParse(args);
			if (!parsed.success) return designedError('validation_error', zodMessage(parsed));
			return toolResult({ status: 'published', ...(await publishSkill(auth.userId, parsed.data)) });
		}),
	},
];
