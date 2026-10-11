// Animated SVG visuals for the generated GitHub profile README.
//
// GitHub renders README images through <img>, so there is no script, no web
// font and no interaction. What does survive is SVG geometry, SMIL and CSS
// animation, which is enough for real 3D: every rotating body here is a flat
// ring drawn in a group that is rotated by animateTransform and then squashed
// by scale(1, k). That is the exact orthographic projection of a ring spinning
// about a vertical axis seen from elevation asin(k), so the motion is true 3D
// with no precomputed frames. Dots and labels ride inside a counter-rotated,
// un-squashed group so they stay round and upright while they orbit.
//
// Every number is computed from the repo list handed in; nothing is sampled
// or invented. Each visual renders once per theme and the README picks one
// with <picture> and prefers-color-scheme.

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans',Helvetica,Arial,sans-serif`;

// Categorical slots follow the section order in build-github-profile.mjs, so a
// section keeps the same color in every visual. Validated set: light and dark
// steps of the same eight hues, checked for CVD separation on adjacent pairs.
const THEMES = {
	dark: {
		text: '#e6edf3',
		sub: '#9198a1',
		muted: '#6e7681',
		grid: '#30363d',
		surface: '#0d1117',
		body: ['#1a2333', '#0d1117'],
		accent: '#9085e9',
		seq: '#3987e5',
		series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
	},
	light: {
		text: '#1f2328',
		sub: '#59636e',
		muted: '#818b98',
		grid: '#d1d9e0',
		surface: '#ffffff',
		body: ['#f4f7fc', '#ffffff'],
		accent: '#6250d6',
		seq: '#2a78d6',
		series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
	},
};

// GitHub linguist colors, so a language looks the way it does everywhere else on GitHub.
const LANG_COLORS = {
	TypeScript: '#3178c6',
	JavaScript: '#f1e05a',
	Python: '#3572a5',
	Rust: '#dea584',
	Solidity: '#aa6746',
	HTML: '#e34c26',
	CSS: '#663399',
	Go: '#00add8',
	Shell: '#89e051',
	Svelte: '#ff3e00',
	Vue: '#41b883',
	Swift: '#f05138',
	Kotlin: '#a97bff',
	Java: '#b07219',
	'C++': '#f34b7d',
	C: '#555555',
	'C#': '#178600',
	Ruby: '#701516',
	PHP: '#4f5d95',
	Dart: '#00b4ab',
	Move: '#4a137a',
	MDX: '#fcb32c',
	'Jupyter Notebook': '#da5b0b',
	Dockerfile: '#384d54',
	Makefile: '#427819',
	Lua: '#000080',
	Zig: '#ec915c',
};

const r1 = (n) => Math.round(n * 10) / 10;
const r2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => n.toLocaleString('en-US');
const short = (n) => (n >= 1000 ? `${r1(n / 1000)}k` : String(n));
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const frac = (x) => x - Math.floor(x);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const rad = (d) => (d * Math.PI) / 180;

/** Section titles shortened for tight labels: "Developer tools and everything else" becomes "Developer tools". */
export const shortTitle = (title) => title.replace(/ (and|for|platform)\b.*$/i, '').trim();

function shade(hex, amount) {
	const n = parseInt(hex.slice(1), 16);
	const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount)));
	return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

