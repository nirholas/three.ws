// What the learning loop knows about a person never leaves their account:
// not into a marketplace sale, not into a buyer's prompts, not into the
// community skills registry. Real migrations in PGlite; the marketplace
// custody module runs its own SQL unchanged.

import { readFileSync, readdirSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningDb, resetLearningDb, seedAccount } from './helpers/learning-db.js';

const state = vi.hoisted(() => ({ pg: null }));
vi.mock('../api/_lib/db.js', async () => {
	const { sqlOver: make } = await import('./helpers/learning-db.js');
	return { sql: make(() => state.pg), isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));

const custody = await import('../api/_lib/agent-market/custody.js');
const memory = await import('../api/_lib/agent-learning/memory.js');
const um = await import('../api/_lib/agent-learning/user-model.js');
const { updateMemorySettings, getMemorySettings } = await import('../api/_lib/agent-learning/settings.js');

let seller;
let buyer;
const SKILL_BODY = '## When to use\nWhen the owner asks for a holder report.\n## Steps\n1. Call a tool.\n## Checks\nVerify the mint.\n## Output\nA short list.';

async function seedLearning() {
	await memory.saveMemory({ agentId: seller.agentId, userId: seller.userId, kind: 'preference', content: 'seller wants answers in haiku' });
	await um.addUserModelEntry(seller.userId, { section: 'identity', content: 'Seller runs a private fund' });
	await updateMemorySettings(seller.userId, { nudge_every_turns: 9 });
	await state.pg.query(
		`insert into agent_custom_skills (agent_id, user_id, slug, name, content, enabled, source, source_run_id)
		 values ($1, $2, 'holder-report', 'Holder report', $3, true, 'experience', 'run-x'),
		        ($1, $2, 'hand-written', 'Hand written', $3, true, 'custom', null)`,
		[seller.agentId, seller.userId, SKILL_BODY],
	);
	await state.pg.query(
		`insert into agent_session_summaries (session_key, user_id, agent_id, content_hash, summary)
		 values ('s1', $1, $2, 'h', 'the seller discussed a private fund')`,
		[seller.userId, seller.agentId],
	);
}

beforeEach(async () => {
	state.pg ||= await createLearningDb();
	await resetLearningDb(state.pg);
	seller = await seedAccount(state.pg, 'seller');
	buyer = await seedAccount(state.pg, 'buyer');
	await seedLearning();
});

describe('marketplace transfer', () => {
	it('drops memories, experience-drafted skills and session summaries when the listing excludes history', async () => {
		await custody.detachHistory({ agent: { id: seller.agentId } });
		const count = async (t, where = 'true') => (await state.pg.query(`select count(*)::int as n from ${t} where agent_id = $1 and ${where}`, [seller.agentId])).rows[0].n;
		expect(await count('agent_memories')).toBe(0);
		expect(await count('agent_custom_skills', `source = 'experience'`)).toBe(0);
		expect(await count('agent_session_summaries')).toBe(0);
		// A skill the seller wrote by hand is part of the agent, not of their private history.
		expect(await count('agent_custom_skills', `source = 'custom'`)).toBe(1);
	});

	it("never moves the seller's user model or memory settings to the buyer", async () => {
		for (const [, run] of custody.ownerMoves(seller.agentId, seller.userId, buyer.userId)) {
			await run().catch((err) => {
				if (err?.code !== '42P01') throw err;
			});
		}
		expect((await um.getUserModel(seller.userId)).count).toBe(1);
		expect((await um.getUserModel(buyer.userId)).count).toBe(0);
		expect((await getMemorySettings(seller.userId)).nudge_every_turns).toBe(9);
		expect((await getMemorySettings(buyer.userId)).nudge_every_turns).toBe(6);
	});

	it("keeps the seller's memories and user model out of the buyer's prompt even when history is kept", async () => {
		await state.pg.query(`update agent_identities set user_id = $1 where id = $2`, [buyer.userId, seller.agentId]);
		const section = await memory.memoryPromptSection({ agentId: seller.agentId, userId: buyer.userId });
		expect(section.block).not.toMatch(/haiku|private fund/);
		expect(await memory.memoryCounts(buyer.userId)).toEqual({ fact: 0, preference: 0, procedure: 0 });
	});
});

describe('community skills registry', () => {
	it('is built from files in the repo, never from the database or the learning layer', () => {
		for (const file of ['api/_lib/community-skills.js', 'api/skills/community.js']) {
			const src = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
			expect(src, file).not.toMatch(/agent-learning|agent_custom_skills|agent_memories|user_model_entries|_lib\/db\.js/);
		}
	});

	it('lists no skill drafted from experience', () => {
		const registry = JSON.parse(readFileSync(new URL('../community-skills/registry.json', import.meta.url), 'utf8'));
		expect(registry.skills.length).toBeGreaterThan(0);
		expect(registry.skills.filter((s) => s.source === 'experience' || s.source_run_id)).toEqual([]);
		const folders = readdirSync(new URL('../community-skills/', import.meta.url));
		expect(folders.length).toBeGreaterThan(0);
	});
});
