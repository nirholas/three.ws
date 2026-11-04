// walk-embed-events.js — the bi-directional postMessage contract between a host
// page and the three.ws walk-embed iframe.
//
// This is the single source of truth for the event protocol. Both sides of the
// boundary import (or, for the standalone SDK, mirror) the constants and helpers
// here so the wire format can never drift between the iframe and the host.
//
// ── Envelope ───────────────────────────────────────────────────────────────
// Every message is a plain object:
//   {
//     channel: 'three-walk',   // namespace guard — ignore anything else
//     v: 1,                    // protocol version
//     type: 'walk:position',   // see INBOUND / OUTBOUND below
//     id?: '<correlation id>', // echoes a command id on its result event
//     ...payload               // type-specific fields
//   }
// The legacy flat `{ type: 'walk:*' }` shape (no channel/version) is still
// accepted on the inbound side for backward compatibility with embeds shipped
// before this module existed — see isWalkMessage().
//
// ── Public contract (task 48) ──────────────────────────────────────────────
// Outbound (iframe → host):
//   walk:ready    { avatarId, env }
//   walk:position { x, z, heading }                 (10 Hz while moving)
//   walk:gesture  { gesture, played? }               (echo; played=false when the body
//                                                    cannot perform a wave/jump)
//   walk:speak    { text, durationMs }               (when the avatar speaks)
//   walk:env      { env }                            (environment changed)
//   walk:error    { code, message, fallback? }       (fallback=true: the default body is
//                                                    standing in, e.g. avatar_load_failed,
//                                                    avatar_not_animatable; still ready)
// Inbound (host → iframe):
//   walk:goto     { x, z }
//   walk:gesture  { gesture }
//   walk:say      { text, voice }
//   walk:env      { env }
//   walk:avatar   { avatarId }
//   walk:config   { speed?, bg?, controls? }
//
// ── Handshake ──────────────────────────────────────────────────────────────
//   iframe → host : walk:ready             (once, when the avatar is loaded)
//   host   → iframe: walk:ping  (optional) → iframe replies walk:ready again
// A host that mounts the iframe after it has already loaded can fire walk:ping
// to re-trigger the ready event instead of racing the initial walk:ready.

export const CHANNEL = 'three-walk';
export const PROTOCOL_VERSION = 1;

// Commands a host sends INTO the iframe. Canonical names are the task-48 public
// contract; legacy names (walk:setEnvironment, walk:setAvatar, walk:setMotion,
// walk:narrate, walk:move…) are accepted as aliases — see INBOUND_ALIASES.
export const INBOUND = Object.freeze({
	PING: 'walk:ping',
	GOTO: 'walk:goto', // { x, z } — walk to a world position then stop
	MOVE: 'walk:move', // { x, y, run? } analog vector, OR { dir, meters? } discrete
	GESTURE: 'walk:gesture', // { gesture: 'wave' | 'jump' | 'idle' | 'walk' | 'run' }
	SAY: 'walk:say', // { text, voice?, durationMs? }
	SET_ENVIRONMENT: 'walk:env', // { env }
	SET_AVATAR: 'walk:avatar', // { avatarId } (legacy: { id })
	SET_CONFIG: 'walk:config', // { speed?, bg?, controls? }
	RESET: 'walk:reset',
});

// Events the iframe emits OUT to the host. Canonical names match the task-48
// contract; legacy names hosts may already listen for are emitted alongside
// (see legacyOutbound() and the embed runtime's emit()).
export const OUTBOUND = Object.freeze({
	READY: 'walk:ready', // { avatarId, env }
	POSITION: 'walk:position', // { x, z, heading }
	GESTURE: 'walk:gesture', // { gesture }
	SPEAK: 'walk:speak', // { text, durationMs }
	ENVIRONMENT: 'walk:env', // { env }
	AVATAR_CHANGED: 'walk:avatarChanged', // { avatarId }
	ERROR: 'walk:error', // { code, message }
});

