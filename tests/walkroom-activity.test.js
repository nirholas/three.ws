// Room-wide activity announcements (wheel wins, boutique unlocks) feeding the
// /play activity ticker. WalkRoom._announce broadcasts only a kind, the session
// id and a server-cleaned label: no player-authored text rides the message.

import { describe, it, expect } from 'vitest';
import { WalkRoom } from '../multiplayer/src/rooms/WalkRoom.js';

function makeRoom() {
	const room = Object.create(WalkRoom.prototype);
	room.broadcasts = [];
	room.broadcast = (type, msg) => room.broadcasts.push({ type, msg });
	return room;
}

describe('WalkRoom._announce', () => {
	it('broadcasts kind, session id and the label to the whole room', () => {
		const room = makeRoom();
		room._announce({ sessionId: 's1' }, 'wheel', 'JACKPOT: 100 Cash');
		expect(room.broadcasts).toEqual([{ type: 'activity', msg: { kind: 'wheel', id: 's1', label: 'JACKPOT: 100 Cash' } }]);
	});
	it('says nothing for an empty label and clamps a long one', () => {
		const room = makeRoom();
		room._announce({ sessionId: 's1' }, 'cosmetic', '   ');
		expect(room.broadcasts).toHaveLength(0);
		room._announce({ sessionId: 's1' }, 'cosmetic', 'x'.repeat(200));
		expect(room.broadcasts[0].msg.label.length).toBeLessThanOrEqual(48);
	});
});
