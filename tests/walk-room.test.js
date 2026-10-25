// A coin world's identity (name, symbol, image) must come from the coin's own
// record, never from the first client to join: join options are unsigned.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';

const MINT = 'THREEsynthetic1111111111111111111111111111';

function makeRoom() {
	const room = Object.create(WalkRoom.prototype);
	Object.defineProperty(room, 'roomId', { value: 'room-1' });
	Object.defineProperty(room, 'clients', { value: [] });
	room.coinCreator = '';
	room.state = { coin: MINT, coinName: '', coinSymbol: '', coinImage: '' };
	return room;
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('WalkRoom coin identity', () => {
	it('takes name, symbol and image from the coin record, not the joiner', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({
				ok: true,
				json: async () => ({ name: 'Synthetic Coin', symbol: 'SYN', image_uri: 'https://cdn.example/syn.png' }),
			})),
		);
		const room = makeRoom();
		await room._resolveCoinCreator();
		expect(room.state.coinName).toBe('Synthetic Coin');
		expect(room.state.coinSymbol).toBe('SYN');
		expect(room.state.coinImage).toBe('https://cdn.example/syn.png');
	});

	it('strips control characters and caps length from the record', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => ({ ok: true, json: async () => ({ name: `Bad\u0007Name${'x'.repeat(100)}`, symbol: 'S\nY' }) })),
		);
		const room = makeRoom();
		await room._resolveCoinCreator();
		expect(room.state.coinName).not.toMatch(/[\u0000-\u001f]/);
		expect(room.state.coinName.length).toBeLessThanOrEqual(48);
		expect(room.state.coinSymbol).toBe('S Y');
	});

	it('leaves the identity blank when the record cannot be fetched', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
		const room = makeRoom();
		await room._resolveCoinCreator();
		expect(room.state.coinName).toBe('');
	});
});
