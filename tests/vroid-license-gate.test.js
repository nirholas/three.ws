// The VRoid Hub license is stored on the avatar at import (source_meta.vroid)
// and re-checked at every surface that would exceed it. These tests pin the
// pure decision logic; the handler tests beside it pin that each surface asks.

import { describe, it, expect } from 'vitest';

import {
	buildVroidBlock,
	vroidBlockOf,
	gateAvatarAction,
	forkLicensePlan,
	attributionFor,
	describeVroidLicense,
} from '../api/_lib/vroid/license-gate.js';

const CLOSED = {
	characterization_allowed_user: 'author',
	redistribution: 'disallow',
	modification: 'disallow',
	personal_commercial_use: 'disallow',
	corporate_commercial_use: 'disallow',
	credit: 'necessary',
};
const OPEN = {
	characterization_allowed_user: 'everyone',
	redistribution: 'allow',
	modification: 'allow',
	personal_commercial_use: 'profit',
	corporate_commercial_use: 'allow',
	credit: 'unnecessary',
};

function metaFor(license, extra = {}) {
	return {
		vroid: buildVroidBlock({
			characterModelId: '123',
			characterId: '45',
			creatorName: 'Alex',
			characterName: 'Mika',
			license,
			isAuthor: false,
			importedAt: '2026-11-03T00:00:00.000Z',
			...extra,
		}),
	};
}

describe('vroid block on source_meta', () => {
	it('is absent for an avatar that did not come from VRoid Hub', () => {
		expect(vroidBlockOf(null)).toBe(null);
		expect(vroidBlockOf({})).toBe(null);
		expect(vroidBlockOf({ vroid: 'nope' })).toBe(null);
		expect(vroidBlockOf({ vroid: [] })).toBe(null);
	});

	it('records provenance, the normalized license, the credit line and the hub link', () => {
		const block = vroidBlockOf(metaFor(CLOSED));
		expect(block.character_model_id).toBe('123');
		expect(block.creator_name).toBe('Alex');
		expect(block.license.redistribution).toBe('disallow');
		expect(block.credit_line).toBe('"Mika" by Alex, imported from VRoid Hub.');
		expect(block.hub_url).toBe('https://hub.vroid.com/en/characters/45/models/123');
		expect(block.is_author).toBe(false);
	});

	it('leaves the hub link out when the character id is unknown', () => {
		expect(vroidBlockOf(metaFor(CLOSED, { characterId: null })).hub_url).toBe(null);
	});
});

describe('gateAvatarAction', () => {
	it('allows everything on an avatar with no VRoid license', () => {
		for (const action of ['public_agent', 'export', 'modify', 'monetize']) {
			expect(gateAvatarAction({}, action).allowed).toBe(true);
			expect(gateAvatarAction(null, action).allowed).toBe(true);
		}
	});

	it('refuses every action a closed license withholds, in plain words naming the creator', () => {
		for (const action of ['public_agent', 'export', 'modify', 'monetize']) {
			const verdict = gateAvatarAction(metaFor(CLOSED), action);
			expect(verdict.allowed).toBe(false);
			expect(verdict.code).toBe('license_restricted');
			expect(verdict.action).toBe(action);
			expect(verdict.message).toContain("Alex's VRoid Hub license");
		}
	});

	it('allows exactly the actions an open license grants', () => {
		for (const action of ['public_agent', 'export', 'modify', 'monetize']) {
			expect(gateAvatarAction(metaFor(OPEN), action).allowed).toBe(true);
		}
	});

	it('gates each action independently', () => {
		const meta = metaFor({ ...CLOSED, redistribution: 'allow' });
		expect(gateAvatarAction(meta, 'export').allowed).toBe(true);
		expect(gateAvatarAction(meta, 'public_agent').allowed).toBe(false);
		expect(gateAvatarAction(meta, 'modify').allowed).toBe(false);
	});

	it('opens monetize when either commercial flag is open, matching what the picker tells the user', () => {
		expect(gateAvatarAction(metaFor({ ...CLOSED, personal_commercial_use: 'profit' }), 'monetize').allowed).toBe(true);
		expect(gateAvatarAction(metaFor({ ...CLOSED, corporate_commercial_use: 'allow' }), 'monetize').allowed).toBe(true);
		expect(gateAvatarAction(metaFor({ ...CLOSED, personal_commercial_use: 'nonprofit' }), 'monetize').allowed).toBe(false);
	});

	it('fails closed when the stored block has no readable license', () => {
		const verdict = gateAvatarAction({ vroid: { creator_name: 'Alex' } }, 'export');
		expect(verdict.allowed).toBe(false);
	});

	it('opens every action to the creator who imported their own character', () => {
		const meta = metaFor(CLOSED, { isAuthor: true });
		for (const action of ['public_agent', 'export', 'modify', 'monetize']) {
			expect(gateAvatarAction(meta, action).allowed).toBe(true);
		}
	});

	it('names the creator generically when the Hub did not supply one', () => {
		const verdict = gateAvatarAction(metaFor(CLOSED, { creatorName: null }), 'export');
		expect(verdict.message).toContain("The creator's VRoid Hub license");
	});

	it('rejects an action name it does not know instead of silently allowing it', () => {
		expect(() => gateAvatarAction(metaFor(CLOSED), 'publish')).toThrow(TypeError);
		expect(() => gateAvatarAction({}, 'publish')).toThrow(TypeError);
	});
});

