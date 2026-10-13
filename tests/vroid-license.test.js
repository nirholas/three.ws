import { describe, it, expect } from 'vitest';

import { normalizeLicense, evaluateLicense, creditLineFor } from '../api/_lib/vroid/license.js';

describe('vroid license normalization', () => {
	it('defaults every field closed when no license is present', () => {
		const license = normalizeLicense(null);
		expect(license.characterization_allowed_user).toBe('default');
		expect(license.modification).toBe('default');
		expect(license.redistribution).toBe('default');
		expect(license.credit).toBe('default');
	});

	it('drops unrecognized enum values back to default rather than passing them through', () => {
		const license = normalizeLicense({ modification: 'sure-why-not', credit: 'necessary' });
		expect(license.modification).toBe('default');
		expect(license.credit).toBe('necessary');
	});
});

describe('vroid license to three.ws actions', () => {
	it('grants nothing for a fully closed (all-default) license, and requires credit', () => {
		const result = evaluateLicense(null);
		expect(result.actions).toEqual({
			public_agent: false,
			export: false,
			modify: false,
			monetize_personal: false,
			monetize_corporate: false,
		});
		expect(result.creditRequired).toBe(true);
		expect(result.summary).toHaveLength(5);
	});

	it('opens exactly the actions a fully-permissive license allows', () => {
		const result = evaluateLicense({
			characterization_allowed_user: 'everyone',
			redistribution: 'allow',
			modification: 'allow',
			personal_commercial_use: 'profit',
			corporate_commercial_use: 'allow',
			credit: 'unnecessary',
		});
		expect(result.actions).toEqual({
			public_agent: true,
			export: true,
			modify: true,
			monetize_personal: true,
			monetize_corporate: true,
		});
		expect(result.creditRequired).toBe(false);
	});

	it('restricting characterization to the author only blocks public_agent, independent of other grants', () => {
		const result = evaluateLicense({
			characterization_allowed_user: 'author',
			redistribution: 'allow',
			modification: 'allow',
		});
		expect(result.actions.public_agent).toBe(false);
		expect(result.actions.export).toBe(true);
		expect(result.actions.modify).toBe(true);
	});

	it('personal_commercial_use=nonprofit does not open monetize_personal', () => {
		const result = evaluateLicense({ personal_commercial_use: 'nonprofit' });
		expect(result.actions.monetize_personal).toBe(false);
	});

	it('a license that explicitly marks credit unnecessary does not require it, but ambiguity does', () => {
		expect(evaluateLicense({ credit: 'unnecessary' }).creditRequired).toBe(false);
		expect(evaluateLicense({ credit: 'necessary' }).creditRequired).toBe(true);
		expect(evaluateLicense({}).creditRequired).toBe(true);
	});
});

describe('credit line copy', () => {
	it('names the creator and character when known', () => {
		expect(creditLineFor({ creatorName: 'Alex', characterName: 'Mika' })).toBe(
			'"Mika" by Alex, imported from VRoid Hub.',
		);
	});

	it('falls back to generic copy when creator/character are unknown', () => {
		expect(creditLineFor({})).toBe('This avatar by its VRoid Hub creator, imported from VRoid Hub.');
	});
});