function svg(w, h, title, desc, body, style = '') {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d" font-family="${FONT}">
<title id="t">${esc(title)}</title>
<desc id="d">${esc(desc)}</desc>
${style ? `<style>${style}</style>\n` : ''}${body}
</svg>
`;
}

function heading(t, x, y, title, sub) {
	return `<text x="${x}" y="${y}" fill="${t.text}" font-size="19" font-weight="700">${esc(title)}</text>
<text x="${x}" y="${y + 21}" fill="${t.sub}" font-size="12.5">${esc(sub)}</text>`;
}

/** Spinning repo planet: one dot per repo, sized by stars, colored by section, plus a section legend. */
function planet(repos, groups, t) {
	const W = 900;
	const H = 440;
	const cx = 238;
	const cy = 226;
	const R = 172;
	const elev = rad(22);
	const k = Math.sin(elev);
	const ce = Math.cos(elev);
	const period = 90;
	const total = repos.length;
	const out = [];

	out.push(`<defs>
<radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="55%" stop-color="${t.accent}" stop-opacity="0.16"/><stop offset="100%" stop-color="${t.accent}" stop-opacity="0"/></radialGradient>
<radialGradient id="body" cx="38%" cy="30%" r="75%"><stop offset="0%" stop-color="${t.body[0]}"/><stop offset="100%" stop-color="${t.body[1]}"/></radialGradient>
</defs>
<circle cx="${cx}" cy="${cy}" r="${R * 1.32}" fill="url(#glow)"/>
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#body)" stroke="${t.grid}"/>`);

	// Latitude rings: back half dashed and faint, front half drawn after the dots.
	const rings = [-0.7, -0.38, 0, 0.38, 0.7].map((s) => ({ y: r1(cy - R * s * ce), rho: r1(R * Math.sqrt(1 - s * s)) }));
	const arc = (g, sweep) => `M${r1(cx - g.rho)} ${g.y}A${g.rho} ${r1(g.rho * k)} 0 0 ${sweep} ${r1(cx + g.rho)} ${g.y}`;
	out.push(`<path d="${rings.map((g) => arc(g, 1)).join('')}" fill="none" stroke="${t.grid}" stroke-dasharray="2 5"/>`);

	// translate * scale(1,k) * rotate(a) * T(rho) * rotate(-a) * scale(1,1/k): the child rides its ring in true
	// projected 3D while staying upright and unsquashed. Callers close the five groups it opens.
	const ride = (y, rho, lon) =>
		`<g transform="translate(${cx} ${y}) scale(1 ${r2(k)})"><g><animateTransform attributeName="transform" type="rotate" from="${r1(lon)}" to="${r1(lon + 360)}" dur="${period}s" repeatCount="indefinite"/><g transform="translate(${rho} 0)"><g><animateTransform attributeName="transform" type="rotate" from="${r1(-lon)}" to="${r1(-lon - 360)}" dur="${period}s" repeatCount="indefinite"/><g transform="scale(1 ${r2(1 / k)})">`;
	const dots = [];
	const labels = [];
	let start = 0;
	for (const g of groups) {
		const n = g.items.length;
		const span = (360 * n) / total;
		g.items.forEach((r, i) => {
			const s = (1 - 2 * frac(i * 0.618034 + 0.31)) * 0.93;
			const lon = start + span * (0.06 + 0.88 * frac(i * 0.7548777 + 0.13));
			const y = r1(cy - R * s * ce);
			const rho = r1(R * Math.sqrt(1 - s * s));
			const size = r1(2.4 + 2.2 * Math.log10(r.stargazerCount + 1));
			const steps = 12;
			const at = (j) => Math.sin(rad(lon + (j * 360) / steps));
			const op = Array.from({ length: steps + 1 }, (_, j) => r2(0.2 + 0.8 * ((1 + at(j)) / 2) ** 1.4)).join(';');
			const rr = Array.from({ length: steps + 1 }, (_, j) => r2((size / 2) * (0.72 + 0.4 * ((1 + at(j)) / 2)))).join(';');
			dots.push(`${ride(y, rho, lon)}<circle r="${r1(size / 2)}" fill="${t.series[g.slot]}"><animate attributeName="fill-opacity" values="${op}" dur="${period}s" repeatCount="indefinite"/><animate attributeName="r" values="${rr}" dur="${period}s" repeatCount="indefinite"/></circle></g></g></g></g></g>`);
			if (repos.indexOf(r) < 6) {
				const ls = 36;
				const lop = Array.from({ length: ls + 1 }, (_, j) => r2(clamp((Math.sin(rad(lon + (j * 360) / ls)) - 0.2) / 0.45, 0, 1))).join(';');
				labels.push(
					`${ride(y, rho, lon)}<text x="${r1(size / 2 + 6)}" y="4" fill="${t.text}" font-size="12" font-weight="600" stroke="${t.surface}" stroke-width="3" paint-order="stroke">${esc(r.name)} <tspan fill="${t.sub}" font-weight="400">★${short(r.stargazerCount)}</tspan><animate attributeName="opacity" values="${lop}" dur="${period}s" repeatCount="indefinite"/></text></g></g></g></g></g>`,
				);
			}
		});
		start += span;
	}
	out.push(...dots);
	out.push(`<path d="${rings.map((g) => arc(g, 0)).join('')}" fill="none" stroke="${t.grid}" stroke-opacity="0.9"/>`);

	// A tilted orbit with data flowing along it.
	out.push(`<g transform="translate(${cx} ${cy}) rotate(-16)"><ellipse rx="${R * 1.24}" ry="${R * 0.26}" fill="none" stroke="${t.accent}" stroke-opacity="0.55" stroke-width="1.4" stroke-dasharray="1 9" stroke-linecap="round"><animate attributeName="stroke-dashoffset" from="0" to="-100" dur="6s" repeatCount="indefinite"/></ellipse></g>`);
	out.push(...labels);

	// Legend: one row per section with its repo count and a bar of its share.
	const lx = 492;
	const lw = W - 24 - lx;
	const maxN = Math.max(...groups.map((g) => g.items.length));
	const legend = [heading(t, lx, 50, `${total} repositories in orbit`, 'One point per public repo. Size is stars, color is the section.')];
	groups.forEach((g, i) => {
		const y = 112 + i * 38;
		const stars = g.items.reduce((n, r) => n + r.stargazerCount, 0);
		legend.push(`<circle cx="${lx + 5}" cy="${y - 4}" r="5" fill="${t.series[g.slot]}"/>
<text x="${lx + 18}" y="${y}" fill="${t.text}" font-size="13.5">${esc(g.title)}</text>
<text x="${lx + lw}" y="${y}" fill="${t.sub}" font-size="12.5" text-anchor="end"><tspan fill="${t.text}" font-weight="700">${g.items.length}</tspan> · ★${fmt(stars)}</text>
<rect x="${lx + 18}" y="${y + 8}" width="${lw - 18}" height="3" rx="1.5" fill="${t.grid}" fill-opacity="0.6"/>
<rect x="${lx + 18}" y="${y + 8}" width="${r1(((lw - 18) * g.items.length) / maxN)}" height="3" rx="1.5" fill="${t.series[g.slot]}"><animate attributeName="width" from="0" to="${r1(((lw - 18) * g.items.length) / maxN)}" dur="1.4s" begin="${r2(0.2 + i * 0.08)}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1"/></rect>`);
	});
	out.push(...legend);

	return svg(W, H, `${total} repositories in orbit`, `A rotating 3D sphere with one point for each of ${total} public repositories, sized by stars and colored by section. ${groups.map((g) => `${g.title}: ${g.items.length}`).join('; ')}.`, out.join('\n'));
}

