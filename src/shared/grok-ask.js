/**
 * "Ask @grok about it": the share panel's second X action.
 *
 * Builds editable X compose text for a model, avatar or anatomy design: a short
 * description of the entity, a blank line, then one question that ends with
 * @grok. Grok answers a mention in the replies, so the post invites a real
 * explanation of the thing being shared. Nothing posts: the text opens in X's
 * composer through xIntentUrl() for the user to edit and send.
 *
 * Questions come from a small template set per kind, chosen by real metadata:
 * the model's category (explicit, else classified from its prompt), and the
 * machine name for anatomy. The pick inside a set is stable per entity id.
 * Templates carry no dashes and no market or token language (Grok-facing copy
 * is token-free, see docs/share-to-x.md), and user text has cashtags stripped.
 */

import { classifyModelCategory } from '../../api/_lib/forge-classify.js';
import { fitXText, xTextBudget, xWeightedLength } from './share-targets.js';

const KIND_MAP = { forge: 'model', model: 'model', avatar: 'avatar', anatomy: 'anatomy' };

/** The askable kind for a share panel entity, or null when Ask @grok does not apply. */
export function shareKindOf(entity) {
	return KIND_MAP[entity?.kind] || null;
}

export const GROK_ASK_TEMPLATES = Object.freeze({
	model: Object.freeze({
		vehicle: ['How would a real vehicle like this be engineered to move? @grok', 'What would it take to build this vehicle for real? @grok'],
		creature: ['Which real animals might a creature like this be inspired by? @grok', 'How would a creature like this survive in the wild? @grok'],
		scene: ['What story could take place in a scene like this? @grok', 'What place in the real world does this scene remind you of? @grok'],
		avatar: ['What backstory would fit a character that looks like this? @grok', 'What kind of hero or villain would this character be? @grok'],
		accessory: ['What would this be made of if someone crafted it by hand? @grok', 'Who would wear something like this, and why? @grok'],
		item: ['What would a real version of this be made of? @grok', 'How would you manufacture an object like this? @grok'],
		other: ['What would it take to make this in real life? @grok', 'What is the most interesting detail in this 3D model? @grok'],
	}),
	avatar: Object.freeze({
		any: ['What backstory would fit a character that looks like this? @grok', 'What would this character sound like if they could talk? @grok', 'If this character had a job, what would it be? @grok'],
	}),
	anatomy: Object.freeze({
		any: ['How does a {machine} actually work, step by step? @grok', 'What is the most common way a {machine} fails, and why? @grok', 'How has the {machine} changed over the last 50 years? @grok'],
	}),
});

const CASHTAG_RE = /\$[A-Za-z][A-Za-z0-9_]{0,15}\b/g;

function clean(str) {
	return String(str ?? '').replace(CASHTAG_RE, '').replace(/\s+/g, ' ').trim();
}

// A model's subject is its prompt when the caller supplied one (the title of a
// promptless creation is a generic fallback, not metadata worth asking about).
function subjectOf(entity) {
	if (shareKindOf(entity) === 'model' && entity && 'prompt' in entity) return clean(entity.prompt);
	return clean(entity?.title || entity?.prompt || entity?.name || '');
}

function hashIndex(seed, n) {
	let h = 2166136261;
	for (const ch of String(seed)) h = Math.imul(h ^ ch.codePointAt(0), 16777619) >>> 0;
	return h % n;
}

/**
 * Whether Ask @grok can be offered for this entity right now. Not ready while
 * it is still generating (no id or no metadata yet); `reason` is the tooltip.
 * Kinds outside model, avatar and anatomy are not offered and have no reason.
 */
export function grokAskState(entity) {
	if (!shareKindOf(entity)) return { ready: false, reason: '' };
	if (!entity.id) {
		return { ready: false, reason: 'Still generating or not saved yet. Ask @grok unlocks once it has a title and a permanent link.' };
	}
	if (!subjectOf(entity)) {
		return { ready: false, reason: 'Still generating. Ask @grok unlocks once there is a prompt or title to ask about.' };
	}
	return { ready: true, reason: '' };
}

function templateSet(entity) {
	const kind = shareKindOf(entity);
	if (kind === 'model') {
		const set = GROK_ASK_TEMPLATES.model;
		const explicit = entity.category && set[entity.category] ? entity.category : null;
		return set[explicit || classifyModelCategory(entity.prompt || entity.title || '')] || set.other;
	}
	return GROK_ASK_TEMPLATES[kind]?.any || GROK_ASK_TEMPLATES.model.other;
}

/** The one generated question, ending with @grok. */
export function grokAskQuestion(entity) {
	const set = templateSet(entity);
	const t = set[hashIndex(entity?.id || subjectOf(entity), set.length)];
	return t.replace('{machine}', subjectOf(entity) || 'machine');
}

function describe(entity, subject) {
	switch (shareKindOf(entity)) {
		case 'anatomy':
			return `An interactive 3D cutaway of how a ${subject} works, on three.ws.`;
		case 'avatar':
			return `${subject}, ${entity.noun || 'a 3D avatar'} on three.ws.`;
		default:
			return `"${subject}", a 3D model made on three.ws.`;
	}
}

/**
 * Compose text for the Ask @grok intent: description, blank line, question.
 * Fitted to what X leaves after the url; only the description is shortened,
 * so the question and its closing @grok always survive.
 */
export function grokAskText(entity, { url = '', via = '' } = {}) {
	const question = grokAskQuestion(entity);
	const subject = subjectOf(entity);
	const budget = xTextBudget({ url, via });
	const descBudget = budget - xWeightedLength(question) - 2;
	const full = describe(entity, subject);
	if (xWeightedLength(full) <= descBudget) return `${full}\n\n${question}`;
	const frame = xWeightedLength(describe(entity, ''));
	const shortSubject = fitXText(subject, Math.max(0, descBudget - frame));
	return `${describe(entity, shortSubject)}\n\n${question}`;
}
