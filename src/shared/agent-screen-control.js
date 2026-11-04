// Shared, pure helpers for the agent-screen CONTROL channel, the reverse of the
// frame stream. Viewers who OWN an agent can take the wheel of its live cast
// browser: mouse, scroll, keyboard, and navigation. These helpers sanitize the
// wire events on the API boundary so only well-formed, in-range input ever
// reaches the caster's real Chromium page. Pure and dependency-free so both the
// API handler and the unit tests import the same logic.
//
// Wire event shapes (all coordinates NORMALIZED to the streamed viewport, 0..1,
// so a client at any display size maps cleanly to the caster's real pixels):
//   { t: 'move',   x, y }
//   { t: 'down',   x, y, button }
//   { t: 'up',     x, y, button }
//   { t: 'click',  x, y, button }
//   { t: 'scroll', x, y, dy }
//   { t: 'key',    key }                 , a single non-text key from KEY_WHITELIST
//   { t: 'text',   text }                , literal characters to type
//   { t: 'nav',    url }                 , navigate the browser (host-guarded)
//   { t: 'back' } | { t: 'forward' } | { t: 'reload' }

export const EVENT_TYPES = new Set([
	'move', 'down', 'up', 'click', 'scroll', 'key', 'text', 'nav', 'back', 'forward', 'reload',
]);

export const BUTTONS = new Set(['left', 'right', 'middle']);

// Non-text keys a driver may press. Deliberately narrow: navigation, editing,
// and submission keys only. Printable characters go through the 'text' event so
// there is no ambiguity and no way to smuggle key chords. No modifiers in v1.
export const KEY_WHITELIST = new Set([
	'Enter', 'Backspace', 'Tab', 'Delete', 'Escape',
	'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
	'Home', 'End', 'PageUp', 'PageDown',
]);

export const MAX_EVENTS_PER_BATCH = 40;
export const MAX_TEXT_LEN = 256;
export const SCROLL_CLAMP = 1200; // px, per wheel event

const clamp01 = (n) => {
	const v = Number(n);
	if (!Number.isFinite(v)) return null;
	return v < 0 ? 0 : v > 1 ? 1 : v;
};

const finiteClamp = (n, lo, hi) => {
	const v = Number(n);
	if (!Number.isFinite(v)) return 0;
	return v < lo ? lo : v > hi ? hi : v;
};

// Reject text that is only control characters or empty; keep printable content
// (including spaces and unicode) but strip C0/C1 control chars that a keyboard
// couldn't type as a character anyway (newlines included, use the Enter key).
function cleanText(raw) {
	if (typeof raw !== 'string') return null;
	// Strip C0 controls (incl. newlines/tabs, use the Enter/Tab keys), DEL, and
	// C1 controls; keep every printable character (spaces + unicode included).
	const CONTROLS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');
	const stripped = raw.replace(CONTROLS, '').slice(0, MAX_TEXT_LEN);
	return stripped.length ? stripped : null;
}

// ── Navigation host guard (SSRF) ─────────────────────────────────────────────
// The caster's browser runs inside our infrastructure. A driver-supplied nav URL
// must never let it reach the cloud metadata endpoint, loopback, or any private
// range. Only public http(s) destinations are allowed. This is the cheap literal
// filter at the API boundary; the caster re-checks every request it makes against
// the addresses the hostname resolves to and the address it connected to
// (workers/agent-screen-pool/egress-guard.js), which covers redirects,
// subresources and DNS rebinding.

// ── egress-guard:address-policy:start ──
// Resolved-address policy, shared byte-for-byte by the API sanitizer
// (src/shared/agent-screen-control.js) and the caster worker
// (workers/agent-screen-pool/egress-guard.js). tests/agent-screen-egress-guard.test.js
// fails if the two copies drift. Pure and dependency-free so the browser bundle
// can import it too. An address is public only when it falls in none of the
// ranges below; IPv6 forms that embed an IPv4 address (mapped, NAT64, 6to4) are
// judged by the embedded IPv4 address.

const V4_BLOCKED = [
	['0.0.0.0', 8],        // this network
	['10.0.0.0', 8],       // private
	['100.64.0.0', 10],    // carrier-grade NAT
	['127.0.0.0', 8],      // loopback
	['169.254.0.0', 16],   // link-local, cloud metadata
	['172.16.0.0', 12],    // private
	['192.0.0.0', 24],     // IETF protocol assignments
	['192.0.2.0', 24],     // documentation
	['192.88.99.0', 24],   // 6to4 relay anycast
	['192.168.0.0', 16],   // private
	['198.18.0.0', 15],    // benchmarking
	['198.51.100.0', 24],  // documentation
	['203.0.113.0', 24],   // documentation
	['224.0.0.0', 4],      // multicast
	['240.0.0.0', 4],      // reserved, broadcast
];

const V6_BLOCKED = [
	['::', 96],            // unspecified, loopback, IPv4-compatible
	['64:ff9b:1::', 48],   // local-use NAT64
	['100::', 64],         // discard-only
	['2001::', 32],        // Teredo
	['2001:db8::', 32],    // documentation
	['fc00::', 7],         // unique local
	['fe80::', 10],        // link-local
	['fec0::', 10],        // site-local (deprecated)
	['ff00::', 8],         // multicast
];