/** Odometer stat strip: each digit rolls into place on its own spline. */
function odometer(stats, t) {
	const W = 900;
	const H = 128;
	const tw = W / stats.length;
	const lh = 46;
	const dw = 23;
	const cw = 9;
	const base = 82;
	const out = [`<defs>`];
	const body = [];
	stats.forEach((s, i) => {
		const x0 = i * tw;
		const mid = x0 + tw / 2;
		const chars = fmt(s.value).split('');
		const width = chars.reduce((w, c) => w + (c === ',' ? cw : dw), 0);
		let x = mid - width / 2;
		if (i) body.push(`<line x1="${r1(x0)}" y1="22" x2="${r1(x0)}" y2="${H - 14}" stroke="${t.grid}"/>`);
		body.push(`<text x="${r1(mid)}" y="34" fill="${t.sub}" font-size="11.5" font-weight="600" letter-spacing="1.2" text-anchor="middle">${esc(s.label.toUpperCase())}</text>`);
		let d = 0;
		chars.forEach((c) => {
			if (c === ',') {
				body.push(`<text x="${r1(x + cw / 2)}" y="${base}" fill="${t.text}" font-size="38" font-weight="700" text-anchor="middle">,</text>`);
				x += cw;
				return;
			}
			const id = `c${i}_${d}`;
			out.push(`<clipPath id="${id}"><rect x="${r1(x)}" y="${base - 38}" width="${dw}" height="${lh}"/></clipPath>`);
			const target = 10 + Number(c);
			const col = Array.from({ length: 20 }, (_, n) => `<text x="${r1(x + dw / 2)}" y="${base + n * lh}" text-anchor="middle">${n % 10}</text>`).join('');
			const dur = r2(1.6 + d * 0.22 + i * 0.12);
			body.push(`<g clip-path="url(#${id})"><g transform="translate(0 ${-target * lh})" fill="${t.text}" font-size="38" font-weight="700">${col}<animateTransform attributeName="transform" type="translate" from="0 0" to="0 ${-target * lh}" dur="${dur}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.12 0.9 0.25 1"/></g></g>`);
			x += dw;
			d += 1;
		});
		body.push(`<text x="${r1(mid)}" y="${base + 26}" fill="${t.muted}" font-size="11.5" text-anchor="middle">${esc(s.caption)}</text>`);
	});
	out.push(`</defs>`);
	return svg(W, H, 'Profile at a glance', stats.map((s) => `${s.label}: ${fmt(s.value)} (${s.caption})`).join('. '), [...out, ...body].join('\n'));
}

