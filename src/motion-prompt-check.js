/**
 * The one check every "describe a motion" surface runs before it spends a GPU
 * job: /api/forge-motion (server), the MCP text_to_animation tool, and the
 * /pose generator box (src/animation-library.js). Shared so the browser refuses
 * exactly what the server would, in the same words, without a round trip.
 *
 * It refuses only what can never be a motion (nothing typed, no words, one key
 * held down). Anything made of words goes to the model, which always returns a
 * human motion; when the words name a creature or machine the note says so,
 * because the model animates a human body and nothing else.
 */

export const MOTION_PROMPT_MIN = 3;
export const MOTION_PROMPT_MAX = 1000;

const EXAMPLE = 'for example "waving hello" or "a slow tai-chi sweep"';

// Subjects the model cannot animate as themselves. It only knows a human body,
// so "a dog wagging its tail" comes back as a person's take on it.
const NON_HUMAN =
	/\b(dogs?|puppy|puppies|cats?|kittens?|horses?|birds?|fish|snakes?|spiders?|insects?|bugs?|cows?|pigs?|sheep|lions?|tigers?|bears?|wolf|wolves|monkeys?|apes?|elephants?|giraffes?|dragons?|dinosaurs?|sharks?|whales?|dolphins?|octopus|crabs?|frogs?|rabbits?|bunny|bunnies|mice|mouse|rats?|chickens?|ducks?|eagles?|cars?|trucks?|planes?|airplanes?|helicopters?|robots? arm|trees?|flowers?)\b/i;

/**
 * @param {unknown} raw  What the person typed.
 * @returns {{ ok: true, prompt: string, note: string|null } | { ok: false, reason: string, message: string }}
 */
export function checkMotionPrompt(raw) {
	const prompt = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
	if (!prompt) {
		return { ok: false, reason: 'empty', message: `Describe the motion in a few words first, ${EXAMPLE}.` };
	}
	if (prompt.length > MOTION_PROMPT_MAX) {
		return {
			ok: false,
			reason: 'too_long',
			message: `Keep the description under ${MOTION_PROMPT_MAX} characters. One clear movement works best.`,
		};
	}
	const letters = prompt.match(/\p{L}/gu) || [];
	const distinct = new Set(letters.map((c) => c.toLowerCase()));
	if (prompt.length < MOTION_PROMPT_MIN || letters.length < 2 || distinct.size < 2) {
		return {
			ok: false,
			reason: 'not_a_motion',
			message: `That does not read as a movement yet. Describe what the body does in words, ${EXAMPLE}.`,
		};
	}
	const subject = prompt.match(NON_HUMAN)?.[0];
	const note = subject
		? `The motion model animates a human body, so "${subject}" plays as a person acting it out.`
		: null;
	return { ok: true, prompt, note };
}
