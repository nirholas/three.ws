#!/usr/bin/env node
// One graphic per post of the Grok for Startups announcement thread, in the
// head card's look: near-black ground, Inter, thin white line art, our lockup.
// Post 1 uses head.png (scripts/grok-startups-announce-card.mjs) and post 4 the
// cutaway video (scripts/anatomy-cutaway-video.mjs); this script draws the rest.
//
//   node scripts/grok-startups-post-models.mjs   # once: real models via /api/mcp-grok
//   node scripts/grok-startups-post-cards.mjs    # post-2.png ... post-9.png
//
// Every figure on a card is real:
//   post 2  three models made through /api/mcp-grok (forge_free, refine_model
//           "make it chrome", forge_avatar), rendered here with three.js
//   post 3  the frames look_at_model returned for the prop, as returned
//   post 7  the usage window traced in docs/partners/xai-comarketing-kit.md
// The models and frames come from src/models.json; run the models script first.
//
// Output: public/x-media/grok-startups-announce/post-N.png, 1200x675 at 2x.

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium } from 'playwright';

const outDir = resolve('public/x-media/grok-startups-announce');
const srcDir = join(outDir, 'src');
const manifestPath = join(srcDir, 'models.json');
const models = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
// Posts 2 and 3 need the real models; without them those two cards are skipped.
const haveModels = ['prop', 'chrome', 'character', 'look'].every((k) => models[k]);
if (!haveModels) console.warn('src/models.json is incomplete: skipping posts 2 and 3 (run node scripts/grok-startups-post-models.mjs).');

const dataUrl = (path, type) => `data:${type};base64,${readFileSync(resolve(path)).toString('base64')}`;
const inter = dataUrl('public/fonts/inter-latin.woff2', 'font/woff2');
const mono = dataUrl('public/fonts/jetbrains-mono-latin.woff2', 'font/woff2');
const lockup = dataUrl('public/brand/three-ws-lockup-on-dark.png', 'image/png');
// Owner-approved partner marks, unaltered files from the SpaceXAI_Grok_Assets
// kit (docs/partners/xai-grok-startups-plan.md). The brand guidelines want each
// logo exactly as provided and nothing that reads as a combined mark, so the
// footer keeps them apart with clear space and a rule between each.
const grokMark = dataUrl('public/marks/grok-full-logomark-light.svg', 'image/svg+xml');
const spacexsiMark = dataUrl('public/marks/spacexai-symbol-white-transparent.svg', 'image/svg+xml');

// Usage window, 2026-10-08 to 2026-11-20 (co-marketing kit appendix).
const USAGE = {
	calls: '5,547',
	days: '44 of 44',
	errors: '2',
	renders: '426',
	weeks: [
		['Oct 5', 1125],
		['Oct 12', 180],
		['Oct 19', 362],
		['Oct 26', 1552],
		['Nov 2', 1381],
		['Nov 9', 473],
		['Nov 16', 474],
	],
};

// ---------------------------------------------------------------------------
// 3D renders: a local server hands three.js and the GLBs to a headless page.