/** Isometric city: each section is a district, each repo a tower whose height is log stars. */
function city(repos, groups, t) {
	const th = rad(20);
	const st = Math.sin(th);
	const ct = Math.cos(th);
	const u = 15;
	const pitchX = 12;
	const pitchY = 17;
	const perRow = Math.ceil(groups.length / 2);
	const P = (x, y, z) => [(x * ct - y * st) * u, (x * st + y * ct) * 0.5 * u - z * u];
	const rank = new Map(repos.map((r, i) => [r.name, i]));

	const plates = [];
	const towers = [];
	groups.forEach((g, gi) => {
		const d = Math.ceil(Math.sqrt(g.items.length));
		const ox = (gi % perRow) * pitchX + (10 - d) / 2;
		const oy = Math.floor(gi / perRow) * pitchY + (10 - d) / 2;
		plates.push({ g, ox, oy, d });
		g.items.forEach((r, i) => {
			const x = ox + (i % d) + 0.15;
			const y = oy + Math.floor(i / d) + 0.15;
			const z = 0.35 + 1.3 * Math.log10(r.stargazerCount + 1);
			towers.push({ r, g, gi, i, x, y, z, w: 0.7 });
		});
	});
	towers.sort((a, b) => a.x * st + a.y * ct - (b.x * st + b.y * ct));

	const pts = [];
	const poly = (list) => {
		pts.push(...list);
		return list.map((p) => `${r1(p[0])},${r1(p[1])}`).join(' ');
	};
	// District labels sit under each plate's front-left corner and are drawn above the towers with a
	// surface halo, so a taller district in front can never bury them. Beacon tags steer around them.
	const placed = [];
	const districtLabels = [];
	const plateSvg = plates.map(({ g, ox, oy, d }) => {
		const m = 0.35;
		const corners = [P(ox - m, oy - m, 0), P(ox + d + m, oy - m, 0), P(ox + d + m, oy + d + m, 0), P(ox - m, oy + d + m, 0)];
		const lip = [P(ox - m, oy + d + m, 0), P(ox + d + m, oy + d + m, 0), P(ox + d + m, oy + d + m, -0.25), P(ox - m, oy + d + m, -0.25)];
		const [lx, ly] = P(ox - m, oy + d + m, -0.25);
		const name = shortTitle(g.title);
		const lw = (name.length + String(g.items.length).length + 1) * 7.2;
		pts.push([lx, ly + 22], [lx + lw, ly + 22]);
		placed.push({ x0: lx - 4, x1: lx + lw + 4, y0: ly + 4, y1: ly + 24 });
		districtLabels.push(`<text x="${r1(lx)}" y="${r1(ly + 18)}" fill="${t.text}" font-size="12.5" font-weight="600" stroke="${t.surface}" stroke-width="4" stroke-linejoin="round" paint-order="stroke">${esc(name)} <tspan fill="${t.sub}" font-weight="400">${g.items.length}</tspan></text>`);
		return `<polygon points="${poly(lip)}" fill="${t.grid}" fill-opacity="0.9"/><polygon points="${poly(corners)}" fill="${t.grid}" fill-opacity="0.45" stroke="${t.series[g.slot]}" stroke-opacity="0.5"/>`;
	});

	const beacons = [];
	const towerSvg = towers.map((tw) => {
		const { x, y, z, w } = tw;
		const c = t.series[tw.g.slot];
		const top = [P(x, y, z), P(x + w, y, z), P(x + w, y + w, z), P(x, y + w, z)];
		const front = [P(x, y + w, 0), P(x + w, y + w, 0), P(x + w, y + w, z), P(x, y + w, z)];
		const side = [P(x + w, y, 0), P(x + w, y + w, 0), P(x + w, y + w, z), P(x + w, y, z)];
		const delay = r2(0.15 + tw.gi * 0.1 + tw.i * 0.01);
		const ri = rank.get(tw.r.name);
		if (ri < 6) {
			const [bx, by] = P(x + w / 2, y + w / 2, z);
			beacons.push({ bx, by, r: tw.r, c, ri });
		}
		return `<g class="b" style="animation-delay:${delay}s"><polygon points="${poly(side)}" fill="${shade(c, -0.32)}"/><polygon points="${poly(front)}" fill="${c}"/><polygon points="${poly(top)}" fill="${shade(c, 0.3)}"/></g>`;
	});

	// Labels for the six most-starred towers, nudged upward until none overlap.
	beacons.sort((a, b) => a.by - b.by);
	const beaconSvg = beacons.map((b) => {
		const text = `${b.r.name} ★${short(b.r.stargazerCount)}`;
		const lw = text.length * 6.6 + 14;
		let ly = b.by - 26;
		const box = () => ({ x0: b.bx - lw / 2, x1: b.bx + lw / 2, y0: ly - 15, y1: ly + 5 });
		for (let guard = 0; guard < 40 && placed.some((p) => p.x0 < box().x1 && box().x0 < p.x1 && p.y0 < box().y1 && box().y0 < p.y1); guard++) ly -= 6;
		placed.push(box());
		pts.push([b.bx - lw / 2, ly - 18], [b.bx + lw / 2, ly]);
		return `<line x1="${r1(b.bx)}" y1="${r1(b.by - 3)}" x2="${r1(b.bx)}" y2="${r1(ly + 6)}" stroke="${t.sub}" stroke-opacity="0.7"/>
<circle cx="${r1(b.bx)}" cy="${r1(b.by)}" r="3" fill="${b.c}"><animate attributeName="r" values="3;9;3" dur="2.4s" begin="${r2(b.ri * 0.4)}s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.9;0;0.9" dur="2.4s" begin="${r2(b.ri * 0.4)}s" repeatCount="indefinite"/></circle>
<circle cx="${r1(b.bx)}" cy="${r1(b.by)}" r="2.5" fill="${b.c}" stroke="${t.surface}"/>
<rect x="${r1(b.bx - lw / 2)}" y="${r1(ly - 15)}" width="${r1(lw)}" height="21" rx="10.5" fill="${t.surface}" fill-opacity="0.92" stroke="${b.c}" stroke-opacity="0.8"/>
<text x="${r1(b.bx)}" y="${r1(ly)}" fill="${t.text}" font-size="11.5" font-weight="600" text-anchor="middle">${esc(b.r.name)} <tspan fill="${t.sub}" font-weight="400">★${short(b.r.stargazerCount)}</tspan></text>`;
	});

	const xs = pts.map((p) => p[0]);
	const ys = pts.map((p) => p[1]);
	const minX = Math.min(...xs);
	const minY = Math.min(...ys);
	const spanX = Math.max(...xs) - minX;
	const W = 900;
	const pad = 24;
	const head = 70;
	const scale = Math.min(1, (W - 2 * pad) / spanX);
	const H = Math.ceil(head + (Math.max(...ys) - minY) * scale + pad);
	const tx = r1((W - spanX * scale) / 2 - minX * scale);
	const ty = r1(head - minY * scale);
	const style = `.b{transform-box:fill-box;transform-origin:50% 100%;animation:rise 1.3s cubic-bezier(.2,.85,.25,1) both}@keyframes rise{from{transform:scaleY(0);opacity:0}to{transform:scaleY(1);opacity:1}}`;
	return svg(
		W,
		H,
		'Star city',
		`An isometric city with one tower per repository. Tower height is stars on a log scale, districts are the ${groups.length} catalog sections. Tallest: ${repos
			.slice(0, 6)
			.map((r) => `${r.name} (${r.stargazerCount} stars)`)
			.join(', ')}.`,
		`${heading(t, pad, 36, 'Star city', `${repos.length} towers, one per repository. Height is stars on a log scale; each district is a catalog section.`)}
<g transform="translate(${tx} ${ty}) scale(${r2(scale)})">
${plateSvg.join('\n')}
${towerSvg.join('\n')}
${districtLabels.join('\n')}
${beaconSvg.join('\n')}
</g>`,
		style,
	);
}

