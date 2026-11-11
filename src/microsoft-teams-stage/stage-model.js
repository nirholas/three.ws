/**
 * Pure logic for the shared 3D review stage (/microsoft/teams-stage): model
 * references, participant colours, comment pins, the markdown export, camera
 * poses and synced animation playback. No DOM, no network, no Three.js, so the
 * whole contract is unit-tested in tests/microsoft-teams-stage.test.js and the
 * same rules hold for every participant in a meeting.
 */

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const MODEL_EXT_RE = /\.(glb|gltf|vrm)(?:$|[?#])/i;

export const PIN_TEXT_MAX = 280;
export const NAME_MAX = 48;

/** Colours for participants' lasers and pins, readable on both themes. */
export const PARTICIPANT_COLORS = ['#3b82f6', '#f97316', '#22c55e', '#e11d48', '#a855f7', '#14b8a6', '#eab308', '#ec4899'];

/**
 * Turn whatever a person pasted into a model reference every participant can
 * load, or explain why it will not work.
 *   - a three.ws avatar link or a bare avatar id -> { kind: 'avatar', id }
 *   - an https URL to a .glb, .gltf or .vrm file  -> { kind: 'url', url }
 * Returns { ref } or { error }.
 */
export function parseModelInput(raw, { origin = 'https://three.ws' } = {}) {
	const text = String(raw ?? '').trim();
	if (!text) return { error: 'Paste a three.ws avatar link or an https link to a .glb, .gltf or .vrm file.' };
	if (/^[0-9a-f-]{36}$/i.test(text) && UUID_RE.test(text)) return { ref: { kind: 'avatar', id: text.toLowerCase() } };

	let url;
	try {
		url = new URL(text);
	} catch {
		return { error: 'That is not a link. Paste a full https:// address.' };
	}
	const host = url.hostname.replace(/^www\./, '');
	const own = host === 'three.ws' || host === new URL(origin).hostname;
	if (own) {
		const id = url.pathname.match(UUID_RE)?.[0] || url.searchParams.get('avatar')?.match(UUID_RE)?.[0];
		if (id && !MODEL_EXT_RE.test(url.pathname)) return { ref: { kind: 'avatar', id: id.toLowerCase() } };
	}
	if (url.protocol !== 'https:' && !(own && url.protocol === 'http:')) {
		return { error: 'Everyone in the meeting loads the model themselves, so the link must be https.' };
	}
	if (!MODEL_EXT_RE.test(url.pathname + url.search)) {
		return { error: 'Link to the model file itself (ending in .glb, .gltf or .vrm), or to a three.ws avatar.' };
	}
	return { ref: { kind: 'url', url: url.href } };
}

/** The GLB URL a participant loads for a model reference. */
export function modelSourceUrl(ref, { origin = 'https://three.ws' } = {}) {
	if (!ref) return null;
	if (ref.kind === 'avatar' && UUID_RE.test(ref.id || '')) return `${origin}/api/avatars/${encodeURIComponent(ref.id)}/glb`;
	if (ref.kind === 'url' && typeof ref.url === 'string') return ref.url;
	return null;
}

/** A stable key for a model, used to scope pins to the model they were placed on. */
export function modelKey(ref) {
	if (!ref) return '';
	if (ref.kind === 'avatar') return `avatar:${ref.id}`;
	if (ref.kind === 'url') return `url:${ref.url}`;
	return '';
}

/** The public page for a model, for links in the export. */
export function modelPageUrl(ref, { origin = 'https://three.ws' } = {}) {
	const src = modelSourceUrl(ref, { origin });
	return src ? `${origin}/viewer#model=${encodeURIComponent(src)}` : null;
}

/** Deterministic colour for a participant, so everyone sees the same colour for the same person. */
export function colorFor(userId) {
	const s = String(userId ?? '');
	let h = 2166136261;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return PARTICIPANT_COLORS[(h >>> 0) % PARTICIPANT_COLORS.length];
}

/** Up to two initials for a display name. */
export function initialsFor(name) {
	const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
	if (!parts.length) return '?';
	const first = [...parts[0]][0] || '';
	const last = parts.length > 1 ? [...parts[parts.length - 1]][0] || '' : '';
	return (first + last).toUpperCase();
}

export function cleanName(name) {
	return String(name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
}

export function cleanPinText(text) {
	return String(text ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim().slice(0, PIN_TEXT_MAX);
}

const finite3 = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n));
const round = (n, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

/**
 * Build a pin record. Positions are in the model's local space so a pin stays
 * on the mesh no matter how each participant's viewer framed the model.
 * Returns { pin } or { error }.
 */
export function createPin({ id, position, normal, text, authorId, authorName, modelRef, createdAt = Date.now() }) {
	const body = cleanPinText(text);
	if (!body) return { error: 'Write a short comment for the pin.' };
	if (!finite3(position)) return { error: 'Click a point on the model to place the pin.' };
	if (!id || !authorId) return { error: 'The pin needs an id and an author.' };
	return {
		pin: {
			id: String(id),
			model: modelKey(modelRef),
			p: position.map((n) => round(n)),
			n: finite3(normal) ? normal.map((n) => round(n, 3)) : null,
			text: body,
			authorId: String(authorId),
			authorName: cleanName(authorName) || 'Guest',
			color: colorFor(authorId),
			createdAt: Number(createdAt) || Date.now(),
		},
	};
}

/** True when a value read from the shared map is a pin this client can render. */
export function isPin(v) {
	return !!v && typeof v === 'object' && typeof v.id === 'string' && finite3(v.p) && typeof v.text === 'string' && typeof v.model === 'string';
}

/** Pins for one model, oldest first, numbered from 1 in that order. */
export function pinsForModel(pins, ref) {
	const key = modelKey(ref);
	return [...pins].filter((p) => isPin(p) && p.model === key).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
}

const mdEscape = (s) => String(s).replace(/([\\`*_[\]<>#|])/g, '\\$1');

/**
 * The meeting's review notes as markdown: one numbered list per model, each
 * pin with its author, time and model-space position.
 */
export function pinsToMarkdown(pins, { models = [], title = 'three.ws design review', date = new Date(), participants = [], origin = 'https://three.ws', timeZone } = {}) {
	const fmtDate = new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
	const fmtTime = new Intl.DateTimeFormat('en-US', { timeStyle: 'short', ...(timeZone ? { timeZone } : {}) });
	const lines = [`# ${mdEscape(title)}`, '', `${fmtDate.format(date)}`];
	const names = [...new Set(participants.map(cleanName).filter(Boolean))];
	if (names.length) lines.push('', `Participants: ${names.map(mdEscape).join(', ')}`);

	const known = new Map(models.map((m) => [modelKey(m.ref), m]));
	const byModel = new Map();
	for (const p of pins) {
		if (!isPin(p)) continue;
		if (!byModel.has(p.model)) byModel.set(p.model, []);
		byModel.get(p.model).push(p);
	}
	if (!byModel.size) {
		lines.push('', 'No comment pins were placed.');
		return `${lines.join('\n')}\n`;
	}
	for (const [key, list] of byModel) {
		const meta = known.get(key);
		const name = meta?.name || (key.startsWith('avatar:') ? `Avatar ${key.slice(7, 15)}` : key.replace(/^url:/, ''));
		const page = meta ? modelPageUrl(meta.ref, { origin }) : null;
		lines.push('', `## ${page ? `[${mdEscape(name)}](${page})` : mdEscape(name)}`, '');
		list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
		list.forEach((p, i) => {
			const at = fmtTime.format(new Date(p.createdAt));
			lines.push(`${i + 1}. ${mdEscape(p.text)} (${mdEscape(p.authorName || 'Guest')}, ${at}, at ${p.p.map((n) => n.toFixed(3)).join(', ')})`);
		});
	}
	return `${lines.join('\n')}\n`;
}

/** Pack an orbit camera into the compact pose that crosses the wire. */
export function packPose(position, target) {
	return { p: [round(position.x, 3), round(position.y, 3), round(position.z, 3)], t: [round(target.x, 3), round(target.y, 3), round(target.z, 3)] };
}

export function isPose(v) {
	return !!v && finite3(v.p) && finite3(v.t);
}

/** Largest coordinate difference between two poses. */
export function poseDistance(a, b) {
	if (!isPose(a) || !isPose(b)) return Infinity;
	let d = 0;
	for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs(a.p[i] - b.p[i]), Math.abs(a.t[i] - b.t[i]));
	return d;
}

/**
 * Where a synced clip should be right now.
 * `anim` is the shared state { clip, playing, time, rate }, `sentAt` the
 * Live Share timestamp of the change and `now` the local clock in the same
 * time base. Looping clips wrap, one-shot clips clamp at their end.
 */
export function playbackTime(anim, sentAt, now, duration, { loop = true } = {}) {
	if (!anim || !(duration > 0)) return 0;
	const base = Number(anim.time) || 0;
	const rate = Number.isFinite(anim.rate) ? anim.rate : 1;
	const elapsed = anim.playing ? Math.max(0, (now - sentAt) / 1000) * rate : 0;
	const t = base + elapsed;
	if (loop) return ((t % duration) + duration) % duration;
	return Math.min(Math.max(t, 0), duration);
}

const CLIP_ID_RE = /^(glb:\d{1,4}|lib:[a-z0-9][a-z0-9_-]{0,63})$/i;

/**
 * The shared animation state with every field validated. `clip` is a clip id:
 * `glb:<index>` for a clip baked into the model file, `lib:<name>` for a clip
 * from the platform library retargeted onto the rig, or '' for none.
 */
export function normalizeAnim(v) {
	const clip = typeof v?.clip === 'string' && CLIP_ID_RE.test(v.clip) ? v.clip : '';
	return {
		clip,
		playing: !!clip && v?.playing !== false,
		time: Number.isFinite(v?.time) && v.time >= 0 ? v.time : 0,
		rate: Number.isFinite(v?.rate) && v.rate > 0 && v.rate <= 4 ? v.rate : 1,
		model: typeof v?.model === 'string' ? v.model : '',
		sentAt: Number.isFinite(v?.sentAt) && v.sentAt > 0 ? v.sentAt : 0,
	};
}

/**
 * The shared model state with every field validated. `at` is the meeting-clock
 * time it was chosen, so a stage opened from an older share never overrides a
 * newer pick. Returns null for an empty stage.
 */
export function normalizeModelState(v) {
	const ref = v?.ref;
	const at = Number.isFinite(v?.at) && v.at > 0 ? v.at : 0;
	if (ref?.kind === 'avatar' && UUID_RE.test(ref.id || '')) return { ref: { kind: 'avatar', id: ref.id.toLowerCase() }, name: cleanName(v.name) || 'Avatar', at };
	if (ref?.kind === 'url' && typeof ref.url === 'string' && /^https?:\/\//i.test(ref.url)) return { ref: { kind: 'url', url: ref.url }, name: cleanName(v.name) || 'Model', at };
	return null;
}

/** Encode a model for the stage URL a side panel shares (?model=...). */
export function encodeModelParam(ref) {
	if (ref?.kind === 'avatar') return ref.id;
	if (ref?.kind === 'url') return ref.url;
	return '';
}
