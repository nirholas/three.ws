// threews-agent MCP: what the agent learning loop knows and is allowed to do.
//
//   read  get_learning_status
//
// Read only. Reports the account's memory switch, skill-draft switch and nudge
// cadence, how many memories each kind holds, the size of the user-model
// document, and how many skills learned from experience wait for review. The
// owner changes any of it on /settings/memory; this tool never writes.

import { hasScope } from '../_lib/auth.js';
import { limits } from '../_lib/rate-limit.js';
import { getMemorySettings } from '../_lib/agent-learning/settings.js';
import { memoryCounts } from '../_lib/agent-learning/memory.js';
import { getUserModel } from '../_lib/agent-learning/user-model.js';
import { learnedSkillCounts } from '../_lib/agent-learning/skill-drafts.js';

const SETTINGS_URL = 'https://three.ws/settings/memory';
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

function refusal(text, reason, extra = {}) {
	return { content: [{ type: 'text', text }], structuredContent: { ok: false, reason, ...extra }, isError: true };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export const learningToolDefs = [
	{
		name: 'get_learning_status',
		title: 'Read what the agent learning loop remembers',
		group: 'agents',
		tier: 'read',
		annotations: READ,
		description:
			"The account's agent learning state: whether memory is on, whether agents may draft skills from experience, how often they are nudged to save memories, how many facts, preferences and procedures they remember, how many lines the user-model document holds, and how many learned skills wait for the owner's review. Use this when the user asks what their agents remember about them, whether memory is on, or whether there are learned skills to review. Changes happen on three.ws/settings/memory; this tool never writes.",
		inputSchema: { type: 'object', properties: {}, additionalProperties: false },
		handler: async (_args, auth) => {
			const rl = await limits.mcpAgent(auth.userId || auth.rateKey || 'anon');
			if (!rl.success) {
				throw Object.assign(new Error('rate_limited'), { code: -32000, data: { retry_after: Math.ceil((rl.reset - Date.now()) / 1000) } });
			}
			if (!auth.userId) return refusal('Sign in to three.ws to read what your agents remember.', 'auth_required', { signed_in: false });
			if (!hasScope(auth.scope, 'memory:read') && !hasScope(auth.scope, 'memory:write')) {
				return refusal('Reading agent memory needs the memory:read scope. Re-authorize with it granted.', 'insufficient_scope', { required: 'memory:read' });
			}

			const [settings, memories, userModel, skills] = await Promise.all([
				getMemorySettings(auth.userId),
				memoryCounts(auth.userId),
				getUserModel(auth.userId),
				learnedSkillCounts(auth.userId),
			]);
			const remembered = memories.fact + memories.preference + memories.procedure;
			const status = {
				ok: true,
				settings: {
					enabled: settings.enabled,
					skill_drafts_enabled: settings.skill_drafts_enabled,
					nudge_every_turns: settings.nudge_every_turns,
					updated_at: settings.updated_at,
				},
				memories: { ...memories, total: remembered },
				user_model: { entries: userModel.count, max_entries: userModel.max_entries },
				learned_skills: skills,
				settings_url: SETTINGS_URL,
			};

			const lines = [
				settings.enabled
					? `Memory is on. Agents are nudged to save what they learn every ${settings.nudge_every_turns} turns.`
					: 'Memory is off: agents neither save nor read memories for this account.',
				settings.skill_drafts_enabled && settings.enabled
					? 'Agents may draft skills from successful runs; drafts stay off until you enable them.'
					: 'Skill drafting from experience is off.',
				`Remembered: ${plural(memories.fact, 'fact')}, ${plural(memories.preference, 'preference')}, ${plural(memories.procedure, 'procedure')}.`,
				`User model: ${plural(userModel.count, 'line')} of ${userModel.max_entries}.`,
				skills.awaiting_review
					? `${plural(skills.awaiting_review, 'learned skill')} ${skills.awaiting_review === 1 ? 'waits' : 'wait'} for your review (${skills.enabled} enabled, ${skills.total} learned in all).`
					: `No learned skills wait for review (${skills.enabled} enabled, ${skills.total} learned in all).`,
				`Review, edit, delete or switch any of this off at ${SETTINGS_URL}.`,
			];
			return { content: [{ type: 'text', text: lines.join('\n') }], structuredContent: status };
		},
	},
];