/** Extruded language donut that spins in 3D: stacked copies of one rotating ring make the wall. */
function languages(repos, t) {
	const counts = new Map();
	for (const r of repos) {
		const l = r.language || 'Docs and config';
		counts.set(l, (counts.get(l) || 0) + 1);
	}
	const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
	const keep = sorted.slice(0, 9);
	const rest = sorted.slice(9).reduce((n, [, c]) => n + c, 0);
	const slices = keep.map(([name, n]) => ({ name, n, color: LANG_COLORS[name] || (name === 'Docs and config' ? t.muted : shade(t.accent, 0.2)) }));
	if (rest) slices.push({ name: `${sorted.length - 9} more`, n: rest, color: shade(t.muted, -0.25) });
	const total = repos.length;
	const named = new Set(repos.map((r) => r.language).filter(Boolean)).size;

	const W = 900;
	const H = 380;
	const cx = 236;
	const cy = 196;
	const Ro = 158;
	const Ri = 86;
	const k = 0.4;
	const depth = 30;
	const step = 1.5;

	let a = -90;
	const sector = (a0, a1) => {
		const p = (rr, ang) => `${r1(rr * Math.cos(rad(ang)))} ${r1(rr * Math.sin(rad(ang)))}`;
		const large = a1 - a0 > 180 ? 1 : 0;
		return `M${p(Ro, a0)}A${Ro} ${Ro} 0 ${large} 1 ${p(Ro, a1)}L${p(Ri, a1)}A${Ri} ${Ri} 0 ${large} 0 ${p(Ri, a0)}Z`;
	};
	const tops = [];
	const walls = [];
	for (const s of slices) {
		const span = (360 * s.n) / total;
		const d = sector(a, a + span);
		tops.push(`<path d="${d}" fill="${s.color}" stroke="${t.surface}" stroke-width="2" vector-effect="non-scaling-stroke"/>`);
		walls.push(`<path d="${d}" fill="${shade(s.color, -0.42)}"/>`);
		a += span;
	}
	const layer = (id, dy) => `<g transform="translate(${cx} ${r1(cy + dy)}) scale(1 ${k})"><g><animateTransform attributeName="transform" type="rotate" from="0" to="360" dur="48s" repeatCount="indefinite"/><use href="#${id}"/></g></g>`;
	const stack = [];
	for (let dy = depth; dy > 0; dy -= step) stack.push(layer('lw', dy));
	stack.push(layer('lt', 0));

	const lx = 482;
	const lw = W - 24 - lx;
	const max = slices[0].n;
	const legend = slices.map((s, i) => {
		const y = 112 + i * 25;
		return `<rect x="${lx}" y="${y - 10}" width="11" height="11" rx="2.5" fill="${s.color}"/>
<text x="${lx + 20}" y="${y}" fill="${t.text}" font-size="13">${esc(s.name)}</text>
<rect x="${lx + 170}" y="${y - 7}" width="${r1(((lw - 250) * s.n) / max)}" height="6" rx="3" fill="${s.color}" fill-opacity="0.85"><animate attributeName="width" from="0" to="${r1(((lw - 250) * s.n) / max)}" dur="1.2s" begin="${r2(0.2 + i * 0.07)}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1"/></rect>
<text x="${lx + lw}" y="${y}" fill="${t.sub}" font-size="12.5" text-anchor="end"><tspan fill="${t.text}" font-weight="700">${s.n}</tspan>  ${r1((100 * s.n) / total)}%</text>`;
	});

	return svg(
		W,
		H,
		'Languages',
		`A spinning 3D donut of primary languages across ${total} repositories. ${slices.map((s) => `${s.name}: ${s.n}`).join('; ')}.`,
		`<defs><g id="lt">${tops.join('')}</g><g id="lw">${walls.join('')}</g></defs>
<ellipse cx="${cx}" cy="${cy + depth + 22}" rx="${Ro * 1.05}" ry="${r1(Ro * k * 0.6)}" fill="${t.text}" fill-opacity="0.06"/>
${stack.join('\n')}
<text x="${cx}" y="${cy + 4}" fill="${t.text}" font-size="30" font-weight="800" text-anchor="middle" stroke="${t.surface}" stroke-width="4" paint-order="stroke">${named}</text>
<text x="${cx}" y="${cy + 22}" fill="${t.sub}" font-size="11.5" text-anchor="middle" stroke="${t.surface}" stroke-width="3" paint-order="stroke">languages</text>
${heading(t, lx, 50, 'What it is written in', `Primary language of each of the ${total} repositories.`)}
${legend.join('\n')}`,
	);
}

