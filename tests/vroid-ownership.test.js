import { beforeEach, describe, expect, it, vi } from 'vitest';

const hubGet = vi.fn();
vi.mock('../api/_lib/vroid/client.js', () => ({ hubGet, ACCOUNT_PATH: '/api/account' }));

const { fetchAccountUserId, isCharacterCreator } = await import('../api/_lib/vroid/ownership.js');

beforeEach(() => hubGet.mockReset());

describe('fetchAccountUserId', () => {
	it('reads the Hub user id from user_detail.user.id', async () => {
		hubGet.mockResolvedValue({ user_detail: { user: { id: 77 } } });
		expect(await fetchAccountUserId('tok')).toBe('77');
		expect(hubGet).toHaveBeenCalledWith('/api/account', 'tok');
	});

	it('answers null when the account call fails or has no id, so nothing is treated as authored', async () => {
		hubGet.mockRejectedValue(new Error('boom'));
		expect(await fetchAccountUserId('tok')).toBe(null);
		hubGet.mockResolvedValue({ user_detail: {} });
		expect(await fetchAccountUserId('tok')).toBe(null);
	});
});

describe('isCharacterCreator', () => {
	const model = { character: { user: { id: '77' } } };
	it('is true only when the account id equals the creator id', () => {
		expect(isCharacterCreator('77', model)).toBe(true);
		expect(isCharacterCreator('78', model)).toBe(false);
	});
	it('is false when either id is unknown', () => {
		expect(isCharacterCreator(null, model)).toBe(false);
		expect(isCharacterCreator('77', {})).toBe(false);
		expect(isCharacterCreator('77', { character: { user: { id: '' } } })).toBe(false);
	});
});
