// Quest-giver NPCs (W08 hooking W05) — physical bodies for the jobs board the
// quest engine already runs. multiplayer/src/quests.js's mission registry
// names a `giver` per mission ("in-world quest-giver label (W08 NPCs hook
// this; today it's flavour)") — this file is that hook: one Npc per named
// giver, standing near the world the way its mission actually plays out
// (the dockmaster by the docks, the warden by the lookout, the cook near the
// kitchen run, the fixer at the vault). Pressing E opens the same real Jobs
// Board every giver shares (src/game/quests-ui.js), server-authoritative end
// to end — these NPCs grant nothing themselves, they just open the door.
//
// Positions sit a few metres clear of the quest zones themselves
// (multiplayer/src/quest-zones.js) so a giver never blocks their own
// objective marker, and clear of every other NPC cluster (Agent Exchange
// roster, economy stalls, boutique, ATM) so nothing stands on anything else.

const AVATAR_DOCKMASTER = '/avatars/realistic-male.glb';
const AVATAR_WARDEN = '/avatars/realistic-female.glb';
const AVATAR_COOK = '/avatars/selfie-girl.glb';
const AVATAR_FOREMAN = '/avatars/default.glb';
const AVATAR_FIXER = '/avatars/xbot.glb';

// Bind an NPC to the shared Jobs Board, optionally scrolling straight to the
// mission this giver actually offers so walking up to a specific character
// means something instead of opening an undifferentiated list.
function giveJobs({ greeting, emote, highlight }) {
	return ({ npc, world }) => {
		if (greeting) npc.say(greeting);
		if (emote) npc.emote(emote);
		if (typeof world?.openQuests === 'function') world.openQuests(highlight);
	};
}

export function questNpcsFor() {
	const list = [];

	// Dockmaster Reyes — the daily fishing contract (Angler's Daily Haul).
	list.push({
		id: 'npc-quest-dockmaster',
		name: 'Dockmaster Reyes',
		role: 'quest',
		avatar: AVATAR_DOCKMASTER,
		pos: { x: 24, z: 4 },
		yaw: Math.atan2(30 - 24, 8 - 4),
		range: 5,
		prompt: 'Take the daily haul',
		onInteract: giveJobs({
			greeting: 'Five fish before sundown and I\'ll square you up — the ponds are running today.',
			emote: 'av-call-me',
			highlight: 'daily-anglers-haul',
		}),
	});

	// Warden Okoro — the grounds survey (a pure movement daily; teaches the map).
	list.push({
		id: 'npc-quest-warden',
		name: 'Warden Okoro',
		role: 'quest',
		avatar: AVATAR_WARDEN,
		pos: { x: 6, z: 36 },
		yaw: Math.atan2(0 - 6, 44 - 36),
		range: 5,
		prompt: 'Patrol the grounds',
		onInteract: giveJobs({
			greeting: 'Walk the three lookouts and report the grounds secure. Simple enough for a first day.',
			emote: 'av-arm-flex',
			highlight: 'daily-grounds-survey',
		}),
	});

	// Cook Mara — the bigger repeatable fishing contract for the kitchen.
	list.push({
		id: 'npc-quest-cook',
		name: 'Cook Mara',
		role: 'quest',
		avatar: AVATAR_COOK,
		pos: { x: -24, z: -16 },
		yaw: Math.atan2(-16 - (-24), -22 - (-16)),
		range: 5,
		prompt: 'Stock the kitchen',
		onInteract: giveJobs({
			greeting: 'The roast pit\'s starving — bring me a dozen fresh fish and I\'ll make it worth the walk.',
			emote: 'av-call-me',
			highlight: 'stock-the-kitchen',
		}),
	});

	// Foreman Dell — the harbor courier run, and the one-shot welcome job.
	list.push({
		id: 'npc-quest-foreman',
		name: 'Foreman Dell',
		role: 'quest',
		avatar: AVATAR_FOREMAN,
		pos: { x: 26, z: -6 },
		yaw: Math.atan2(34 - 26, 0 - (-6)),
		range: 5,
		prompt: 'Run a courier job',
		onInteract: giveJobs({
			greeting: 'Crate\'s waiting at the East Dock. Get it to the Market in one piece and you\'re paid.',
			emote: 'av-arm-flex',
			highlight: 'harbor-courier',
		}),
	});

	// The Fixer — the co-op vault heist. Fronts the vault district rather than
	// standing inside the trigger radius of either terminal or the door itself.
	list.push({
		id: 'npc-quest-fixer',
		name: 'The Fixer',
		role: 'quest',
		avatar: AVATAR_FIXER,
		pos: { x: 44, z: 0 },
		yaw: Math.PI / 2,
		range: 5,
		prompt: 'Plan the vault job',
		onInteract: giveJobs({
			greeting: 'Two people, two alarms, one door. Bring a partner and we split it even.',
			emote: 'av-call-me',
			highlight: 'vault-job',
		}),
	});

	return list;
}