/** Cumulative repos per section over time, drawn on from left to right. */
function growth(repos, groups, t) {
	const month = (d) => d.getUTCFullYear() * 12 + d.getUTCMonth();
	const dated = repos.filter((r) => r.createdAt).map((r) => ({ r, m: month(new Date(r.createdAt)) }));
	const sortedM = dated.map((d) => d.m).sort((a, b) => a - b);
	const now = month(new Date());
	const startM = Math.min(sortedM[Math.floor(sortedM.length * 0.03)] ?? now, now - 5);
	const months = Array.from({ length: now - startM + 1 }, (_, i) => startM + i);
	const slotOf = new Map();
	groups.forEach((g) => g.items.forEach((r) => slotOf.set(r.name, g)));
	const series = groups.map((g) => months.map((m) => dated.filter((d) => slotOf.get(d.r.name) === g && d.m <= m).length));
	const totals = months.map((_, i) => series.reduce((n, s) => n + s[i], 0));

	const W = 900;
	const H = 360;
	const x0 = 54;
	const x1 = 690;
	const y0 = 300;
	const y1 = 84;
	const maxV = Math.max(...totals);
	const tickStep = [10, 20, 25, 50, 100, 200, 250, 500].find((s) => maxV / s <= 5) || 1000;
	const top = Math.ceil(maxV / tickStep) * tickStep;
	const X = (i) => x0 + ((x1 - x0) * i) / Math.max(1, months.length - 1);
	const Y = (v) => y0 - ((y0 - y1) * v) / top;

	const grid = [];
	for (let v = 0; v <= top; v += tickStep) {
		grid.push(`<line x1="${x0}" y1="${r1(Y(v))}" x2="${x1}" y2="${r1(Y(v))}" stroke="${t.grid}" stroke-opacity="${v ? 0.6 : 1}"/><text x="${x0 - 8}" y="${r1(Y(v) + 4)}" fill="${t.muted}" font-size="11" text-anchor="end">${v}</text>`);
	}
	const label = (m) => `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m % 12]} ${String(Math.floor(m / 12)).slice(2)}`;
	const every = Math.max(1, Math.ceil(months.length / 8));
	months.forEach((m, i) => {
		if ((months.length - 1 - i) % every === 0) grid.push(`<text x="${r1(X(i))}" y="${y0 + 18}" fill="${t.muted}" font-size="11" text-anchor="middle">${label(m)}</text>`);
	});

	const base = months.map(() => 0);
	const areas = [];
	const ends = [];
	groups.forEach((g, gi) => {
		const lo = [...base];
		series[gi].forEach((v, i) => (base[i] += v));
		const upper = base.map((v, i) => `${r1(X(i))},${r1(Y(v))}`);
		const lower = lo.map((v, i) => `${r1(X(i))},${r1(Y(v))}`).reverse();
		areas.push(`<polygon points="${[...upper, ...lower].join(' ')}" fill="${t.series[g.slot]}" fill-opacity="0.88" stroke="${t.surface}" stroke-width="1.5" stroke-linejoin="round"/>`);
		const last = months.length - 1;
		ends.push({ g, y: (Y(lo[last]) + Y(base[last])) / 2, n: series[gi][last] });
	});
	// End labels in stack order, spread apart so none collide.
	ends.sort((p, q) => q.y - p.y);
	for (let i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < 17) ends[i].y = ends[i - 1].y - 17;
	const overflow = Math.min(0, ends[ends.length - 1].y - y1 + 6);
	const endSvg = ends.map((e, i) => {
		const ly = r1(e.y - overflow * ((ends.length - 1 - i) / (ends.length - 1 || 1)) - overflow * (i / (ends.length - 1 || 1)) + overflow);
		return `<line x1="${x1 + 4}" y1="${r1(e.y)}" x2="${x1 + 16}" y2="${ly}" stroke="${t.series[e.g.slot]}"/><text x="${x1 + 20}" y="${r1(ly + 4)}" fill="${t.text}" font-size="11.5">${esc(shortTitle(e.g.title))} <tspan fill="${t.sub}">${e.n}</tspan></text>`;
	});

	const lastTotal = totals[totals.length - 1];
	const thisYear = dated.filter((d) => d.m >= now - (now % 12)).length;
	return svg(
		W,
		H,
		'How the catalog grew',
		`Cumulative public repositories by section from ${label(startM)} to ${label(now)}, ending at ${lastTotal}.`,
		`${heading(t, 24, 36, 'How the catalog grew', `Cumulative repositories by creation month, stacked by section. ${thisYear} created so far in ${Math.floor(now / 12)}.`)}
<defs><clipPath id="draw"><rect x="${x0}" y="${y1 - 10}" width="${x1 - x0 + 2}" height="${y0 - y1 + 12}"><animate attributeName="width" from="0" to="${x1 - x0 + 2}" dur="2.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.3 0 0.2 1"/></rect></clipPath></defs>
${grid.join('\n')}
<g clip-path="url(#draw)">${areas.join('\n')}</g>
<circle cx="${x1}" cy="${r1(Y(lastTotal))}" r="4" fill="${t.text}"><animate attributeName="r" values="4;10;4" dur="2s" repeatCount="indefinite"/><animate attributeName="opacity" values="1;0.15;1" dur="2s" repeatCount="indefinite"/></circle>
<text x="${x1 - 8}" y="${r1(Y(lastTotal) - 10)}" fill="${t.text}" font-size="13" font-weight="700" text-anchor="end">${lastTotal}</text>
${endSvg.join('\n')}`,
	);
}

