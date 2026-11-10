// Economy NPCs (W04) — the general-store clerks and bank teller that make the
// in-game cash economy walk-up-and-use. They stand at the vendor stalls and
// the ATM spot world-zones.js already reserved for them ("Vendor stalls
// ringing Downtown (economy / shop briefs)" / "The bank/ATM (W04)").
//
// Unlike the Agent Exchange roster (npc-catalog.js), which fronts a real x402
// micro-service per character, these front the room's own off-schema cash
// economy (multiplayer/src/economy.js + shop.js) over the WalkRoom message
// channel — no on-chain settlement for cash, ever. The $THREE boutique (the
// one piece of W04 that DOES settle on-chain) lives in the wardrobe panel
// instead (src/game/play-systems.js), reachable from the rail's own Cosmetics
// button rather than a dedicated NPC — it's a shop for what you're already
// wearing, not a new place to walk to.

import { spawnsOfType } from '../world-zones.js';
import { openStorePanel, openBankPanel } from '../economy-ui.js';

const AVATAR_CLERK = '/avatars/default.glb';
const AVATAR_TELLER = '/avatars/studio.glb';

export function economyNpcsFor() {
	const list = [];

	// General store — one clerk per vendor stall in world-zones.js. Walk up,
	// press E, buy tools/consumables with cash or sell what you've gathered.
	for (const stall of spawnsOfType('vendor')) {
		list.push({
			id: `npc-store-${stall.id}`,
			name: 'General Store',
			role: 'vendor',
			avatar: AVATAR_CLERK,
			pos: { x: stall.x, z: stall.z },
			yaw: stall.yaw,
			range: 5,
			prompt: 'Buy & sell gear',
			onInteract: ({ npc, ui, net }) => {
				npc.say('Tools, ammo, a bite to eat — and I’ll pay cash for what you’ve gathered.');
				npc.emote('av-call-me');
				openStorePanel({ ui, net });
			},
		});
	}

	// Bank/ATM — deposit cash to protect it from a death drop, or withdraw it
	// back to the purse. One teller at the spot world-zones.js reserved.
	for (const atm of spawnsOfType('atm')) {
		list.push({
			id: `npc-bank-${atm.id}`,
			name: 'Bank Teller',
			role: 'bank',
			avatar: AVATAR_TELLER,
			pos: { x: atm.x, z: atm.z },
			yaw: atm.yaw,
			range: 5,
			prompt: 'Bank / withdraw cash',
			onInteract: ({ npc, ui, net }) => {
				npc.say('Bank it and it’s safe — nobody takes banked cash off you, not even a bad fight.');
				npc.emote('av-arm-flex');
				openBankPanel({ ui, net });
			},
		});
	}

	return list;
}
