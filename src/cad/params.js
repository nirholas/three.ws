// CAD Forge: the parameter contract shared by the browser and the API.
//
// A CAD Forge design is a plain build123d Python program. Its tunable
// dimensions are ordinary top-level constants annotated with a label and a
// range, so the file stays runnable anywhere build123d is installed (and in
// text-to-cad, which uses the same kernel):
//
//     # title: Wall-mount phone holder
//     WIDTH = 80  # Overall width [40..160 mm]
//     WALL = 2.4  # Wall thickness [1.2..6 mm]
//
// The parser reads those lines into slider definitions, and the applier
// rewrites only the value on each matching line. Nothing else in the program is
// ever touched, so what the sliders build is exactly the source a user sees and
// downloads.

export const MAX_PARAMS = 12;
export const MAX_TITLE_LEN = 80;
export const MAX_PROMPT_LEN = 600;

const NUM = String.raw`-?\d+(?:\.\d+)?`;
const PARAM_LINE = new RegExp(
	String.raw`^([A-Z][A-Z0-9_]{0,39})(\s*=\s*)(${NUM})(\s*#\s*)(.+?)\s*\[\s*(${NUM})\s*\.\.\s*(${NUM})\s*([A-Za-z°%]*)\s*\]\s*$`,
);
const TITLE_LINE = /^#\s*title\s*:\s*(.+?)\s*$/i;
const SUMMARY_LINE = /^#\s*summary\s*:\s*(.+?)\s*$/i;

function decimals(text) {
	const dot = text.indexOf('.');
	return dot === -1 ? 0 : text.length - dot - 1;
}

/** Slider step for a parameter: integers step by 1, decimals by their precision. */
function stepFor(valueText, minText, maxText) {
	const places = Math.max(decimals(valueText), decimals(minText), decimals(maxText));
	if (places === 0) return 1;
	return Number((10 ** -Math.min(places, 3)).toFixed(3));
}

/**
 * Read a design's title, one-line summary and parameters from its source.
 * @param {string} code
 * @returns {{ title: string|null, summary: string|null, params: Array<{name:string,label:string,value:number,min:number,max:number,step:number,unit:string,line:number}> }}
 */
export function parseDesign(code) {
	const out = { title: null, summary: null, params: [] };
	const lines = String(code || '').split('\n');
	const seen = new Set();
	lines.forEach((raw, index) => {
		const line = raw.replace(/\r$/, '');
		if (!out.title) {
			const t = TITLE_LINE.exec(line);
			if (t) out.title = t[1].slice(0, MAX_TITLE_LEN);
		}
		if (!out.summary) {
			const s = SUMMARY_LINE.exec(line);
			if (s) out.summary = s[1].slice(0, 240);
		}
		const m = PARAM_LINE.exec(line);
		if (!m || seen.has(m[1]) || out.params.length >= MAX_PARAMS) return;
		let min = Number(m[6]);
		let max = Number(m[7]);
		if (min > max) [min, max] = [max, min];
		const value = Number(m[3]);
		if (![value, min, max].every(Number.isFinite) || min === max) return;
		seen.add(m[1]);
		out.params.push({
			name: m[1],
			label: m[5].trim().slice(0, 60),
			value: Math.min(max, Math.max(min, value)),
			min,
			max,
			step: stepFor(m[3], m[6], m[7]),
			unit: m[8] || '',
			line: index + 1,
		});
	});
	return out;
}

function formatValue(value, step) {
	if (step >= 1) return String(Math.round(value));
	const places = Math.min(3, decimals(String(step)));
	return String(Number(value.toFixed(places)));
}

/**
 * Rewrite parameter values in a program. Unknown names are ignored, values are
 * clamped to each parameter's declared range and snapped to its step.
 * @param {string} code
 * @param {Record<string, number>} values
 * @returns {{ code: string, applied: Record<string, number> }}
 */
export function applyParams(code, values = {}) {
	const applied = {};
	const wanted = values && typeof values === 'object' ? values : {};
	const lines = String(code || '').split('\n');
	const { params } = parseDesign(code);
	const byLine = new Map(params.map((p) => [p.line - 1, p]));
	for (const [index, param] of byLine) {
		if (!Object.prototype.hasOwnProperty.call(wanted, param.name)) continue;
		const raw = Number(wanted[param.name]);
		if (!Number.isFinite(raw)) continue;
		const snapped = Math.round(raw / param.step) * param.step;
		const value = Math.min(param.max, Math.max(param.min, snapped));
		const text = formatValue(value, param.step);
		lines[index] = lines[index].replace(PARAM_LINE, (_all, name, eq, _v, hash, label, min, max, unit) =>
			`${name}${eq}${text}${hash}${label} [${min}..${max}${unit ? ` ${unit}` : ''}]`,
		);
		applied[param.name] = Number(text);
	}
	return { code: lines.join('\n'), applied };
}

/** Current parameter values as a plain object. */
export function paramValues(code) {
	return Object.fromEntries(parseDesign(code).params.map((p) => [p.name, p.value]));
}

/** Stable short key for a set of values (cache key for rebuilt variants). */
export function paramsKey(values) {
	const entries = Object.entries(values || {}).sort(([a], [b]) => a.localeCompare(b));
	let h = 2166136261;
	for (const ch of JSON.stringify(entries)) {
		h ^= ch.charCodeAt(0);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h.toString(36);
}

// Densities in g/cm³ for the mass estimates on the design page.
export const MATERIALS = Object.freeze([
	{ id: 'pla', label: 'PLA', density: 1.24 },
	{ id: 'petg', label: 'PETG', density: 1.27 },
	{ id: 'nylon', label: 'Nylon PA12', density: 1.01 },
	{ id: 'aluminum', label: 'Aluminium 6061', density: 2.7 },
	{ id: 'steel', label: 'Steel', density: 7.85 },
	{ id: 'brass', label: 'Brass', density: 8.5 },
]);

/** Mass in grams for a volume in mm³. */
export function massGrams(volumeMm3, density) {
	return (Number(volumeMm3) / 1000) * Number(density);
}