/** Lollipops on a log axis for the most-starred repositories. */
function topStars(repos, groups, t) {
	const slotOf = new Map();
	groups.forEach((g) => g.items.forEach((r) => slotOf.set(r.name, g.slot)));
	const rows = repos.slice(0, 12);
	const W = 900;
	const rowH = 27;
	const y0 = 96;
	const H = y0 + rows.length * rowH + 14;
	const x0 = 214;
	const x1 = 820;
	const maxExp = Math.ceil(Math.log10(Math.max(10, rows[0]?.stargazerCount || 10)));
	const X = (v) => x0 + ((x1 - x0) * Math.log10(Math.max(1, v))) / maxExp;
	const grid = [];
	for (let e = 0; e <= maxExp; e++) {
		const v = 10 ** e;
		grid.push(`<line x1="${r1(X(v))}" y1="${y0 - 14}" x2="${r1(X(v))}" y2="${H - 14}" stroke="${t.grid}" stroke-opacity="0.7"/><text x="${r1(X(v))}" y="${y0 - 20}" fill="${t.muted}" font-size="11" text-anchor="middle">${short(v)}</text>`);
	}
	const marks = rows.map((r, i) => {
		const y = y0 + i * rowH + 6;
		const c = t.series[slotOf.get(r.name) ?? 7];
		const xv = r1(X(r.stargazerCount));
		const begin = `${r2(0.2 + i * 0.07)}s`;
		const anim = (attr) => `<animate attributeName="${attr}" from="${x0}" to="${xv}" dur="1.3s" begin="${begin}" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1"/>`;
		return `<text x="${x0 - 14}" y="${y + 4}" fill="${t.text}" font-size="13" text-anchor="end">${esc(r.name)}</text>
<line x1="${x0}" y1="${y}" x2="${xv}" y2="${y}" stroke="${c}" stroke-width="2.5" stroke-linecap="round">${anim('x2')}</line>
<circle cx="${xv}" cy="${y}" r="6.5" fill="${c}" stroke="${t.surface}" stroke-width="2">${anim('cx')}</circle>
<text x="${xv + 12}" y="${y + 4}" fill="${t.sub}" font-size="12" font-weight="600">${fmt(r.stargazerCount)}<animate attributeName="x" from="${x0 + 12}" to="${xv + 12}" dur="1.3s" begin="${begin}" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines="0.16 1 0.3 1"/></text>`;
	});
	return svg(
		W,
		H,
		'Most-starred repositories',
		rows.map((r) => `${r.name}: ${r.stargazerCount} stars`).join('; '),
		`${heading(t, 24, 36, 'Most-starred', 'Stars per repository on a log scale, colored by section.')}
${grid.join('\n')}
${marks.join('\n')}`,
	);
}