// ── Aliases ──────────────────────────────────────────────────────────────────
// Older embeds spoke walk:setEnvironment / walk:setAvatar / walk:setMotion /
// walk:narrate / walk:resetPose. We accept those names on input so no existing
// integration breaks when this contract lands.
const INBOUND_ALIASES = Object.freeze({
	'walk:setEnvironment': INBOUND.SET_ENVIRONMENT,
	'walk:setEnv': INBOUND.SET_ENVIRONMENT,
	'walk:setAvatar': INBOUND.SET_AVATAR,
	'walk:setMotion': INBOUND.GESTURE,
	'walk:narrate': INBOUND.SAY,
	'walk:resetPose': INBOUND.RESET,
});

const ALL_INBOUND = new Set([...Object.values(INBOUND), ...Object.keys(INBOUND_ALIASES)]);
const ALL_OUTBOUND = new Set([...Object.values(OUTBOUND), 'walk:loaded', 'walk:moved', 'walk:environment', 'walk:gestured', 'walk:spoke']);
const ALL_TYPES = new Set([...ALL_INBOUND, ...ALL_OUTBOUND]);

// ── Origin allow-listing ─────────────────────────────────────────────────────
// The walk embed is designed to be dropped onto ANY origin (it ships
// `frame-ancestors *`), so the host page's origin can be anything. We therefore
// default to allow-any on inbound. What we ALWAYS validate (in the runtime) is
// the message *source*: the iframe only accepts messages whose source window is
// its own parent, and the host SDK only accepts messages whose source is the
// iframe it mounted. That source check is the real authentication; the optional
// `allowedOrigins` list below is a belt-and-suspenders filter a security-
// conscious integrator can opt into when they know the host's exact origin.
export function makeOriginAllowList(origins) {
	if (!origins || origins === '*') return () => true;
	const list = (Array.isArray(origins) ? origins : [origins]).map(normalizeOrigin).filter(Boolean);
	if (!list.length) return () => true;
	const set = new Set(list);
	return (origin) => origin === 'null' /* sandboxed/file iframe */ || set.has(normalizeOrigin(origin));
}

function normalizeOrigin(o) {
	if (o === '*' || o == null) return '';
	try {
		return new URL(o).origin;
	} catch {
		return String(o || '');
	}
}

// ── Envelope helpers ──────────────────────────────────────────────────────────
export function makeMessage(type, payload = {}, { id } = {}) {
	const msg = { channel: CHANNEL, v: PROTOCOL_VERSION, type, ...payload };
	if (id) msg.id = id;
	return msg;
}

// Is this a message we should handle at all? Accepts the new channelled
// envelope AND the legacy flat `walk:*` shape so old hosts keep working.
export function isWalkMessage(data) {
	if (!data || typeof data !== 'object') return false;
	if (data.channel === CHANNEL) return typeof data.type === 'string';
	// Legacy / flat: any object whose `type` is a known walk event.
	return typeof data.type === 'string' && ALL_TYPES.has(data.type);
}

// Normalize an inbound command to its canonical type, resolving aliases.
export function canonicalInboundType(type) {
	if (INBOUND_ALIASES[type]) return INBOUND_ALIASES[type];
	return ALL_INBOUND.has(type) ? type : null;
}

// ── Vocabulary (exported so the SDK + docs stay in sync with the runtime) ─────
export const ENV_IDS = Object.freeze(['studio', 'void', 'beach', 'sunset', 'night', 'grid']);
export const GESTURES = Object.freeze(['idle', 'walk', 'run', 'wave', 'jump']);
export const DIRECTIONS = Object.freeze(['forward', 'back', 'left', 'right']);
export const CONTROL_MODES = Object.freeze(['joystick', 'keyboard', 'none']);
export const SAY_MAX = 280;
// World bound the avatar can be sent to. Mirrors GROUND_RADIUS in walk-embed.js
// (12m) minus a small margin so a goto target never lands off the ground disc.
export const WORLD_RADIUS = 11.5;

const ENV_SET = new Set(ENV_IDS);
const GESTURE_SET = new Set(GESTURES);
const DIRECTION_SET = new Set(DIRECTIONS);
const CONTROL_SET = new Set(CONTROL_MODES);

