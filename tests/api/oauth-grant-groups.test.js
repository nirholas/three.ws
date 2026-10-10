// api/_lib/oauth-grant-groups.js: the read / manage / trade / spend / launch
// grouping the MCP consent screen renders. The groups are derived from the
// registerable scope list and the MCP policy table, so these tests pin the
// contract the screen and the authorize POST rely on rather than the copy.

import { describe, it, expect } from 'vitest';
import {
	GRANT_GROUPS, SCOPE_LABELS, CONNECTION_SCOPES, groupsForScope, grantedScopeFromGroups,
	confirmationsFor, groupOfScope, unmappedRegisterableScopes,
} from '../../api/_lib/oauth-grant-groups.js';
import { REGISTERABLE_SCOPES } from '../../api/_lib/oauth-scopes.js';

describe('grant group table', () => {
	it('covers every registerable scope exactly once, connection scopes aside', () => {
		expect(unmappedRegisterableScopes()).toEqual([]);
		const seen = new Map();
		for (const g of GRANT_GROUPS) for (const s of g.scopes) seen.set(s, (seen.get(s) || 0) + 1);
		for (const s of REGISTERABLE_SCOPES) {
			if (CONNECTION_SCOPES.includes(s)) continue;
			expect(seen.get(s), s).toBe(1);
		}
	});

	it('labels every registerable scope in plain words', () => {
		for (const s of REGISTERABLE_SCOPES) expect(typeof SCOPE_LABELS[s], s).toBe('string');
	});

	it('has read as the one required group and the four tool groups the brief names', () => {
		expect(GRANT_GROUPS.filter((g) => g.required).map((g) => g.id)).toEqual(['read']);
		expect(GRANT_GROUPS.map((g) => g.id)).toEqual(['read', 'manage', 'trade', 'spend', 'launch']);
		expect(groupOfScope('wallet:trade')).toBe('trade');
		expect(groupOfScope('wallet:launch')).toBe('launch');
		expect(groupOfScope('wallet:write')).toBe('spend');
	});

	it('derives the still-asks-first list from the policy table', () => {
		expect(confirmationsFor('launch')).toContain('launching a coin');
		expect(confirmationsFor('spend')).toContain('withdrawals');
		expect(confirmationsFor('trade')).toContain('swaps');
		expect(confirmationsFor('read')).toEqual([]);
	});
});

describe('groupsForScope', () => {
	it('shows only the groups the request touches, read first', () => {
		const groups = groupsForScope('profile wallet:launch');
		expect(groups.map((g) => g.id)).toEqual(['read', 'launch']);
		expect(groups[0].scopes).toEqual(['profile']);
		expect(groups[1].implied).toBe(false);
	});

	it('shows trade and launch as implied when spend is requested', () => {
		const groups = groupsForScope('avatars:read wallet:write');
		expect(groups.map((g) => g.id)).toEqual(['read', 'trade', 'spend', 'launch']);
		expect(groups.find((g) => g.id === 'trade').implied).toBe(true);
		expect(groups.find((g) => g.id === 'launch').implied).toBe(true);
	});
});

describe('grantedScopeFromGroups', () => {
	const requested = 'avatars:read profile offline_access memory:write wallet:write';

	it('keeps read and connection scopes whatever was ticked', () => {
		expect(grantedScopeFromGroups(requested, []).split(' ').sort()).toEqual(['avatars:read', 'offline_access', 'profile']);
	});

	it('keeps exactly the ticked groups', () => {
		expect(grantedScopeFromGroups(requested, ['manage', 'spend']).split(' ').sort()).toEqual(['avatars:read', 'memory:write', 'offline_access', 'profile', 'wallet:write']);
	});

	it('narrows spend to trade or launch when only the implied group stays ticked', () => {
		expect(grantedScopeFromGroups(requested, ['trade']).split(' ').sort()).toEqual(['avatars:read', 'offline_access', 'profile', 'wallet:trade']);
		expect(grantedScopeFromGroups(requested, ['launch', 'trade']).split(' ').sort()).toEqual(['avatars:read', 'offline_access', 'profile', 'wallet:launch', 'wallet:trade']);
	});

	it('never adds a scope the client did not ask for', () => {
		expect(grantedScopeFromGroups('avatars:read', ['spend', 'trade', 'launch', 'manage'])).toBe('avatars:read');
	});
});
