// Shared look for the Grok for Startups X cards: near-black ground, Inter and
// JetBrains Mono, thin white line art, and the footer marks (our lockup, the
// Grok logomark, the SpaceXSI symbol) kept apart with clear space and a rule.
// Used by scripts/grok-startups-post-cards.mjs (the 2026-11-25 thread) and
// scripts/grok-startups-repost-cards.mjs (the 2026-11-27 repost).

import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

export const dataUrl = (path, type) => `data:${type};base64,${readFileSync(resolve(path)).toString('base64')}`;

const inter = dataUrl('public/fonts/inter-latin.woff2', 'font/woff2');
const mono = dataUrl('public/fonts/jetbrains-mono-latin.woff2', 'font/woff2');
const lockup = dataUrl('public/brand/three-ws-lockup-on-dark.png', 'image/png');
// Owner-approved partner marks, unaltered files from the SpaceXAI_Grok_Assets
// kit (docs/partners/xai-grok-startups-plan.md). The brand guidelines want each
// logo exactly as provided and nothing that reads as a combined mark.
const grokMark = dataUrl('public/marks/grok-full-logomark-light.svg', 'image/svg+xml');
const spacexsiMark = dataUrl('public/marks/spacexai-symbol-white-transparent.svg', 'image/svg+xml');

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export const BASE = `
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

/** One card: body markup plus the shared footer and an "NN / TT" counter (none when n is null, for an image outside a thread). */
export const frame = (n, total, body, css = '') =>
	`<!doctype html><meta charset="utf-8"><style>${BASE}${css}</style>${body}<div class="marks"><img class="ours" src="${lockup}" alt="three.ws"><i></i><img class="grok" src="${grokMark}" alt="Grok"><i></i><img class="sxsi" src="${spacexsiMark}" alt="SpaceXSI"></div>${n == null ? '' : `<div class="count">${String(n).padStart(2, '0')} / ${String(total).padStart(2, '0')}</div>`}`;

// ---------------------------------------------------------------------------
// Line art: an original torus knot tube drawn as rings, the same technique as
// the head card's torus.

export function torusKnot({ width, height, p = 3, q = 2, rings = 180, tube = 0.16, tilt = 0.5, turn = 0.3 }) {
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
	const out = { png: renderer.domElement.toDataURL('image/png'), bones };
	renderer.dispose();
	return out;
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

/**
 * Opens a headless render page and returns `shot(url, opts)`, which renders one
 * GLB to a transparent PNG data URL (900 px square by default), and `close()`.
 */
export async function openRenderer(browser) {
	const server = await startServer();
	const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
	page.on('pageerror', (err) => console.error(`render page: ${err.message}`));
	await page.goto(`http://127.0.0.1:${server.address().port}/`);
	await page.waitForFunction(() => window.rendererReady === true, null, { timeout: 60_000 });
	return {
		shot: (url, opts = {}) => page.evaluate((o) => window.renderModel(o), { url, size: 900, yaw: 0.62, pitch: 0.22, skeleton: false, ...opts }),
		close: async () => {
			await page.close();
			server.close();
		},
	};
}

export const launchBrowser = async () => {
	const { chromium } = await import('playwright');
	return chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
};

/** Screenshot each { name: html } card to outDir at 1200x675, 2x. `only` filters by substring. */
export async function shootCards(browser, outDir, cards, only = null) {
	for (const [name, html] of Object.entries(cards)) {
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
}
