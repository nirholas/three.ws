// The per-account user model: grouped by section, deduplicated, owner-editable,
// and never visible across accounts. Real migration, PGlite.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createLearningDb, resetLearningDb, seedAccount } from './helpers/learning-db.js';

const state = vi.hoisted(() => ({ pg: null }));
vi.mock('../api/_lib/db.js', async () => {
	const { sqlOver: make } = await import('./helpers/learning-db.js');
	return { sql: make(() => state.pg), isDbUnavailableError: () => false, isDbCapacityError: () => false };
});
vi.mock('../api/_lib/notify.js', () => ({ insertNotification: vi.fn() }));

const um = await import('../api/_lib/agent-learning/user-model.js');
const { updateMemorySettings } = await import('../api/_lib/agent-learning/settings.js');

let a;
let b;
beforeEach(async () => {
	state.pg ||= await createLearningDb();
	await resetLearningDb(state.pg);
	a = await seedAccount(state.pg, 'alice');
	b = await seedAccount(state.pg, 'bob');
});

describe('user model entries', () => {
	it('groups lines by section in display order', async () => {
		await um.addUserModelEntry(a.userId, { section: 'goals', content: 'Launch in March' });
		await um.addUserModelEntry(a.userId, { section: 'identity', content: 'Product designer' });
		const doc = await um.getUserModel(a.userId);
		expect(doc.sections.map((s) => s.id)).toEqual(um.SECTION_IDS);
		expect(doc.sections.find((s) => s.id === 'identity').entries[0].content).toBe('Product designer');
		expect(doc.count).toBe(2);
	});

	it('reinforces a duplicate line instead of adding another', async () => {
		const first = await um.addUserModelEntry(a.userId, { section: 'preferences', content: 'Likes terse answers.' });
		const again = await um.addUserModelEntry(a.userId, { section: 'preferences', content: 'likes   TERSE answers' });
		expect(first.reinforced).toBe(false);
		expect(again.reinforced).toBe(true);
		expect((await um.getUserModel(a.userId)).count).toBe(1);
	});

	it('rejects an unknown section, empty text and oversize text', async () => {
		await expect(um.addUserModelEntry(a.userId, { section: 'secrets', content: 'x' })).rejects.toMatchObject({ status: 400 });
		await expect(um.addUserModelEntry(a.userId, { section: 'goals', content: '   ' })).rejects.toMatchObject({ status: 400 });
		await expect(um.addUserModelEntry(a.userId, { section: 'goals', content: 'x'.repeat(um.MAX_ENTRY_CHARS + 1) })).rejects.toMatchObject({ status: 400 });
	});

	it('lets the owner edit, move and delete a line, marking it owner-sourced', async () => {
		const { entry } = await um.addUserModelEntry(a.userId, { section: 'goals', content: 'Ship v1' });
		const edited = await um.updateUserModelEntry(a.userId, entry.id, { section: 'context', content: 'Ship v1 by June' });
		expect(edited).toMatchObject({ section: 'context', content: 'Ship v1 by June', source: 'owner' });
		await um.deleteUserModelEntry(a.userId, entry.id);
		expect((await um.getUserModel(a.userId)).count).toBe(0);
		await expect(um.deleteUserModelEntry(a.userId, entry.id)).rejects.toMatchObject({ status: 404 });
	});

	it('refuses an edit that collides with an existing line', async () => {
		await um.addUserModelEntry(a.userId, { section: 'goals', content: 'Alpha' });
		const { entry } = await um.addUserModelEntry(a.userId, { section: 'goals', content: 'Beta' });
		await expect(um.updateUserModelEntry(a.userId, entry.id, { content: 'alpha' })).rejects.toMatchObject({ status: 409, code: 'duplicate' });
	});

	it("cannot read, edit, delete or clear another account's lines", async () => {
		const { entry } = await um.addUserModelEntry(a.userId, { section: 'goals', content: 'Private goal' });
		await expect(um.updateUserModelEntry(b.userId, entry.id, { content: 'hijack' })).rejects.toMatchObject({ status: 404 });
		await expect(um.deleteUserModelEntry(b.userId, entry.id)).rejects.toMatchObject({ status: 404 });
		expect(await um.clearUserModel(b.userId)).toBe(0);
		expect((await um.getUserModel(b.userId)).count).toBe(0);
		expect((await um.getUserModel(a.userId)).count).toBe(1);
	});

	it('clearUserModel removes every line and reports how many', async () => {
		await um.addUserModelEntry(a.userId, { section: 'goals', content: 'one' });
		await um.addUserModelEntry(a.userId, { section: 'goals', content: 'two' });
		expect(await um.clearUserModel(a.userId)).toBe(2);
	});

	it('still lets the owner delete lines while memory is switched off', async () => {
		const { entry } = await um.addUserModelEntry(a.userId, { section: 'goals', content: 'to be removed' });
		await updateMemorySettings(a.userId, { enabled: false });
		await um.deleteUserModelEntry(a.userId, entry.id);
		expect((await um.getUserModel(a.userId)).count).toBe(0);
	});
});

describe('userModelForPrompt', () => {
	it('stays inside its character budget and regroups by section', async () => {
		await um.addUserModelEntry(a.userId, { section: 'goals', content: 'g'.repeat(100) });
		await um.addUserModelEntry(a.userId, { section: 'identity', content: 'Designer' });
		const out = await um.userModelForPrompt(a.userId, { maxChars: 2400 });
		expect(out.lines[0]).toBe('Who they are:');
		const tight = await um.userModelForPrompt(a.userId, { maxChars: 20 });
		expect(tight.lines.join('\n')).not.toContain('ggg');
	});

	it('is empty for an account with no lines', async () => {
		expect(await um.userModelForPrompt(b.userId)).toEqual({ lines: [], ids: [] });
	});
});