const MIME = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
const RENDER_PAGE = `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;background:transparent}canvas{display:block}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

window.renderModel = async ({ url, size, yaw, pitch, skeleton }) => {
	const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
	renderer.setPixelRatio(1);
	renderer.setSize(size, size);
	renderer.setClearColor(0x000000, 0);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 1.05;
	document.body.replaceChildren(renderer.domElement);
	const scene = new THREE.Scene();
	scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(3, 5, 4);
	scene.add(key, new THREE.AmbientLight(0xffffff, 0.25));

	const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
	const gltf = await loader.loadAsync('/glb?u=' + encodeURIComponent(url));
	const root = gltf.scene;
	scene.add(root);
	root.updateMatrixWorld(true);
	const box = new THREE.Box3().setFromObject(root);
	const center = box.getCenter(new THREE.Vector3());
	const sphere = box.getBoundingSphere(new THREE.Sphere());
	root.position.sub(center);
	root.updateMatrixWorld(true);

	let bones = 0;
	if (skeleton) {
		root.traverse((o) => {
			if (o.isMesh) {
				o.material = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.85, metalness: 0, transparent: true, opacity: 0.92 });
			}
		});
		const helper = new THREE.SkeletonHelper(root);
		bones = helper.bones.length;
		helper.material.depthTest = false;
		helper.material.depthWrite = false;
		helper.material.vertexColors = false;
		helper.material.color = new THREE.Color(0xffffff);
		helper.material.linewidth = 2;
		helper.renderOrder = 10;
		scene.add(helper);
		// Joint dots, so the rig reads at thumbnail size.
		const dot = new THREE.Mesh(new THREE.SphereGeometry(sphere.radius * 0.012, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
		for (const b of helper.bones) {
			const d = dot.clone();
			b.getWorldPosition(d.position);
			d.renderOrder = 11;
			scene.add(d);
		}
	}

	const camera = new THREE.PerspectiveCamera(30, 1, sphere.radius / 100, sphere.radius * 100);
	const dist = sphere.radius / Math.sin(THREE.MathUtils.degToRad(15)) * 1.04;
	camera.position.set(Math.sin(yaw) * Math.cos(pitch) * dist, Math.sin(pitch) * dist, Math.cos(yaw) * Math.cos(pitch) * dist);
	camera.lookAt(0, 0, 0);
	renderer.render(scene, camera);
	return { png: renderer.domElement.toDataURL('image/png'), bones };
};
window.rendererReady = true;
</script>`;

function startServer() {
	const threeRoot = resolve('node_modules/three');
	if (!existsSync(join(threeRoot, 'build/three.module.js'))) throw new Error('three is not installed: run npm install.');
	const server = createServer(async (req, res) => {
		const url = new URL(req.url, 'http://local');
		try {
			if (url.pathname === '/') {
				res.writeHead(200, { 'content-type': 'text/html' });
				return res.end(RENDER_PAGE);
			}
			if (url.pathname === '/glb') {
				const upstream = await fetch(url.searchParams.get('u'));
				if (!upstream.ok) throw new Error(`GLB answered ${upstream.status}`);
				res.writeHead(200, { 'content-type': 'model/gltf-binary' });
				return res.end(Buffer.from(await upstream.arrayBuffer()));
			}
			if (url.pathname.startsWith('/three/')) {
				const file = resolve(threeRoot, `.${url.pathname.slice('/three'.length)}`);
				if (!file.startsWith(threeRoot) || !existsSync(file)) throw new Error(`not found: ${url.pathname}`);
				res.writeHead(200, { 'content-type': MIME[extname(file)] || 'application/octet-stream' });
				return res.end(readFileSync(file));
			}
			res.writeHead(404).end();
		} catch (err) {
			res.writeHead(502, { 'content-type': 'text/plain' }).end(err.message);
		}
	});
	return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server)));
}

async function renderModels(browser) {
	const server = await startServer();
	const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
	page.on('pageerror', (err) => console.error(`render page: ${err.message}`));
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	await page.waitForFunction(() => window.rendererReady === true, null, { timeout: 60_000 });
	const shot = (url, opts = {}) => page.evaluate((o) => window.renderModel(o), { url, size: 900, yaw: 0.62, pitch: 0.22, skeleton: false, ...opts });
	const out = {
		prop: await shot(models.prop.glb_url),
		chrome: await shot(models.chrome.glb_url),
		character: await shot((models.character_rig || models.character).glb_url, { skeleton: true, yaw: 0.35, pitch: 0.08 }),
	};
	await page.close();
	server.close();
	return out;
}

// ---------------------------------------------------------------------------
// Line art: an original (3,2) torus knot tube drawn as rings, the same
// technique as the head card's torus.