// ── Inbound command validation (runs inside the iframe) ──────────────────────
// Returns { type, payload } on success or { error } describing the rejection.
// Trusts nothing: clamps numbers, bounds strings, rejects unknown shapes. This
// is the boundary between the untrusted host page and the embed's runtime.
export function validateInbound(raw) {
	const type = canonicalInboundType(raw?.type);
	if (!type) return { error: `unknown command: ${raw?.type}` };
	const id = typeof raw.id === 'string' ? raw.id.slice(0, 64) : undefined;

	switch (type) {
		case INBOUND.PING:
		case INBOUND.RESET:
			return { type, id, payload: {} };

		case INBOUND.GOTO: {
			const x = clampWorld(num(raw.x, 0));
			const z = clampWorld(num(raw.z, 0));
			return { type, id, payload: { x, z } };
		}

		case INBOUND.MOVE: {
			// Two accepted shapes: analog { x, y, run } or discrete { dir, meters }.
			if (typeof raw.dir === 'string') {
				if (!DIRECTION_SET.has(raw.dir)) return { error: `move.dir must be one of ${DIRECTIONS.join('/')}` };
				const meters = clamp(num(raw.meters, 1), 0, 12);
				return { type, id, payload: { dir: raw.dir, meters } };
			}
			const x = clamp(num(raw.x, 0), -1, 1);
			const y = clamp(num(raw.y, 0), -1, 1);
			const run = raw.run === true;
			return { type, id, payload: { x, y, run } };
		}

		case INBOUND.GESTURE: {
			const g = raw.gesture ?? raw.motion; // legacy walk:setMotion used `motion`
			if (!GESTURE_SET.has(g)) return { error: `gesture must be one of ${GESTURES.join('/')}` };
			return { type, id, payload: { gesture: g } };
		}

		case INBOUND.SAY: {
			const text = typeof raw.text === 'string' ? raw.text.slice(0, SAY_MAX) : '';
			if (!text.trim()) return { error: 'say.text required' };
			const voice = typeof raw.voice === 'string' ? raw.voice.slice(0, 64) : undefined;
			const durationMs = raw.durationMs == null ? undefined : clamp(num(raw.durationMs, 0), 800, 20000);
			return { type, id, payload: { text, voice, durationMs } };
		}

		case INBOUND.SET_ENVIRONMENT: {
			const e = String(raw.env || '').toLowerCase();
			if (!ENV_SET.has(e)) return { error: `env must be one of ${ENV_IDS.join('/')}` };
			return { type, id, payload: { env: e } };
		}

		case INBOUND.SET_AVATAR: {
			const avatarId = typeof raw.avatarId === 'string'
				? raw.avatarId
				: (typeof raw.id === 'string' ? raw.id : (typeof raw.avatar === 'string' ? raw.avatar : ''));
			if (!avatarId || avatarId.length > 2048) return { error: 'avatar.avatarId required' };
			return { type, id: undefined, payload: { avatarId } };
		}

		case INBOUND.SET_CONFIG: {
			const payload = {};
			if (raw.speed != null) payload.speed = clamp(num(raw.speed, 1), 0.3, 3);
			if (raw.bg != null) payload.bg = sanitizeBg(raw.bg);
			if (raw.controls != null) {
				const c = String(raw.controls).toLowerCase();
				if (!CONTROL_SET.has(c)) return { error: `config.controls must be one of ${CONTROL_MODES.join('/')}` };
				payload.controls = c;
			}
			return { type, id, payload };
		}

		default:
			return { error: `unhandled command: ${type}` };
	}
}

// Only allow CSS hex colors, a small set of safe keywords, or rgb()/rgba() —
// never arbitrary strings (defends against url()/expression injection into a
// host-controlled style value).
function sanitizeBg(v) {
	const s = String(v).trim().slice(0, 32);
	if (s.toLowerCase() === 'transparent') return 'transparent';
	if (/^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(s)) return s;
	if (/^rgba?\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*(,\s*[\d.]+\s*)?\)$/.test(s)) return s;
	return 'transparent';
}

function clampWorld(n) {
	const r = WORLD_RADIUS;
	return clamp(n, -r, r);
}
function num(v, fallback) {
	const n = typeof v === 'number' ? v : Number(v);
	return Number.isFinite(n) ? n : fallback;
}
function clamp(n, lo, hi) {
	return Math.min(hi, Math.max(lo, n));
}

