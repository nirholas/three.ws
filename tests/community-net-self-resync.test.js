// After a (re)join the server's copy of our own player is the anchor every later
// move is measured against: WalkRoom refuses any step longer than 1.2 m. If the
// local avatar kept walking while the socket was down it is now further than that
// from the server's spot, every move is refused, and peers see us frozen. The
// client must adopt the server's position in that case, and only in that case
// (a normal join spawns within the clamp and must not rubber-band).
import { describe, it, expect } from 'vitest';
import { selfResyncTarget, SERVER_MAX_STEP_M } from '../src/game/community-net.js';

describe('selfResyncTarget', () => {
	it('mirrors the server clamp', () => {
		expect(SERVER_MAX_STEP_M).toBe(1.2);
	});

	it('leaves a local avatar inside the clamp alone', () => {
		expect(selfResyncTarget({ x: 0.6, z: -0.4 }, { x: 0, y: 0, z: 0 })).toBeNull();
		expect(selfResyncTarget({ x: 4.2, z: 3 }, { x: 4, y: 0, z: 3 })).toBeNull();
	});

	it('snaps to the server when the local avatar drifted past the clamp', () => {
		expect(selfResyncTarget({ x: 9, z: 3 }, { x: 4, y: 0.5, z: 3 })).toEqual({ x: 4, y: 0.5, z: 3 });
		// Spawned at the origin by an older server that does not resume position.
		expect(selfResyncTarget({ x: 4, z: 3 }, { x: 0, y: 0, z: 0 })).toEqual({ x: 0, y: 0, z: 0 });
	});

	it('ignores a malformed server position', () => {
		expect(selfResyncTarget({ x: 9, z: 3 }, { x: NaN, y: 0, z: 0 })).toBeNull();
		expect(selfResyncTarget({ x: 9, z: 3 }, null)).toBeNull();
	});
});
