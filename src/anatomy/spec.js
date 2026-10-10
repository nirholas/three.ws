// Anatomy spec: the declarative description of a machine that Claude writes
// and the viewer renders.
//
// One contract for every producer and consumer: the server writer (api/anatomy)
// validates what the model streams, the browser runtime renders it, and the
// `anatomy` agent skill authors it directly. Nothing here imports three.js, so
// the same normalizer runs in Node and the browser.
//
// normalizeSpec() is deliberately forgiving: a model that writes 160 good parts
// and one bad one gets 160 parts and a warning, not an error. Every number is
// clamped to a sane range and every string is length-capped, so a stored spec
// can never make the viewer allocate unbounded geometry. A spec is only
// rejected when nothing renderable survives.

export const SPEC_VERSION = 1;

export const LIMITS = Object.freeze({
	parts: 220,
	effects: 40,
	flows: 24,
	steps: 14,
	pathPoints: 64,
	profilePoints: 64,
	repeat: 96,
	motions: 3,
	gearTeeth: 160,
	rotorBlades: 64,
	springTurns: 60,
	particles: 600,
	title: 80,
	subtitle: 140,
	summary: 600,
	name: 60,
	description: 420,
	stepBody: 520,
	group: 40,
	id: 48,
});

export const AXES = Object.freeze(['x', 'y', 'z']);
export const SHAPE_TYPES = Object.freeze([
	'box',
	'cylinder',
	'tube',
	'cone',
	'sphere',
	'capsule',
	'torus',
	'gear',
	'rotor',
	'lathe',
	'extrude',
	'spring',
	'pipe',
]);
export const PART_STYLES = Object.freeze(['solid', 'wire', 'glass', 'ghost']);
export const MOTION_TYPES = Object.freeze(['spin', 'oscillate', 'crank', 'pulse']);
export const EFFECT_TYPES = Object.freeze(['flame', 'exhaust', 'plasma', 'water', 'smoke', 'steam', 'sparks', 'electric', 'glow']);

// The largest coordinate a spec may use. Machines are authored at roughly
// 1 to 20 units across; the viewer frames whatever it gets, this only stops a
// stray 1e9 from destroying the bounding box.
const MAX_COORD = 500;