// ── Embed-side bridge ─────────────────────────────────────────────────────────
// Wires the public postMessage contract to the real walk-embed runtime
// (src/walk-embed.js) without coupling the two modules at import time. The
// runtime publishes a small imperative handle on `window.__walkEmbed`; this
// bridge consumes it. Loaded by pages/walk-embed.html.
//
// `runtime` is the handle the embed exposes:
//   {
//     goto(x, z), gesture(g), say(text, voice, durationMs), setEnv(env),
//     setAvatar(avatarId), config({speed, bg, controls}), reset(),
//     getReady() -> { avatarId, env } | null
//   }
// plus `runtime.on(event, cb)` for outbound lifecycle hooks the bridge re-emits
// as typed walk:* messages. The bridge owns ALL host-facing postMessage: origin
// validation, the typed envelope, and never leaking internal state.
export function installEmbedBridge(runtime, {
	win = typeof window !== 'undefined' ? window : null,
	allowedOrigins = '*',
	targetOrigin = '*',
} = {}) {
	if (!win) return () => {};
	const parentWin = win.parent && win.parent !== win ? win.parent : null;
	const originAllowed = makeOriginAllowList(allowedOrigins);

	function post(type, payload, opts) {
		if (!parentWin) return;
		try { parentWin.postMessage(makeMessage(type, payload, opts), targetOrigin); } catch {}
	}

	// Outbound: re-emit the runtime's real lifecycle events as typed messages.
	runtime.on?.(OUTBOUND.READY, (d) => post(OUTBOUND.READY, { avatarId: d.avatarId, env: d.env }));
	runtime.on?.(OUTBOUND.POSITION, (d) => post(OUTBOUND.POSITION, { x: d.x, z: d.z, heading: d.heading }));
	runtime.on?.(OUTBOUND.GESTURE, (d) => post(OUTBOUND.GESTURE, {
		gesture: d.gesture,
		...(typeof d.played === 'boolean' ? { played: d.played } : {}),
	}));
	runtime.on?.(OUTBOUND.SPEAK, (d) => post(OUTBOUND.SPEAK, { text: d.text, durationMs: d.durationMs }));
	runtime.on?.(OUTBOUND.ENVIRONMENT, (d) => post(OUTBOUND.ENVIRONMENT, { env: d.env }));
	runtime.on?.(OUTBOUND.AVATAR_CHANGED, (d) => post(OUTBOUND.AVATAR_CHANGED, { avatarId: d.avatarId }));
	runtime.on?.(OUTBOUND.ERROR, (d) => post(OUTBOUND.ERROR, {
		code: d.code || 'error',
		message: d.message,
		...(d.fallback === true ? { fallback: true } : {}),
	}));

	// Inbound: validate, then apply to the real avatar/controls.
	function onMessage(e) {
		// Source check is the real authentication: only accept from our parent.
		if (parentWin && e.source !== parentWin) return;
		if (!originAllowed(e.origin)) return;
		const data = e.data;
		if (!isWalkMessage(data)) return;

		const result = validateInbound(data);
		if (result.error) {
			post(OUTBOUND.ERROR, { code: 'bad_command', message: result.error }, { id: typeof data.id === 'string' ? data.id.slice(0, 64) : undefined });
			return;
		}
		const { type, id, payload } = result;
		try {
			switch (type) {
				case INBOUND.PING: {
					const ready = runtime.getReady?.();
					if (ready) post(OUTBOUND.READY, { avatarId: ready.avatarId, env: ready.env }, { id });
					break;
				}
				case INBOUND.GOTO:
					runtime.goto?.(payload.x, payload.z);
					break;
				case INBOUND.MOVE:
					runtime.move?.(payload);
					break;
				case INBOUND.GESTURE:
					runtime.gesture?.(payload.gesture);
					break;
				case INBOUND.SAY:
					runtime.say?.(payload.text, payload.voice, payload.durationMs);
					break;
				case INBOUND.SET_ENVIRONMENT:
					runtime.setEnv?.(payload.env);
					break;
				case INBOUND.SET_AVATAR:
					runtime.setAvatar?.(payload.avatarId);
					break;
				case INBOUND.SET_CONFIG:
					runtime.config?.(payload);
					break;
				case INBOUND.RESET:
					runtime.reset?.();
					break;
				default:
					break;
			}
		} catch (err) {
			post(OUTBOUND.ERROR, { code: 'command_failed', message: String(err?.message || err) }, { id });
		}
	}

	win.addEventListener('message', onMessage);
	return () => win.removeEventListener('message', onMessage);
}
