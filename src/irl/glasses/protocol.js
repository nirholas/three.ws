// src/irl/glasses/protocol.js — pure HUD protocol for the /irl smart-glasses bridge.
//
// Why this exists
// ───────────────
// Companion smart glasses (Brilliant Labs Frame, Even Realities G1) have no browser
// and no WebXR. They are thin Bluetooth displays: the phone running /irl does all the
// GPS, compass, discovery and presence work, then streams a COMPACT heads-up frame to
// the lens over Web Bluetooth. We never render a 3D avatar on the glasses — we render
// the same "nearest agent · which way · how far" signal /irl already computes for the
// on-screen directional nudge (src/irl/proximity-cue.js), reshaped for a tiny mono or
// micro-OLED display.
//
// This module is the pure core of that: it turns a few numbers (nearest agent name,
// distance in metres, screen-relative bearing in radians, nearby count) into a
// device-agnostic HUD model, and then serialises that model to each device's wire
// format. No DOM, no Bluetooth, no clock — so the formatting, the direction glyph and
// the byte-level packet framing are all proven in a unit test, exactly like
// room-anchor.js / proximity-cue.js. The transport + adapter layers above only move
// the bytes this module produces.
//
// Coordinate convention (shared with proximity-cue.js): relBearing is the agent's
// bearing RELATIVE TO WHERE THE VIEWER LOOKS, in radians — 0 = dead ahead,
// + = turn right, − = turn left, ±π = directly behind.

// ── Distance ────────────────────────────────────────────────────────────────
// Glasses real estate is tiny, so distance reads as a single short token. Under a
// metre the agent is effectively on top of you, so we say "here" rather than "0 m";
// kilometre scale (never reached by the ≤60 m discovery radius, but kept honest for
// reuse) collapses to one decimal.
export function formatDistance(metres) {
	if (!Number.isFinite(metres) || metres < 0) return '';
	if (metres < 1) return 'here';
	if (metres < 1000) return `${Math.round(metres)} m`;
	return `${(metres / 1000).toFixed(1)} km`;
}

// ── Direction ─────────────────────────────────────────────────────────────────
// Normalise any angle (radians) to (-π, π] so a bearing reads as the SHORTEST turn —
// +0.1 rad is "barely right", not "almost all the way around". Mirrors
// proximity-cue.normalizeAngle (kept local so this module stays import-free + pure).
export function normalizeAngle(rad) {
	let a = rad % (Math.PI * 2);
	if (a > Math.PI) a -= Math.PI * 2;
	if (a <= -Math.PI) a += Math.PI * 2;
	return a;
}

const PI_8 = Math.PI / 8;       // 22.5°
const PI_4 = Math.PI / 4;       // 45°

// Eight-way unicode arrow pointing toward the agent, indexed clockwise from "ahead".
// 0 = ↑ ahead, 2 = → hard right, 4 = ↓ behind, 6 = ← hard left. The Frame's colour
// OLED renders these directly; if a device font lacks a glyph the turn WORD on the
// second line still carries the meaning, so the arrow is enhancement, never the sole
// signal.
const ARROW_GLYPHS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

// The arrow glyph for a screen-relative bearing. Round the bearing to the nearest 45°
// octant; positive (turn-right) bearings map to the right-hand arrows.
export function arrowGlyph(relBearingRad) {
	if (!Number.isFinite(relBearingRad)) return '';
	const oct = ((Math.round(normalizeAngle(relBearingRad) / PI_4) % 8) + 8) % 8;
	return ARROW_GLYPHS[oct];
}

// Plain-language turn hint — the glyph's words, so meaning survives a missing glyph.
// Symmetric 8-bucket scheme: dead-ahead cone ±22.5°, then slight / square / hard on
// each side, collapsing to "behind" past 157.5°.
export function turnHint(relBearingRad) {
	if (!Number.isFinite(relBearingRad)) return '';
	const a = normalizeAngle(relBearingRad);
	const mag = Math.abs(a);
	if (mag <= PI_8) return 'ahead';
	if (mag >= 7 * PI_8) return 'behind';
	const side = a > 0 ? 'right' : 'left';
	if (mag <= 3 * PI_8) return `slight ${side}`;
	if (mag <= 5 * PI_8) return side;
	return `hard ${side}`;
}