export class AnatomySpecError extends Error {
	constructor(message, warnings = []) {
		super(message);
		this.code = 'invalid_spec';
		this.warnings = warnings;
	}
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function num(v, def, min, max) {
	const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
	if (typeof n !== 'number' || !Number.isFinite(n)) return def;
	return Math.min(max, Math.max(min, n));
}

function int(v, def, min, max) {
	return Math.round(num(v, def, min, max));
}

function text(v, max, def = '') {
	if (typeof v !== 'string') return def;
	const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim();
	return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

// Step bodies and descriptions keep paragraph breaks.
function prose(v, max) {
	if (typeof v !== 'string') return '';
	const s = v
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
		.split(/\n{2,}/)
		.map((p) => p.replace(/\s+/g, ' ').trim())
		.filter(Boolean)
		.join('\n\n');
	return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
export function color(v, def = null) {
	if (typeof v !== 'string') return def;
	const m = HEX_RE.exec(v.trim());
	if (!m) return def;
	const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
	return `#${h.toLowerCase()}`;
}

function vec3(v, def = [0, 0, 0], lim = MAX_COORD) {
	if (!Array.isArray(v) || v.length < 3) return def;
	const out = v.slice(0, 3).map((x) => num(x, NaN, -lim, lim));
	return out.some(Number.isNaN) ? def : out;
}

function axis(v, def = 'y') {
	const a = typeof v === 'string' ? v.trim().toLowerCase().replace(/^[-+]/, '') : '';
	return AXES.includes(a) ? a : def;
}

// Ids are referenced by parent links, step focus lists and URLs in the
// viewer, so they are normalized to a safe slug.
export function slugId(v) {
	if (typeof v !== 'string' && typeof v !== 'number') return '';
	return String(v)
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, LIMITS.id);
}

function points2(v, max, lim = MAX_COORD) {
	if (!Array.isArray(v)) return [];
	const out = [];
	for (const p of v.slice(0, max)) {
		if (!Array.isArray(p) || p.length < 2) continue;
		const a = num(p[0], NaN, -lim, lim);
		const b = num(p[1], NaN, -lim, lim);
		if (Number.isNaN(a) || Number.isNaN(b)) continue;
		out.push([a, b]);
	}
	return out;
}

function points3(v, max) {
	if (!Array.isArray(v)) return [];
	const out = [];
	for (const p of v.slice(0, max)) {
		const q = vec3(p, null);
		if (q) out.push(q);
	}
	return out;
}

const pos = (v, def) => num(v, def, 0.001, MAX_COORD);

function normalizeShape(raw, warn, where) {
	if (!isObj(raw)) {
		warn(`${where}: missing shape, used a box`);
		return { type: 'box', size: [1, 1, 1], radius: 0 };
	}
	const type = String(raw.type || '').toLowerCase();
	const ax = axis(raw.axis);
	switch (type) {
		case 'box': {
			const size = Array.isArray(raw.size) ? vec3(raw.size, [1, 1, 1]).map((s) => Math.max(0.001, Math.abs(s))) : [pos(raw.width, 1), pos(raw.height, 1), pos(raw.depth, 1)];
			return { type, size, radius: num(raw.radius, 0, 0, Math.min(...size) / 2) };
		}
		case 'cylinder': {
			const r = pos(raw.radius, 0.5);
			return {
				type,
				axis: ax,
				radiusTop: pos(raw.radiusTop, r),
				radiusBottom: pos(raw.radiusBottom, r),
				length: pos(raw.length ?? raw.height, 1),
				open: raw.open === true,
			};
		}
		case 'tube': {
			const outer = pos(raw.outerRadius ?? raw.radius, 0.5);
			return { type, axis: ax, outerRadius: outer, innerRadius: num(raw.innerRadius, outer * 0.8, 0.001, outer * 0.995), length: pos(raw.length ?? raw.height, 1) };
		}
		case 'cone':
			return { type, axis: ax, radius: pos(raw.radius, 0.5), length: pos(raw.length ?? raw.height, 1) };
		case 'sphere':
			return { type, radius: pos(raw.radius, 0.5), hemisphere: raw.hemisphere === true, axis: ax };
		case 'capsule':
			return { type, axis: ax, radius: pos(raw.radius, 0.3), length: pos(raw.length ?? raw.height, 1) };
		case 'torus': {
			const r = pos(raw.radius, 1);
			return { type, axis: ax, radius: r, tube: num(raw.tube, r * 0.2, 0.001, r), arc: num(raw.arc, 360, 1, 360) };
		}
		case 'gear': {
			const r = pos(raw.radius, 1);
			return {
				type,
				axis: ax,
				teeth: int(raw.teeth, 18, 4, LIMITS.gearTeeth),
				radius: r,
				toothDepth: num(raw.toothDepth, r * 0.12, 0.001, r * 0.6),
				thickness: pos(raw.thickness, r * 0.25),
				bore: num(raw.bore, r * 0.2, 0, r * 0.85),
			};
		}
		case 'rotor': {
			const r = pos(raw.radius, 1);
			return {
				type,
				axis: ax,
				blades: int(raw.blades, 12, 1, LIMITS.rotorBlades),
				radius: r,
				hubRadius: num(raw.hubRadius, r * 0.25, 0.001, r * 0.95),
				chord: pos(raw.chord, r * 0.3),
				thickness: pos(raw.thickness, r * 0.03),
				twist: num(raw.twist, 25, -89, 89),
				pitch: num(raw.pitch, 30, -89, 89),
				hubLength: pos(raw.hubLength, r * 0.3),
			};
		}
		case 'lathe': {
			const profile = points2(raw.profile, LIMITS.profilePoints).map(([r, a]) => [Math.abs(r), a]);
			if (profile.length < 2) {
				warn(`${where}: lathe needs 2+ profile points, used a cylinder`);
				return { type: 'cylinder', axis: ax, radiusTop: 0.5, radiusBottom: 0.5, length: 1, open: false };
			}
			return { type, axis: ax, profile };
		}
		case 'extrude': {
			const points = points2(raw.points, LIMITS.profilePoints);
			if (points.length < 3) {
				warn(`${where}: extrude needs 3+ points, used a box`);
				return { type: 'box', size: [1, 1, 0.2], radius: 0 };
			}
			return { type, axis: axis(raw.axis, 'z'), points, depth: pos(raw.depth, 0.2) };
		}
		case 'spring': {
			const r = pos(raw.radius, 0.4);
			return { type, axis: ax, radius: r, wire: num(raw.wire, r * 0.12, 0.001, r), turns: num(raw.turns, 6, 0.5, LIMITS.springTurns), length: pos(raw.length ?? raw.height, 1) };
		}
		case 'pipe': {
			const path = points3(raw.path, LIMITS.pathPoints);
			if (path.length < 2) {
				warn(`${where}: pipe needs 2+ path points, used a cylinder`);
				return { type: 'cylinder', axis: ax, radiusTop: 0.1, radiusBottom: 0.1, length: 1, open: false };
			}
			return { type, path, radius: pos(raw.radius, 0.08), closed: raw.closed === true };
		}
		default:
			warn(`${where}: unknown shape "${type}", used a box`);
			return { type: 'box', size: vec3(raw.size, [1, 1, 1]).map((s) => Math.max(0.001, Math.abs(s))), radius: 0 };
	}
}

function normalizeMotion(raw, warn, where) {
	const list = Array.isArray(raw) ? raw : isObj(raw) ? [raw] : [];
	const out = [];
	for (const m of list.slice(0, LIMITS.motions)) {
		if (!isObj(m)) continue;
		const type = String(m.type || '').toLowerCase();
		const phase = num(m.phase, 0, -36000, 36000);
		if (type === 'spin') out.push({ type, axis: axis(m.axis), speed: num(m.speed, 0.5, -60, 60), phase });
		else if (type === 'oscillate')
			out.push({
				type,
				axis: axis(m.axis),
				kind: m.kind === 'rotate' ? 'rotate' : 'translate',
				amplitude: num(m.amplitude, m.kind === 'rotate' ? 20 : 0.2, -MAX_COORD, MAX_COORD),
				frequency: num(m.frequency, 1, 0, 60),
				phase,
			});
		else if (type === 'crank') {
			const radius = pos(m.radius, 0.3);
			out.push({ type, axis: axis(m.axis), radius, rod: num(m.rod, radius * 3, radius * 1.05, MAX_COORD), speed: num(m.speed, 1, -60, 60), phase });
		} else if (type === 'pulse') out.push({ type, amplitude: num(m.amplitude, 0.06, 0, 2), frequency: num(m.frequency, 1, 0, 60), phase });
		else warn(`${where}: unknown motion "${type}" dropped`);
	}
	return out;
}

function normalizeRepeat(raw) {
	if (!isObj(raw)) return null;
	const count = int(raw.count, 1, 1, LIMITS.repeat);
	if (count < 2) return null;
	if (Array.isArray(raw.offset)) return { count, mode: 'linear', offset: vec3(raw.offset, [1, 0, 0]) };
	return { count, mode: 'radial', axis: axis(raw.axis), angle: num(raw.angle, 360, 1, 360) };
}

function uniqueId(base, used, fallback) {
	let id = slugId(base) || fallback;
	if (!used.has(id)) {
		used.add(id);
		return id;
	}
	let n = 2;
	while (used.has(`${id}-${n}`)) n++;
	id = `${id}-${n}`;
	used.add(id);
	return id;
}

function normalizePart(raw, i, used, warn) {
	const where = `part ${raw?.id || i + 1}`;
	const id = uniqueId(raw.id ?? raw.name, used, `part-${i + 1}`);
	const style = PART_STYLES.includes(raw.style) ? raw.style : 'solid';
	return {
		id,
		name: text(raw.name, LIMITS.name) || id,
		description: prose(raw.description, LIMITS.description),
		group: text(raw.group, LIMITS.group),
		parent: raw.parent == null || raw.parent === '' ? null : slugId(raw.parent),
		shape: normalizeShape(raw.shape, warn, where),
		position: vec3(raw.position),
		rotation: vec3(raw.rotation, [0, 0, 0], 36000),
		scale: Array.isArray(raw.scale) ? vec3(raw.scale, [1, 1, 1]).map((s) => (Math.abs(s) < 0.001 ? 1 : s)) : [1, 1, 1],
		color: color(raw.color, null),
		style,
		glow: num(raw.glow, 0, 0, 1),
		repeat: normalizeRepeat(raw.repeat),
		motion: normalizeMotion(raw.motion, warn, where),
		explode: Array.isArray(raw.explode) ? vec3(raw.explode) : null,
		label: raw.label === false ? false : raw.label === true ? true : null,
	};
}

const EFFECT_DEFAULTS = Object.freeze({
	flame: ['#ffd27a', '#ff4d1a'],
	exhaust: ['#e8f4ff', '#4f8dff'],
	plasma: ['#f3d9ff', '#9b4dff'],
	water: ['#bfe6ff', '#1f7ae0'],
	smoke: ['#9a9a9a', '#5c5c5c'],
	steam: ['#ffffff', '#cfd8e0'],
	sparks: ['#fff3b0', '#ff9a1f'],
	electric: ['#e6f4ff', '#55aaff'],
	glow: ['#ffe8a8', '#ff8a1f'],
});

function normalizeEffect(raw, i, used, warn) {
	const type = String(raw.type || '').toLowerCase();
	if (!EFFECT_TYPES.includes(type)) {
		warn(`effect ${raw.id || i + 1}: unknown type "${type}" dropped`);
		return null;
	}
	const [c1, c2] = EFFECT_DEFAULTS[type];
	const radius = pos(raw.radius, 0.3);
	const eff = {
		id: uniqueId(raw.id ?? `${type}-${i + 1}`, used, `${type}-${i + 1}`),
		type,
		name: text(raw.name, LIMITS.name) || type[0].toUpperCase() + type.slice(1),
		description: prose(raw.description, LIMITS.description),
		parent: raw.parent == null || raw.parent === '' ? null : slugId(raw.parent),
		position: vec3(raw.position),
		axis: axis(raw.axis),
		direction: num(raw.direction, 1, -1, 1) < 0 ? -1 : 1,
		radius,
		radiusEnd: num(raw.radiusEnd, type === 'flame' ? radius * 0.15 : radius, 0, MAX_COORD),
		length: pos(raw.length, 1),
		size: Array.isArray(raw.size) ? vec3(raw.size, null)?.map((s) => Math.max(0.001, Math.abs(s))) || null : null,
		color: color(raw.color, c1),
		color2: color(raw.color2, c2),
		intensity: num(raw.intensity, 1, 0, 3),
		speed: num(raw.speed, 1, 0, 10),
		count: int(raw.count, type === 'sparks' ? 120 : 160, 8, LIMITS.particles),
	};
	if (type === 'electric') {
		eff.from = vec3(raw.from, [0, 0, 0]);
		eff.to = vec3(raw.to, [0, eff.length, 0]);
	}
	return eff;
}

function normalizeFlow(raw, i, used, warn) {
	const path = points3(raw.path, LIMITS.pathPoints);
	if (path.length < 2) {
		warn(`flow ${raw.id || i + 1}: needs 2+ path points, dropped`);
		return null;
	}
	return {
		id: uniqueId(raw.id ?? raw.name ?? `flow-${i + 1}`, used, `flow-${i + 1}`),
		name: text(raw.name, LIMITS.name) || `Flow ${i + 1}`,
		description: prose(raw.description, LIMITS.description),
		path,
		color: color(raw.color, '#3fa9ff'),
		speed: num(raw.speed, 0.4, 0.01, 10),
		count: int(raw.count, 40, 4, 240),
		size: num(raw.size, 1, 0.2, 5),
		closed: raw.closed === true,
	};
}

/**
 * Validate and normalize a raw spec. Returns { spec, warnings }.
 * Throws AnatomySpecError only when nothing renderable is left.
 */
export function normalizeSpec(raw, { strict = true } = {}) {
	const warnings = [];
	const warn = (m) => {
		if (warnings.length < 60) warnings.push(m);
	};
	if (!isObj(raw)) throw new AnatomySpecError('The spec must be a JSON object.');

	const used = new Set();
	const parts = [];
	for (const [i, p] of (Array.isArray(raw.parts) ? raw.parts : []).entries()) {
		if (parts.length >= LIMITS.parts) {
			warn(`more than ${LIMITS.parts} parts; the rest were dropped`);
			break;
		}
		if (isObj(p)) parts.push(normalizePart(p, i, used, warn));
	}

	// Parent links must point at an earlier-or-later real part and must not
	// form a cycle; anything else is re-rooted so the part still renders.
	const byId = new Map(parts.map((p) => [p.id, p]));
	for (const p of parts) {
		if (p.parent && (!byId.has(p.parent) || p.parent === p.id)) {
			warn(`part ${p.id}: parent "${p.parent}" not found, attached to the root`);
			p.parent = null;
		}
	}
	for (const p of parts) {
		const seen = new Set([p.id]);
		let cur = p.parent;
		while (cur) {
			if (seen.has(cur)) {
				warn(`part ${p.id}: parent cycle broken`);
				p.parent = null;
				break;
			}
			seen.add(cur);
			cur = byId.get(cur)?.parent || null;
		}
	}

	const effects = [];
	for (const [i, e] of (Array.isArray(raw.effects) ? raw.effects : []).slice(0, LIMITS.effects).entries()) {
		if (!isObj(e)) continue;
		const eff = normalizeEffect(e, i, used, warn);
		if (!eff) continue;
		if (eff.parent && !byId.has(eff.parent)) {
			warn(`effect ${eff.id}: parent "${eff.parent}" not found, attached to the root`);
			eff.parent = null;
		}
		effects.push(eff);
	}

	const flows = [];
	for (const [i, f] of (Array.isArray(raw.flows) ? raw.flows : []).slice(0, LIMITS.flows).entries()) {
		if (!isObj(f)) continue;
		const flow = normalizeFlow(f, i, used, warn);
		if (flow) flows.push(flow);
	}

	if (strict && !parts.length) throw new AnatomySpecError('The spec has no renderable parts.', warnings);

	const known = new Set([...parts.map((p) => p.id), ...effects.map((e) => e.id), ...flows.map((f) => f.id)]);
	const steps = [];
	for (const s of (Array.isArray(raw.steps) ? raw.steps : []).slice(0, LIMITS.steps)) {
		if (!isObj(s)) continue;
		const title = text(s.title, LIMITS.name);
		const body = prose(s.body ?? s.text, LIMITS.stepBody);
		if (!title && !body) continue;
		const focus = (Array.isArray(s.focus) ? s.focus : [])
			.map(slugId)
			.filter((id) => {
				if (known.has(id)) return true;
				if (id) warn(`step "${title}": unknown focus id "${id}" ignored`);
				return false;
			});
		steps.push({ title: title || `Step ${steps.length + 1}`, body, focus: [...new Set(focus)] });
	}

	const view = isObj(raw.view) ? raw.view : {};
	const spec = {
		version: SPEC_VERSION,
		title: text(raw.title, LIMITS.title) || 'Untitled machine',
		subtitle: text(raw.subtitle, LIMITS.subtitle),
		summary: prose(raw.summary, LIMITS.summary),
		parts,
		effects,
		flows,
		steps,
		view: {
			speed: num(view.speed, 1, 0, 4),
			explode: num(view.explode, 0, 0, 1),
			section: view.section === 'x' || view.section === 'y' || view.section === 'z' ? view.section : null,
		},
	};
	return { spec, warnings };
}

/** Counts that describe a spec in one line (gallery cards, MCP results). */
export function specStats(spec) {
	let moving = 0;
	let instances = 0;
	for (const p of spec.parts || []) {
		const n = p.repeat?.count || 1;
		instances += n;
		if (p.motion?.length) moving += n;
	}
	return {
		parts: spec.parts?.length || 0,
		instances,
		moving,
		effects: spec.effects?.length || 0,
		flows: spec.flows?.length || 0,
		steps: spec.steps?.length || 0,
	};
}

/**
 * Pull a JSON object out of a model completion: a ```json fence if there is
 * one, otherwise the outermost {...}. Returns the parsed value or null.
 */
export function extractSpecJson(textIn) {
	const source = String(textIn || '');
	const fenced = /```(?:json)?[ \t]*\n([\s\S]*?)```/i.exec(source);
	const candidates = [];
	if (fenced) candidates.push(fenced[1]);
	const first = source.indexOf('{');
	const last = source.lastIndexOf('}');
	if (first !== -1 && last > first) candidates.push(source.slice(first, last + 1));
	for (const c of candidates) {
		try {
			return JSON.parse(c);
		} catch {
			/* try the next candidate */
		}
	}
	return null;
}