/** Weekday by hour punchcard of when each repository was created (UTC). */
function punchcard(repos, t) {
	const cells = Array.from({ length: 7 }, () => Array(24).fill(0));
	for (const r of repos) {
		if (!r.createdAt) continue;
		const d = new Date(r.createdAt);
		cells[(d.getUTCDay() + 6) % 7][d.getUTCHours()] += 1;
	}
	const max = Math.max(1, ...cells.flat());
	const W = 900;
	const x0 = 74;
	const cw = (W - 24 - x0) / 24;
	const y0 = 96;
	const rh = 32;
	const H = y0 + 7 * rh + 18;
	const rmax = Math.min(cw, rh) / 2 - 1.5;
	const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
	let best = { v: -1 };
	const out = [];
	days.forEach((day, di) => {
		const y = y0 + di * rh;
		out.push(`<text x="${x0 - 14}" y="${y + 4}" fill="${t.sub}" font-size="12" text-anchor="end">${day}</text><line x1="${x0}" y1="${y}" x2="${W - 24}" y2="${y}" stroke="${t.grid}" stroke-opacity="0.5"/>`);
		cells[di].forEach((v, h) => {
			if (v > best.v) best = { v, di, h };
			if (!v) return;
			const rr = r1(Math.max(2, rmax * Math.sqrt(v / max)));
			out.push(`<circle class="p" style="animation-delay:${r2(0.1 + h * 0.03 + di * 0.05)}s" cx="${r1(x0 + cw * (h + 0.5))}" cy="${y}" r="${rr}" fill="${t.seq}" fill-opacity="${r2(0.35 + 0.65 * (v / max))}"/>`);
		});
	});
	for (let h = 0; h < 24; h += 3) out.push(`<text x="${r1(x0 + cw * (h + 0.5))}" y="${y0 - 22}" fill="${t.muted}" font-size="11" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>`);
	const style = `.p{transform-box:fill-box;transform-origin:center;animation:pop .7s cubic-bezier(.3,1.6,.5,1) both}@keyframes pop{from{transform:scale(0)}}`;
	const peak = `${days[best.di]} ${String(best.h).padStart(2, '0')}:00 UTC`;
	return svg(
		W,
		H,
		'When repositories are born',
		`Punchcard of repository creation by weekday and hour, UTC. Busiest slot: ${peak} with ${best.v}.`,
		`${heading(t, 24, 36, 'When repositories are born', `Creation time of every repository by weekday and hour (UTC). Busiest slot: ${peak}, ${best.v} repos.`)}
${out.join('\n')}`,
		style,
	);
}

/**
 * Render every visual for both themes.
 * `repos` is sorted by stars, descending; `groups` carry `slot`, the section's
 * index in the fixed category order, so colors never shift between runs.
 * Returns { 'name-dark.svg': svg, 'name-light.svg': svg, ... }.
 */
export function renderVisuals(repos, groups, { now = new Date() } = {}) {
	const year = now.getUTCFullYear();
	const stats = [
		{ label: 'Repositories', value: repos.length, caption: 'public and documented' },
		{ label: 'Stars', value: repos.reduce((n, r) => n + r.stargazerCount, 0), caption: 'across every repo' },
		{ label: 'Forks', value: repos.reduce((n, r) => n + (r.forkCount || 0), 0), caption: 'people building on it' },
		{ label: 'Topics', value: new Set(repos.flatMap((r) => r.topics || [])).size, caption: 'unique repo topics' },
		{ label: 'Languages', value: new Set(repos.map((r) => r.language).filter(Boolean)).size, caption: 'primary languages' },
		{ label: `New in ${year}`, value: repos.filter((r) => r.createdAt && new Date(r.createdAt).getUTCFullYear() === year).length, caption: 'repos created this year' },
	];
	const files = {};
	for (const [name, t] of Object.entries(THEMES)) {
		files[`stats-${name}.svg`] = odometer(stats, t);
		files[`planet-${name}.svg`] = planet(repos, groups, t);
		files[`top-stars-${name}.svg`] = topStars(repos, groups, t);
		files[`city-${name}.svg`] = city(repos, groups, t);
		files[`growth-${name}.svg`] = growth(repos, groups, t);
		files[`languages-${name}.svg`] = languages(repos, t);
		files[`punchcard-${name}.svg`] = punchcard(repos, t);
	}
	return files;
}