// ── HUD model ───────────────────────────────────────────────────────────────
// The device-agnostic frame. `lines` is the ordered text every simple renderer draws;
// the structured fields back the browser preview + richer layouts. We always emit a
// FIXED number of line slots (LINE_SLOTS) so a renderer that can't clear stale rows
// (it just overdraws fixed positions) never leaves a ghost of the previous frame —
// empty slots are a single space, which overwrites cleanly.
export const LINE_SLOTS = 3;

// Trim an agent name to something a 640px-wide lens can show without wrapping. Keeps
// it honest (ellipsis, not a hard cut mid-word where avoidable).
export function clampName(name, max = 18) {
	const s = String(name ?? '').trim();
	if (!s) return 'Agent';
	if (s.length <= max) return s;
	return `${s.slice(0, max - 1).trimEnd()}…`;
}

function padSlots(lines) {
	const out = lines.slice(0, LINE_SLOTS);
	while (out.length < LINE_SLOTS) out.push(' ');
	return out;
}

/**
 * Build the steady-state HUD from the live proximity read.
 * @param {object} input
 * @param {null|{name:string, distanceM:number, relBearingRad:number}} input.nearest
 *   the closest in-range agent, or null when none are within the bubble
 * @param {number} [input.count] how many agents are currently in range (for the tally)
 * @returns {{ hasTarget:boolean, title:string, arrow:string, turn:string,
 *             distance:string, count:number, countText:string, lines:string[] }}
 */
export function buildHud({ nearest = null, count = 0 } = {}) {
	const n = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

	if (!nearest) {
		return {
			hasTarget: false,
			title: 'No agents near',
			arrow: '',
			turn: '',
			distance: '',
			count: n,
			countText: '',
			lines: padSlots(['three.ws · IRL', 'No agents near', 'Keep exploring']),
		};
	}

	const name = clampName(nearest.name);
	const arrow = arrowGlyph(nearest.relBearingRad);
	const turn = turnHint(nearest.relBearingRad);
	const distance = formatDistance(nearest.distanceM);
	// More than the one you're being pointed at? Tally the rest so the wearer knows the
	// spot is busy without listing anyone (privacy: a direction + a count, never a roster).
	const countText = n > 1 ? `+${n - 1} more nearby` : '';

	const head = arrow ? `${arrow} ${name}` : name;
	const detail = [distance, turn].filter(Boolean).join(' · ');

	return {
		hasTarget: true,
		title: name,
		arrow,
		turn,
		distance,
		count: n,
		countText,
		lines: padSlots([head, detail, countText]),
	};
}

/**
 * A transient one-off frame — e.g. the arrival cue ("an agent just entered range").
 * Shown briefly by the bridge, then it reverts to the live HUD.
 * @param {string} text headline to flash on the lens
 * @returns {{ announcement:true, lines:string[] }}
 */
export function buildAnnouncement(text) {
	const t = String(text ?? '').trim() || 'Agent nearby';
	return { announcement: true, lines: padSlots(['three.ws · IRL', t, 'Look around']) };
}

// A stable signature for a model's visible content, so the bridge can skip re-sending
// an identical frame (BLE writes are precious) while still detecting any change.
export function hudSignature(model) {
	return (model?.lines || []).join('');
}

// ── Brilliant Labs Frame wire format (first-party, documented) ────────────────
// The Frame runs an on-device Lua interpreter: you write UTF-8 Lua to its TX
// characteristic and it evaluates each write as a chunk. We draw text into the
// double-buffered display with frame.display.text(str, x, y) and flip it with
// frame.display.show(). Each statement is emitted SEPARATELY (and kept well under the
// BLE MTU) so the adapter can write them one packet at a time — Frame evaluates each
// independently, the text() calls accumulate in the back buffer, and the final show()
// presents them atomically. Docs: docs.brilliant.xyz/frame/frame-sdk-lua.