function parseIpv4(s) {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
	if (!m) return null;
	const p = m.slice(1).map(Number);
	if (p.some((n) => n > 255)) return null;
	return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

// IPv6 text to eight 16-bit groups, or null. Accepts '::' compression, a zone
// suffix (fe80::1%eth0) and a dotted IPv4 tail (::ffff:10.0.0.1).
function parseIpv6(s) {
	let str = s.replace(/%.*$/, '');
	if (!str.includes(':')) return null;
	const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(str);
	if (tail) {
		const v4 = parseIpv4(tail[1]);
		if (v4 === null) return null;
		str = `${str.slice(0, -tail[1].length)}${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
	}
	const halves = str.split('::');
	if (halves.length > 2) return null;
	const part = (h) => (h ? h.split(':') : []);
	const head = part(halves[0]);
	const rest = halves.length === 2 ? part(halves[1]) : [];
	const fill = 8 - head.length - rest.length;
	if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
	const groups = [...head, ...Array(halves.length === 2 ? fill : 0).fill('0'), ...rest];
	const out = [];
	for (const g of groups) {
		if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
		out.push(parseInt(g, 16));
	}
	return out;
}

function v4InRange(n, [base, bits]) {
	const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	return ((n & mask) >>> 0) === ((parseIpv4(base) & mask) >>> 0);
}

function v6InRange(g, [base, bits]) {
	const b = parseIpv6(base);
	for (let i = 0; i < 8 && bits > 0; i++, bits -= 16) {
		const take = Math.min(16, bits);
		const mask = (0xffff << (16 - take)) & 0xffff;
		if ((g[i] & mask) !== (b[i] & mask)) return false;
	}
	return true;
}

const isPublicV4 = (n) => !V4_BLOCKED.some((r) => v4InRange(n, r));

export function isAddressAllowed(ip) {
	let s = String(ip ?? '').trim().toLowerCase();
	if (s.startsWith('[') && s.endsWith(']')) s = s.slice(1, -1);
	if (!s) return false;
	const v4 = parseIpv4(s);
	if (v4 !== null) return isPublicV4(v4);
	const g = parseIpv6(s);
	if (!g) return false;
	const embedded = (hi, lo) => ((g[hi] << 16) | g[lo]) >>> 0;
	// ::ffff:a.b.c.d (mapped) and 64:ff9b::a.b.c.d (well-known NAT64).
	if (v6InRange(g, ['::ffff:0:0', 96]) || v6InRange(g, ['64:ff9b::', 96])) return isPublicV4(embedded(6, 7));
	// 2002:aabb:ccdd::/48, 6to4 carries the IPv4 address in groups 1-2.
	if (v6InRange(g, ['2002::', 16])) return isPublicV4(embedded(1, 2));
	return !V6_BLOCKED.some((r) => v6InRange(g, r));
}

// Literal host check on a parsed URL hostname. The WHATWG URL parser has already
// folded decimal, octal, hex and short IPv4 forms into dotted quads and IPv6 into
// canonical hex, so a literal is judged exactly like a resolved address.
export function isHostLiteralAllowed(hostname) {
	let host = String(hostname || '').toLowerCase().replace(/\.$/, '');
	if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1);
	if (!host) return false;
	if (host === 'localhost' || host.endsWith('.localhost')) return false;
	if (host === 'metadata.google.internal' || host.endsWith('.internal')) return false;
	if (host.includes(':') || parseIpv4(host) !== null) return isAddressAllowed(host);
	return true;
}

export function isNavAllowed(rawUrl) {
	let u;
	try {
		u = new URL(String(rawUrl));
	} catch {
		return false;
	}
	if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
	return isHostLiteralAllowed(u.hostname);
}
// ── egress-guard:address-policy:end ──

// Sanitize ONE raw event → a clean event or null (dropped). Coordinates are kept
// normalized; the caster maps them to real pixels at dispatch time.
export function sanitizeEvent(raw) {
	if (!raw || typeof raw !== 'object') return null;
	const t = raw.t;
	if (!EVENT_TYPES.has(t)) return null;

	switch (t) {
		case 'move':
		case 'down':
		case 'up':
		case 'click': {
			const x = clamp01(raw.x);
			const y = clamp01(raw.y);
			if (x === null || y === null) return null;
			const ev = { t, x, y };
			if (t !== 'move') ev.button = BUTTONS.has(raw.button) ? raw.button : 'left';
			return ev;
		}
		case 'scroll': {
			const x = clamp01(raw.x);
			const y = clamp01(raw.y);
			if (x === null || y === null) return null;
			return { t, x, y, dy: finiteClamp(raw.dy, -SCROLL_CLAMP, SCROLL_CLAMP) };
		}
		case 'key':
			return KEY_WHITELIST.has(raw.key) ? { t, key: raw.key } : null;
		case 'text': {
			const text = cleanText(raw.text);
			return text ? { t, text } : null;
		}
		case 'nav':
			return isNavAllowed(raw.url) ? { t, url: String(raw.url) } : null;
		case 'back':
		case 'forward':
		case 'reload':
			return { t };
		default:
			return null;
	}
}

// Sanitize a batch. Drops invalid events silently (a fat-fingered event should
// never fail the whole gesture) and caps the batch length.
export function sanitizeEvents(rawList) {
	if (!Array.isArray(rawList)) return [];
	const out = [];
	for (const raw of rawList) {
		if (out.length >= MAX_EVENTS_PER_BATCH) break;
		const clean = sanitizeEvent(raw);
		if (clean) out.push(clean);
	}
	return out;
}