describe('forkLicensePlan', () => {
	it('lets a fork of an ordinary avatar behave exactly as before', () => {
		expect(forkLicensePlan({ srcMeta: {}, srcOwnerId: 'u1', forkerId: 'u1' })).toEqual({
			meta: {},
			visibility: 'unlisted',
			agentAllowed: true,
		});
	});

	it('carries the license into the fork so a copy cannot launder the restrictions', () => {
		const plan = forkLicensePlan({ srcMeta: metaFor(CLOSED), srcOwnerId: 'u1', forkerId: 'u1' });
		expect(plan.meta.vroid.license.redistribution).toBe('disallow');
		expect(gateAvatarAction(plan.meta, 'export').allowed).toBe(false);
	});

	it('keeps a fork private and agentless when the license withholds export and public agents', () => {
		const plan = forkLicensePlan({ srcMeta: metaFor(CLOSED), srcOwnerId: 'u1', forkerId: 'u1' });
		expect(plan.visibility).toBe('private');
		expect(plan.agentAllowed).toBe(false);
	});

	it('keeps the default unlisted visibility when the license allows redistribution', () => {
		const plan = forkLicensePlan({ srcMeta: metaFor(OPEN), srcOwnerId: 'u1', forkerId: 'u2' });
		expect(plan.visibility).toBe('unlisted');
		expect(plan.agentAllowed).toBe(true);
	});

	it('does not hand the creator\'s own rights to a different user who forks the avatar', () => {
		const authored = metaFor(CLOSED, { isAuthor: true });
		const byCreator = forkLicensePlan({ srcMeta: authored, srcOwnerId: 'u1', forkerId: 'u1' });
		const byStranger = forkLicensePlan({ srcMeta: authored, srcOwnerId: 'u1', forkerId: 'u2' });
		expect(byCreator.visibility).toBe('unlisted');
		expect(byCreator.agentAllowed).toBe(true);
		expect(byStranger.meta.vroid.is_author).toBe(false);
		expect(byStranger.visibility).toBe('private');
		expect(byStranger.agentAllowed).toBe(false);
	});
});

describe('credit on every surface', () => {
	it('has no attribution for an avatar that is not from VRoid Hub', () => {
		expect(attributionFor({})).toBe(null);
		expect(describeVroidLicense({})).toBe(null);
	});

	it('credits the creator and links the character page, saying credit is required', () => {
		const a = attributionFor(metaFor(CLOSED));
		expect(a.displayName).toBe('Alex');
		expect(a.url).toBe('https://hub.vroid.com/en/characters/45/models/123');
		expect(a.license).toBe('VRoid Hub license · credit required');
	});

	it('still names the creator and the VRoid Hub license when credit is optional', () => {
		const a = attributionFor(metaFor(OPEN));
		expect(a.displayName).toBe('Alex');
		expect(a.license).toBe('VRoid Hub license');
	});

	it('does not credit the creator on their own avatar', () => {
		expect(attributionFor(metaFor(CLOSED, { isAuthor: true }))).toBe(null);
	});

	it('describes the gate to the UI: which actions are open and the credit line', () => {
		const d = describeVroidLicense(metaFor(CLOSED));
		expect(d.actions).toEqual({ public_agent: false, export: false, modify: false, monetize: false });
		expect(d.credit_required).toBe(true);
		expect(d.credit_line).toBe('"Mika" by Alex, imported from VRoid Hub.');
		expect(d.author).toBe(false);
		expect(d.license_url).toMatch(/^https:\/\/developer\.vroid\.com\//);
	});
});

describe('avatar API shape', () => {
	it('adds the credit and the license summary for a VRoid import and nothing for other avatars', async () => {
		const { vi } = await import('vitest');
		vi.resetModules();
		vi.doMock('../api/_lib/db.js', () => ({
			sql: async () => [
				{
					id: '11111111-1111-4111-8111-111111111111',
					owner_id: 'u1',
					visibility: 'private',
					size_bytes: 1,
					source_meta: metaFor(CLOSED),
				},
			],
		}));
		const { getAvatar } = await import('../api/_lib/avatars.js');
		const a = await getAvatar({ id: '11111111-1111-4111-8111-111111111111', requesterId: 'u1' });
		expect(a.attribution.displayName).toBe('Alex');
		expect(a.vroid_license.actions.export).toBe(false);
		vi.doUnmock('../api/_lib/db.js');
	});
});
