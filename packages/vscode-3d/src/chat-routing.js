// How an @threews chat request becomes one action.
//
// Pure: no vscode import, so the routing every chat turn depends on is tested
// directly. A slash command always wins. A request without one is routed by
// what it asks for ("make a low-poly lantern for my scene" is a forge, "is there
// a chair" is a find), and anything else gets the help card instead of a guess
// that spends generation quota.

export const PARTICIPANT_ID = 'threews3d.chat';

/** The slash commands, in the order the chat picker shows them. */
export const COMMANDS = Object.freeze([
	{ name: 'forge', description: 'Generate a textured 3D model from a description, free' },
	{ name: 'find', description: 'Search thousands of ready-made CC0 models, characters and motions' },
	{ name: 'rig', description: 'Add a humanoid skeleton to a GLB so it can be animated' },
	{ name: 'embed', description: 'Insert an <agent-3d> embed for a model into the open file' },
]);

const NAMES = new Set(COMMANDS.map((c) => c.name));

// Order matters: "find a rigged character" is a search, "rig the robot" is a rig.
const INTENTS = [
	{ command: 'embed', test: /\b(embed|snippet|web component)\b|<agent-3d|\bput (it|this|the model) on (my|the) (site|page)\b/i },
	{ command: 'find', test: /\b(find|search|look(ing)? for|is there|are there|browse|ready-?made|catalog)\b/i },
	{ command: 'rig', test: /\b(rig|skeleton|skin weights|make (it|this) (posable|animatable))\b/i },
	{ command: 'forge', test: /\b(make|generate|create|forge|model|build|design|sculpt|3d|glb|mesh)\b/i },
];

/**
 * @param {{ command?: string, prompt?: string }} request
 * @returns {{ command: 'forge'|'find'|'rig'|'embed'|'help', subject: string, inferred: boolean }}
 */
export function routeRequest({ command, prompt } = {}) {
	const text = String(prompt || '').trim();
	if (command && NAMES.has(command)) return { command, subject: subjectFor(command, text), inferred: false };
	if (!text) return { command: 'help', subject: '', inferred: true };
	const hit = INTENTS.find((intent) => intent.test.test(text));
	if (!hit) return { command: 'help', subject: text, inferred: true };
	return { command: hit.command, subject: subjectFor(hit.command, text), inferred: true };
}

function subjectFor(command, text) {
	if (command === 'forge') return forgeSubject(text);
	if (command === 'find') return findSubject(text);
	return text;
}

/**
 * The single subject a text to 3D lane should model, with the request's
 * framing removed: "make me a low-poly lantern for my scene" -> "a low-poly lantern".
 */
export function forgeSubject(text) {
	let s = String(text || '').trim();
	s = s.replace(/^(please\s+)?(can you\s+|could you\s+)?(make|generate|create|forge|build|design|sculpt|give me|i need|i want)(\s+me)?\s+/i, '');
	s = s.replace(/^(a\s+)?(3d|three-?d)\s+(model|asset|mesh|object|glb)\s+(of|for|showing)\s+/i, '');
	s = s.replace(/^(a\s+)?(model|asset|mesh|glb)\s+(of|for)\s+/i, '');
	s = s.replace(/\s+(for|in|to use in|to put in)\s+(my|our|the|this)\s+(scene|project|game|site|website|page|app|level|world|repo)\b.*$/i, '');
	s = s.replace(/[.!?\s]+$/, '');
	return s.trim() || String(text || '').trim();
}

/** The search words in a find request: "is there a wooden chair?" -> "wooden chair". */
export function findSubject(text) {
	let s = String(text || '').trim();
	s = s.replace(/^(please\s+)?(can you\s+)?(find|search( for)?|look( for)?|looking for|browse( for)?|is there|are there|do you have|show me)\s+/i, '');
	s = s.replace(/^(any|some|an?|the)\s+/i, '');
	s = s.replace(/\s+(in the (catalog|library)|that i can use|i can use|ready-?made|for my (scene|project|game|site))\b.*$/i, '');
	s = s.replace(/^(ready-?made|existing|free|cc0)\s+/i, '');
	s = s.replace(/\s+(models?|assets?|props?)$/i, '');
	s = s.replace(/[.!?\s]+$/, '');
	return s.trim();
}

/** The catalog kind a find request names, if any. */
export function kindFromText(text) {
	const t = String(text || '');
	if (/\b(animation|animations|motion|motions|clip|clips|dance|walk cycle|idle)\b/i.test(t)) return 'animation';
	if (/\b(character|characters|humanoid|avatar|avatars|person|people|rigged)\b/i.test(t)) return 'character';
	return undefined;
}

/** The first http(s) URL in a request, trailing punctuation trimmed. */
export function urlIn(text) {
	const match = /https?:\/\/[^\s<>"'`)]+/i.exec(String(text || ''));
	return match ? match[0].replace(/[.,;:!?]+$/, '') : null;
}

/**
 * Suggested next turns after a result. `metadata` is what the handler returned.
 * @param {{ command?: string, glbUrl?: string, subject?: string, found?: number, firstGlbUrl?: string }} metadata
 */
export function followupsFor(metadata = {}) {
	const { command, glbUrl, subject, found, firstGlbUrl } = metadata;
	const at = (cmd, prompt, label) => ({ prompt, label, command: cmd, participant: PARTICIPANT_ID });
	if ((command === 'forge' || command === 'rig') && glbUrl) {
		const out = [];
		if (command === 'forge') out.push(at('rig', glbUrl, 'Rig it for animation'));
		out.push(at('embed', glbUrl, 'Embed it in the open file'));
		if (command === 'forge' && subject) out.push(at('find', subject, 'Find ready-made alternatives'));
		return out;
	}
	if (command === 'find') {
		if (!found && subject) return [at('forge', subject, `Generate "${subject.slice(0, 40)}" instead`)];
		const out = [];
		if (firstGlbUrl) out.push(at('embed', firstGlbUrl, 'Embed the first result'));
		if (subject) out.push(at('forge', subject, 'Generate a custom one'));
		return out;
	}
	if (command === 'help') {
		return [
			at('forge', 'a low-poly brass lantern', 'Generate a lantern'),
			at('find', 'wooden chair', 'Find a chair'),
		];
	}
	return [];
}

/** The help card shown when a request names no action. */
export function helpMarkdown() {
	return [
		'I can put 3D models into this workspace with three.ws. Free, no key and no account.',
		'',
		...COMMANDS.map((c) => `- \`/${c.name}\` ${c.description}.`),
		'',
		'Try `@threews /forge a friendly round robot mascot, glossy white plastic` or `@threews /find wooden chair`.',
		'In agent mode Copilot can also call the three.ws tools on its own: generate, check a job, find an asset, inspect or optimize a GLB.',
	].join('\n');
}