function torusKnot({ width, height, p = 3, q = 2, rings = 180, tube = 0.16, tilt = 0.5, turn = 0.3 }) {
	const curve = (t) => {
		const r = 1 + 0.42 * Math.cos(q * t);
		return [r * Math.cos(p * t), r * Math.sin(p * t), 0.42 * Math.sin(q * t)];
	};
	const scale = Math.min(width, height) / (2 * (1.42 + tube)) * 0.96;
	const project = ([x, y, z]) => {
		const y1 = y * Math.cos(tilt) - z * Math.sin(tilt);
		const z1 = y * Math.sin(tilt) + z * Math.cos(tilt);
		const x2 = x * Math.cos(turn) + z1 * Math.sin(turn);
		const z2 = -x * Math.sin(turn) + z1 * Math.cos(turn);
		return [width / 2 + x2 * scale, height / 2 + y1 * scale, z2];
	};
	const sub = (a, b) => a.map((v, i) => v - b[i]);
	const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
	const norm = (a) => {
		const l = Math.hypot(...a) || 1;
		return a.map((v) => v / l);
	};
	const paths = [];
	for (let i = 0; i < rings; i++) {
		const t = (i / rings) * Math.PI * 2;
		const c = curve(t);
		const tangent = norm(sub(curve(t + 1e-3), c));
		const n = norm(cross(tangent, [0, 0, 1]));
		const b = norm(cross(tangent, n));
		let d = '';
		let depth = 0;
		const steps = 40;
		for (let j = 0; j <= steps; j++) {
			const v = (j / steps) * Math.PI * 2;
			const pt = c.map((ci, k) => ci + tube * (Math.cos(v) * n[k] + Math.sin(v) * b[k]));
			const [px, py, pz] = project(pt);
			d += `${j ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)}`;
			depth += pz;
		}
		const near = (depth / (steps + 1) + 1.6) / 3.2;
		paths.push(`<path d="${d}Z" stroke-opacity="${(0.06 + near * 0.4).toFixed(3)}"/>`);
	}
	return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" fill="none" stroke="#fff" stroke-width="1">${paths.join('')}</svg>`;
}

// ---------------------------------------------------------------------------
// Cards

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const BASE = `
	@font-face { font-family: 'Inter'; font-weight: 100 900; src: url('${inter}') format('woff2'); }
	@font-face { font-family: 'JBMono'; font-weight: 100 800; src: url('${mono}') format('woff2'); }
	* { box-sizing: border-box; }
	body { margin: 0; width: 1200px; height: 675px; overflow: hidden; position: relative; background: #050507; color: #fff; font-family: 'Inter', sans-serif; -webkit-font-smoothing: antialiased; }
	.marks { position: absolute; left: 72px; bottom: 52px; display: flex; align-items: center; }
	.marks img { display: block; width: auto; }
	.marks .ours { height: 34px; }
	.marks .grok { height: 37px; }
	.marks .sxsi { height: 21px; }
	.marks i { width: 1px; height: 26px; background: rgba(255,255,255,0.22); margin: 0 26px; }
	.count { position: absolute; right: 72px; bottom: 64px; font: 500 13px/1 'JBMono', monospace; letter-spacing: 0.18em; color: #5d5d66; }
	.head { position: absolute; left: 72px; top: 64px; right: 72px; }
	h1 { margin: 0; font-weight: 600; font-size: 54px; line-height: 1.04; letter-spacing: -0.035em; }
	.sub { margin-top: 16px; font-size: 22px; line-height: 1.35; color: #8e8e98; letter-spacing: -0.01em; max-width: 760px; }
	.label { font: 500 12.5px/1.2 'JBMono', monospace; letter-spacing: 0.16em; text-transform: uppercase; color: #9a9aa4; }
	.cap { font: 400 13px/1.4 'JBMono', monospace; color: #5f5f69; }
	.rule { height: 1px; background: rgba(255,255,255,0.12); }
`;
const frame = (n, body, css = '') => `<!doctype html><meta charset="utf-8"><style>${BASE}${css}</style>${body}<div class="marks"><img class="ours" src="${lockup}" alt="three.ws"><i></i><img class="grok" src="${grokMark}" alt="Grok"><i></i><img class="sxsi" src="${spacexsiMark}" alt="SpaceXSI"></div><div class="count">${String(n).padStart(2, '0')} / 09</div>`;