// Escape a JS string for embedding in a Lua double-quoted literal.
export function luaEscape(str) {
	return String(str ?? '')
		.replace(/\\/g, '\\\\')
		.replace(/"/g, '\\"')
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r')
		.replace(/\t/g, ' ');
}

// Vertical baselines for the fixed line slots on the 640×400 panel. Generous spacing
// keeps the default font legible through a 20° waveguide.
const FRAME_LINE_Y = [1, 150, 270];

/**
 * Lua statements that render a model on a Frame, in write order. The caller writes
 * each string as its own BLE packet, ending with the show() flip.
 * @returns {string[]}
 */
export function frameLuaStatements(model) {
	const lines = padSlots(model?.lines || []);
	const stmts = lines.map((line, i) => {
		const y = FRAME_LINE_Y[i] ?? (1 + i * 130);
		return `frame.display.text("${luaEscape(line)}",1,${y})`;
	});
	stmts.push('frame.display.show()');
	return stmts;
}

// ── Even Realities G1 wire format (community-reverse-engineered) ───────────────
// The G1 has no official SDK; its protocol is documented by the open-source
// even_glasses project (github.com/emingenc/even_glasses). Each arm exposes a Nordic
// UART Service. Text is pushed with the 0x4E "Send Text" command, a 9-byte header
// followed by UTF-8 text, split across packets when it exceeds the MTU:
//
//   [0]    0x4E                command
//   [1]    seq                 0–255, increments per send (wraps)
//   [2]    total_packets       how many packets this text spans
//   [3]    packet_index        0-based index of this packet
//   [4]    screen_status       0x71 = Text Show (0x70) | New Content (0x01)
//   [5..6] new_char_pos        big-endian char offset (0 for a fresh push)
//   [7]    current_page        1-based
//   [8]    max_page            total pages (1 for our single-screen HUD)
//   [9..]  UTF-8 text bytes
//
// The G1 renders the text block itself (it word-wraps to the 640×200 green display),
// so we join the HUD line slots with newlines rather than positioning each one.
export const G1_CMD_SEND_TEXT = 0x4e;
export const G1_SCREEN_TEXT_SHOW = 0x71; // Text Show | New Content
const G1_HEADER_LEN = 9;
// Conservative payload cap so header+text fits a single BLE write on every G1 firmware
// (negotiated MTU is typically 200+; 180 leaves margin and never needs fragmenting
// for our short HUD, but the chunker is correct for longer text too).
const G1_MAX_PACKET = 180;

// TextEncoder is global in every browser and in Node, so no Buffer fallback:
// naming Buffer here made the build inject an 11 KB polyfill into /glass.
const utf8 = new TextEncoder();
function utf8Bytes(str) {
	return utf8.encode(str);
}

/**
 * Frame a string into one or more G1 0x4E text packets.
 * @param {string} text the full text block to display
 * @param {object} [opts]
 * @param {number} [opts.seq=0] sequence byte (the adapter increments this per send)
 * @returns {Uint8Array[]} packets to write to the arm's TX characteristic, in order
 */
export function g1TextPackets(text, { seq = 0 } = {}) {
	const body = utf8Bytes(String(text ?? ''));
	const maxChunk = G1_MAX_PACKET - G1_HEADER_LEN;
	// Split on the BYTE boundary, then heal any UTF-8 sequence the cut landed inside so
	// a multibyte glyph never straddles two packets corrupted.
	const chunks = [];
	let i = 0;
	while (i < body.length) {
		let end = Math.min(i + maxChunk, body.length);
		if (end < body.length) {
			// Walk back off any UTF-8 continuation byte (10xxxxxx) so we break on a
			// character boundary.
			while (end > i && (body[end] & 0xc0) === 0x80) end--;
			if (end === i) end = Math.min(i + maxChunk, body.length); // pathological: force progress
		}
		chunks.push(body.subarray(i, end));
		i = end;
	}
	if (chunks.length === 0) chunks.push(new Uint8Array(0)); // a clear-screen blank push

	const total = chunks.length;
	return chunks.map((chunk, idx) => {
		const pkt = new Uint8Array(G1_HEADER_LEN + chunk.length);
		pkt[0] = G1_CMD_SEND_TEXT;
		pkt[1] = seq & 0xff;
		pkt[2] = total & 0xff;
		pkt[3] = idx & 0xff;
		pkt[4] = G1_SCREEN_TEXT_SHOW;
		pkt[5] = 0x00; // new_char_pos hi
		pkt[6] = 0x00; // new_char_pos lo
		pkt[7] = 0x01; // current_page
		pkt[8] = 0x01; // max_page
		pkt.set(chunk, G1_HEADER_LEN);
		return pkt;
	});
}

// The text block a G1 render sends — the fixed line slots joined by newlines, with
// trailing blank slots trimmed so the green display isn't padded with empty rows.
export function g1Text(model) {
	const lines = (model?.lines || []).map((l) => (l === ' ' ? '' : l));
	while (lines.length && lines[lines.length - 1] === '') lines.pop();
	return lines.join('\n');
}
