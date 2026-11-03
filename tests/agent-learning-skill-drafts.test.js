// Skills learned from experience: when a run qualifies for a draft, the draft
// lands disabled, edits are versioned, and rollback restores a prior version.
// Real migrations in PGlite; the model completion is injected.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningDb, resetLearningDb, seedAccount } from './helpers/learning-db.js';

const state = vi.hoisted(() => ({ pg: null }));
vi.mock('../api/_lib/db.js', async () => {
	const { sqlOver: make } = await import('./helpers/learning-db.js');
	return { sql: make(() => state.pg), isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
const notify = vi.hoisted(() => ({ insertNotification: vi.fn() }));
vi.mock('../api/_lib/notify.js', () => notify);

const sd = await import('../api/_lib/agent-learning/skill-drafts.js');
const { updateMemorySettings } = await import('../api/_lib/agent-learning/settings.js');

const DRAFT = {
	name: 'Check token holders',
	description: 'When asked who holds a token and how concentrated it is.',
	tags: ['tokens'],
	content: [
		'## When to use',
		'The owner asks who holds a token and how concentrated the supply is.',
		'## Steps',
		'1. Call get_token_holders for the mint.',
		'2. Call get_token_supply and divide.',
		'## Checks',
		'Confirm the mint matches what the owner named.',
		'## Output',
		'Top holders as percentages with a one line summary.',
	].join('\n'),
};
const complete = vi.fn(async () => ({ text: JSON.stringify(DRAFT), model: 'test-model' }));

const calls = (n, tools = ['get_token_holders', 'get_token_supply']) =>
	Array.from({ length: n }, (_, i) => ({ tool: tools[i % tools.length], args: { mint: 'THREEsynthetic1111' }, result: { ok: true } }));

let a;
let b;
beforeEach(async () => {
	state.pg ||= await createLearningDb();
	await resetLearningDb(state.pg);
	a = await seedAccount(state.pg, 'alice');
	b = await seedAccount(state.pg, 'bob');
	complete.mockClear();
	notify.insertNotification.mockClear();
});

const draft = (over = {}) =>
	sd.draftSkillFromRun({ agentId: a.agentId, userId: a.userId, runRef: 'run-1', goal: 'who holds the token', toolCalls: calls(5), finalAnswer: 'Top holder owns 12%.', complete, ...over });

describe('qualifiesForDraft', () => {
	it('honors the tool-call and distinct-tool minimums', () => {
		expect(sd.qualifiesForDraft(calls(sd.SKILL_DRAFT_MIN_TOOL_CALLS - 1))).toBe(false);
		expect(sd.qualifiesForDraft(calls(8, ['same']))).toBe(false);
		expect(sd.qualifiesForDraft(calls(sd.SKILL_DRAFT_MIN_TOOL_CALLS))).toBe(true);
	});

	it('does not count failed or blocked calls', () => {
		const mixed = [...calls(3), { tool: 'x', error: 'boom' }, { tool: 'y', blocked: true }];
		expect(sd.qualifiesForDraft(mixed)).toBe(false);
	});
});

describe('bumpPatch', () => {
	it('moves the patch number and repairs a malformed version', () => {
		expect(sd.bumpPatch('1.0.0')).toBe('1.0.1');
		expect(sd.bumpPatch('2.4.9')).toBe('2.4.10');
		expect(sd.bumpPatch('weird')).toBe('1.0.1');
	});
});

describe('draftSkillFromRun', () => {
	it('saves a disabled draft, records version 1 and notifies the owner', async () => {
		const out = await draft();
		expect(out.status).toBe('drafted');
		expect(out.skill).toMatchObject({ enabled: false, source: 'experience', reviewed_at: null, version: '1.0.0' });
		const { versions } = await sd.listSkillVersions({ agentId: a.agentId, userId: a.userId, skillId: out.skill.id });
		expect(versions.map((v) => v.version_no)).toEqual([1]);
		expect(notify.insertNotification).toHaveBeenCalledWith(a.userId, 'skill_draft_ready', expect.objectContaining({ skill_id: out.skill.id }));
	});

	it('drafts once per run even when the hook fires twice', async () => {
		await draft();
		const again = await draft();
		expect(again).toMatchObject({ status: 'skipped', reason: 'already_drafted' });
		expect(complete).toHaveBeenCalledTimes(1);
	});

	it('skips a run that is too small without calling the model', async () => {
		const out = await draft({ toolCalls: calls(2) });
		expect(out).toMatchObject({ status: 'skipped', reason: 'not_enough_tool_calls' });
		expect(complete).not.toHaveBeenCalled();
	});

	it('writes nothing when memory is off or skill drafts are off', async () => {
		await updateMemorySettings(a.userId, { skill_drafts_enabled: false });
		expect(await draft()).toMatchObject({ status: 'skipped', reason: 'drafts_disabled' });
		await updateMemorySettings(a.userId, { skill_drafts_enabled: true, enabled: false });
		expect(await draft({ runRef: 'run-2' })).toMatchObject({ status: 'skipped', reason: 'drafts_disabled' });
		expect((await state.pg.query('select count(*)::int as n from agent_custom_skills')).rows[0].n).toBe(0);
		expect(complete).not.toHaveBeenCalled();
	});

	it("refuses to draft onto an agent the account does not own", async () => {
		const out = await draft({ userId: b.userId });
		expect(out).toMatchObject({ status: 'skipped', reason: 'not_owner' });
	});

	it('reports an unusable model reply instead of saving junk', async () => {
		const out = await draft({ complete: async () => ({ text: 'sorry, no JSON here' }) });
		expect(out).toMatchObject({ status: 'failed', reason: 'unusable_draft' });
	});
});

describe('review, edit and rollback', () => {
	const ids = async () => {
		const { skill } = await draft();
		return { agentId: a.agentId, userId: a.userId, skillId: skill.id, skill };
	};

	it('enables a draft and marks it reviewed', async () => {
		const { skillId, agentId, userId } = await ids();
		const reviewed = await sd.reviewLearnedSkill({ agentId, userId, skillId, enable: true });
		expect(reviewed.enabled).toBe(true);
		expect(reviewed.reviewed_at).not.toBeNull();
		const off = await sd.reviewLearnedSkill({ agentId, userId, skillId, enable: false });
		expect(off.enabled).toBe(false);
	});

	it('versions an agent edit, bumps the patch, and rollback restores the old text as a new version', async () => {
		const { skillId, agentId, userId, skill } = await ids();
		const edit = await sd.proposeSkillEdit({ agentId, userId, skillId, content: `${skill.content}\n\nAlso check the holder count.`, note: 'add holder count check' });
		expect(edit.skill.version).toBe('1.0.1');
		expect(edit.version.version_no).toBe(2);

		const back = await sd.rollbackSkill({ agentId, userId, skillId, versionNo: 1 });
		expect(back.skill.content).toBe(skill.content);
		expect(back.skill.version).toBe('1.0.2');
		expect(back.version).toMatchObject({ version_no: 3, author: 'rollback' });

		const list = await sd.listLearnedSkills({ agentId, userId });
		expect(list[0].version_count).toBe(3);
	});

	it('refuses a rollback to the version already live and to a version that does not exist', async () => {
		const { skillId, agentId, userId } = await ids();
		await expect(sd.rollbackSkill({ agentId, userId, skillId, versionNo: 1 })).rejects.toMatchObject({ code: 'no_change' });
		await expect(sd.rollbackSkill({ agentId, userId, skillId, versionNo: 9 })).rejects.toMatchObject({ status: 404 });
	});

	it('blocks agent edits while learning is off', async () => {
		const { skillId, agentId, userId, skill } = await ids();
		await updateMemorySettings(userId, { skill_drafts_enabled: false });
		await expect(sd.proposeSkillEdit({ agentId, userId, skillId, content: `${skill.content} more`, note: 'x' })).rejects.toMatchObject({ code: 'learning_disabled' });
	});

	it("does not let another account review, edit or roll back the skill", async () => {
		const { skillId, agentId } = await ids();
		await expect(sd.reviewLearnedSkill({ agentId, userId: b.userId, skillId, enable: true })).rejects.toMatchObject({ status: 403 });
		await expect(sd.rollbackSkill({ agentId, userId: b.userId, skillId, versionNo: 1 })).rejects.toMatchObject({ status: 403 });
	});
});