function cards(renders) {
	const look = models.look || { frames: [], views: [] };
	const lookFrames = look.frames.map((f, i) => ({ src: dataUrl(join(srcDir, f), 'image/png'), view: (look.views[i] || '').replace('-', ' ') }));
	const geo = look.geometry || {};
	const geoLine = [geo.triangles != null && `${Number(geo.triangles).toLocaleString('en-US')} triangles`, geo.materials != null && `${geo.materials} material${geo.materials === 1 ? '' : 's'}`, geo.textures != null && `${geo.textures} texture${geo.textures === 1 ? '' : 's'}`].filter(Boolean).join(' · ');
	const maxWeek = Math.max(...USAGE.weeks.map((w) => w[1]));

	const modelCards = !renders ? {} : {
		'post-2.png': frame(
			2,
			`<div class="head"><h1>Ask Grok for a 3D model.</h1><div class="sub">A real textured GLB. Rigged when it is a character. Edited when you ask.</div></div>
			<div class="row">
				${[
					['Textured GLB', renders.prop.png, `"${models.prop.prompt.split(' with ')[0]}"`],
					['"Make it chrome"', renders.chrome.png, 'one sentence later, a new version'],
					['Rigged character', renders.character.png, `${renders.character.bones} bones, ready to animate`],
				]
					.map(([label, png, cap], i) => `<figure><div class="tile"><img class="${i === 2 ? 'tall' : ''}" src="${png}"></div><div class="label">${esc(label)}</div><div class="cap">${esc(cap)}</div></figure>`)
					.join('')}
			</div>`,
			`.row { position: absolute; left: 72px; right: 72px; top: 214px; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 24px; }
			figure { margin: 0; }
			.tile { height: 262px; border: 1px solid rgba(255,255,255,0.1); border-radius: 14px; background: radial-gradient(ellipse at 50% 40%, #15161b 0%, #09090c 75%); display: flex; align-items: center; justify-content: center; overflow: hidden; }
			.tile img { height: 112%; width: auto; }
			.tile img.tall { height: 94%; }
			.label { margin-top: 16px; color: #e8e8ee; }
			.cap { margin-top: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }`,
		),

		'post-3.png': frame(
			3,
			`<div class="head"><h1>Grok checks its own work.</h1><div class="sub">Before it answers, it renders the model from every side and looks.</div></div>
			<div class="row">${lookFrames.map((f) => `<figure><div class="tile"><img src="${f.src}"></div><div class="label">${esc(f.view)}</div></figure>`).join('')}</div>
			<div class="stat"><span class="big">${USAGE.renders}</span><span class="label">render checks so far</span>${geoLine ? `<span class="cap">${esc(geoLine)}</span>` : ''}</div>`,
			`.row { position: absolute; left: 72px; right: 72px; top: 200px; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 18px; }
			figure { margin: 0; }
			.tile { height: 236px; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; overflow: hidden; background: #0b0b0e; }
			.tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
			.row .label { margin-top: 12px; }
			.stat { position: absolute; left: 72px; right: 72px; top: 506px; display: flex; align-items: baseline; gap: 14px; }
			.stat .big { font-size: 40px; font-weight: 600; letter-spacing: -0.03em; }
			.stat .cap { margin-left: auto; }`,
		),

	};
	return {
		...modelCards,
		'post-5.png': frame(
			5,
			`<div class="head"><h1>One URL.<br>Every place you use Grok.</h1></div>
			<svg class="wires" width="1200" height="675" viewBox="0 0 1200 675" fill="none" stroke="rgba(255,255,255,0.32)" stroke-width="1.2">
				${[0, 1, 2, 3, 4].map((i) => `<path d="M552 ${430} C 640 430, 640 ${262 + i * 66}, 720 ${262 + i * 66}"/>`).join('')}
			</svg>
			<div class="hub"><div class="label">Remote MCP server</div><div class="url">three.ws/api/mcp-grok</div></div>
			<div class="targets">${[
				['grok.com', 'custom connector'],
				['Grok Bot', 'connector'],
				['Grok Build', 'plugin'],
				['Cursor', 'MCP server'],
				['xAI API', 'remote MCP tool'],
			]
				.map(([name, how]) => `<div class="t"><span class="dot"></span><span class="name">${name}</span><span class="cap">${how}</span></div>`)
				.join('')}</div>
			<div class="foot cap">Free account. No tool that can spend money.</div>`,
			`.hub { position: absolute; left: 72px; top: 386px; width: 480px; height: 88px; border: 1px solid rgba(255,255,255,0.22); border-radius: 14px; padding: 18px 22px; background: #0b0b0e; }
			.hub .url { margin-top: 10px; font: 500 24px/1 'JBMono', monospace; letter-spacing: -0.01em; }
			.wires { position: absolute; inset: 0; }
			.targets { position: absolute; left: 720px; top: 244px; }
			.t { height: 66px; display: flex; align-items: center; gap: 16px; }
			.t .dot { width: 9px; height: 9px; border-radius: 50%; background: #fff; margin-left: -4px; }
			.t .name { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; width: 170px; }
			.foot { position: absolute; left: 72px; top: 494px; font-size: 14px; color: #7a7a84; }`,
		),

		'post-6.png': frame(
			6,
			`<div class="head"><h1>Six runnable examples.</h1><div class="sub">For builders on the Grok API.</div></div>
			<div class="list">${[
				['grok-curl', 'bash, curl', 'remote MCP call, job poll, render'],
				['grok-node-responses', 'Node', 'the Responses API, then a PNG'],
				['grok-python-mcp', 'Python', 'search the catalog, make if none fits'],
				['grok-remote-mcp', 'Node', 'zero dependencies'],
				['grok-agent-avatar', 'Node', 'a 3D avatar with Grok as its brain'],
				['grok-x-search-to-3d', 'Node', 'X search to a 3D prop'],
			]
				.map(([name, stack, what]) => `<div class="li"><span class="name">${name}</span><span class="stack label">${stack}</span><span class="cap">${what}</span></div>`)
				.join('')}</div>
			<div class="term"><span class="p">$</span> npm run grok:examples-smoke<br><span class="ok">all 6 example(s) passed</span></div>`,
			`.list { position: absolute; left: 72px; right: 72px; top: 214px; border-top: 1px solid rgba(255,255,255,0.12); }
			.li { height: 50px; display: grid; grid-template-columns: 360px 150px 1fr; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.08); }
			.li .name { font: 500 19px/1 'JBMono', monospace; color: #f1f1f5; }
			.li .cap { font-size: 14px; color: #7d7d87; }
			.term { position: absolute; right: 72px; top: 76px; font: 400 15px/1.7 'JBMono', monospace; color: #c9c9d1; text-align: left; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 14px 20px; background: #0b0b0e; }
			.term .p { color: #5f5f69; }
			.term .ok { color: #8fe3b0; }`,
		),

		'post-7.png': frame(
			7,
			`<div class="head"><div class="label">Grok connector, before acceptance, Oct 8 to Nov 20, 2026</div></div>
			<div class="stats">
				<div><div class="big">${USAGE.calls}</div><div class="label">tool calls</div></div>
				<div><div class="big">${USAGE.days}</div><div class="label">days with traffic</div></div>
				<div><div class="big">${USAGE.errors}</div><div class="label">errors</div></div>
			</div>
			<div class="chart">${USAGE.weeks
				.map(([wk, n]) => `<div class="col"><div class="n cap">${n.toLocaleString('en-US')}</div><div class="bar" style="height:${Math.round((n / maxWeek) * 150)}px"></div><div class="wk cap">${wk}</div></div>`)
				.join('')}</div>
			<div class="chartlabel label">Tool calls per week</div>`,
			`.head { top: 72px; }
			.stats { position: absolute; left: 72px; right: 72px; top: 118px; display: flex; justify-content: space-between; }
			.big { font-size: 92px; font-weight: 600; letter-spacing: -0.05em; line-height: 1; white-space: nowrap; }
			.stats .label { margin-top: 14px; }
			.chart { position: absolute; left: 72px; right: 72px; top: 330px; height: 210px; display: flex; align-items: flex-end; gap: 22px; }
			.col { flex: 1; display: flex; flex-direction: column; align-items: stretch; }
			.bar { background: #fff; opacity: 0.88; border-radius: 3px 3px 0 0; }
			.n { text-align: center; margin-bottom: 8px; }
			.wk { text-align: center; margin-top: 10px; border-top: 1px solid rgba(255,255,255,0.14); padding-top: 8px; }
			.chartlabel { position: absolute; right: 72px; top: 300px; color: #5d5d66; }`,
		),

		'post-8.png': frame(
			8,
			`<div class="figure">${torusKnot({ width: 640, height: 600, rings: 200, tilt: 0.95, turn: 0.2 })}</div>
			<div class="left"><div class="mega">No VC.</div><div class="lines"><div>Funded by our community.</div><div class="dim">Approved for xAI's Grok<br>for Startups program.</div></div></div>`,
			`.figure { position: absolute; right: -120px; top: 46%; transform: translateY(-50%); opacity: 0.9; }
			.left { position: absolute; left: 72px; top: 0; bottom: 0; display: flex; flex-direction: column; justify-content: center; gap: 28px; }
			.mega { font-size: 148px; font-weight: 700; letter-spacing: -0.06em; line-height: 0.9; }
			.lines { font-size: 30px; line-height: 1.35; letter-spacing: -0.02em; font-weight: 500; }
			.dim { color: #8e8e98; font-weight: 400; }`,
		),

		'post-9.png': frame(
			9,
			`<div class="figure">${torusKnot({ width: 620, height: 620, p: 2, q: 3, rings: 220, tube: 0.2, tilt: 0.7, turn: 0.45 })}</div>
			<div class="left"><h1>Ask Grok for<br>anything in 3D.</h1><div class="sub">A character for your game. A prop for your scene. A product for your store. A machine you want to understand.</div><div class="url">three.ws/grok</div></div>`,
			`.figure { position: absolute; right: -10px; top: 50%; transform: translateY(-50%); }
			.left { position: absolute; left: 72px; top: 0; bottom: 0; width: 600px; display: flex; flex-direction: column; justify-content: center; }
			h1 { font-size: 68px; }
			.sub { margin-top: 22px; max-width: 520px; }
			.url { margin-top: 34px; font: 500 22px/1 'JBMono', monospace; color: #fff; border: 1px solid rgba(255,255,255,0.22); border-radius: 999px; padding: 14px 22px; align-self: flex-start; }`,
		),
	};
}

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
try {
	const renders = haveModels ? await renderModels(browser) : null;
	const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1].split(',') : null;
	for (const [name, html] of Object.entries(cards(renders))) {
		if (only && !only.some((o) => name.includes(o))) continue;
		const page = await browser.newPage({ viewport: { width: 1200, height: 675 }, deviceScaleFactor: 2 });
		await page.setContent(html, { waitUntil: 'load' });
		await page.evaluate(async () => {
			await document.fonts.ready;
			await Promise.all([...document.images].map((img) => img.decode()));
			if (!document.fonts.check("600 54px 'Inter'")) throw new Error('Inter did not load');
		});
		const out = join(outDir, name);
		await page.screenshot({ path: out });
		await page.close();
		console.log(`card: ${out}`);
	}
} finally {
	await browser.close();
}
