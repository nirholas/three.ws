// "View in your room" hand-off rules (order 142): the links every AR surface
// builds, the device detection behind the designed notices, and the USDZ the
// iPhone path produces on the device.
//
// The Scene Viewer and launch-plan cases pin two production bugs:
//   1. /api/ar answered Android with a 302 straight to an intent:// URL. Chrome
//      refuses intents reached by redirect from a typed URL or without a user
//      gesture, and a scanned QR code is a typed URL, so every Android phone
//      that scanned the desktop QR landed on the 2D fallback instead of AR.
//   2. The intent asked for mode=ar_preferred through package com.google.ar.core.
//      Google documents ar_preferred with the Google app package
//      (com.google.android.googlequicksearchbox), which falls back to the 3D
//      viewer when ARCore is missing; com.google.ar.core is the ar_only package
//      and is absent on phones without Play Services for AR.

import { describe, it, expect, beforeAll } from 'vitest';
import {
	Scene,
	Mesh,
	BoxGeometry,
	MeshStandardMaterial,
} from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { unzipSync, strFromU8 } from 'three/addons/libs/fflate.module.js';

import {
	detectArDevice,
	resolveArSource,
	arViewUrl,
	arWeight,
	arPlacementScale,
	formatDimensions,
	arNotice,
	SCENE_VIEWER_MAX_BYTES,
	AR_RECOMMENDED_BYTES,
} from '../src/ar-links.js';
import { buildSceneViewerUrl, planArLaunch } from '../api/_lib/ar-launch.js';
import { glbBlobToUsdzBlob } from '../src/usdz-pipeline.js';
import { validateUsdz } from '../src/usdz-validate.js';

const UA = {
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	oldIphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 11_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/11.0 Mobile/15E148 Safari/604.1',
	ipadOs:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
	pixel:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
	instagramIos:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 329.0.0.0.0 (iPhone15,2; iOS 17_4; en_US; en; scale=3.00; 1179x2556; 600000000)',
	facebookAndroid:
		'Mozilla/5.0 (Linux; Android 13; SM-S911B Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/460.0.0.0;]',
	plainWebView:
		'Mozilla/5.0 (Linux; Android 12; moto g; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36',
	googleAppIos:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/312.0.623039286 Mobile/15E148 Safari/604.1',
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

const GLB = 'https://three.ws/cdn/forge/ca86288c9687/2b4ad514-b161-4ece-b764-32688c284184.glb';

describe('Scene Viewer intent (Android)', () => {
	it('opens ar_preferred through the Google app, which falls back to 3D when ARCore is missing', () => {
		const url = buildSceneViewerUrl(GLB, { title: 'Lamp', fallbackUrl: 'https://three.ws/ar/view?src=x' });
		expect(url.startsWith('intent://arvr.google.com/scene-viewer/1.2?')).toBe(true);
		expect(url).toContain('mode=ar_preferred');
		expect(url).toContain('package=com.google.android.googlequicksearchbox;');
		expect(url).not.toContain('package=com.google.ar.core');
		expect(url).toContain(`file=${encodeURIComponent(GLB)}`);
		expect(url).toContain('scheme=https;');
		expect(url).toContain('action=android.intent.action.VIEW;');
		expect(url).toContain(`S.browser_fallback_url=${encodeURIComponent('https://three.ws/ar/view?src=x')};`);
		expect(url.endsWith('end;')).toBe(true);
	});
});

describe('planArLaunch: a scanned or pasted /api/ar link', () => {
	it('lands Android on the tap-to-launch /ar/view page, never a blocked intent redirect', () => {
		const plan = planArLaunch({ glbUrl: GLB, userAgent: UA.pixel, origin: 'https://three.ws', title: 'Lamp' });
		expect(plan.target).toBe('android');
		expect(plan.url.startsWith('https://three.ws/ar/view?')).toBe(true);
		expect(plan.url).not.toMatch(/^intent:/);
		expect(new URL(plan.url).searchParams.get('src')).toBe(GLB);
		// The raw intent is still handed to callers (export_ar) that want it.
		expect(plan.sceneViewerUrl).toContain('package=com.google.android.googlequicksearchbox;');
	});

	it('lands iPhone and desktop on the same page', () => {
		for (const ua of [UA.iphone, UA.macChrome]) {
			const plan = planArLaunch({ glbUrl: GLB, userAgent: ua, origin: 'https://three.ws' });
			expect(plan.url.startsWith('https://three.ws/ar/view?')).toBe(true);
		}
	});
});

describe('detectArDevice', () => {
	it('classifies iPhone with its iOS major version', () => {
		expect(detectArDevice({ userAgent: UA.iphone, maxTouchPoints: 5 })).toEqual({
			os: 'ios',
			inApp: null,
			iosMajor: 17,
			androidMajor: null,
		});
	});

	it('treats a Mac UA with a touch screen as iPadOS, and without one as desktop', () => {
		expect(detectArDevice({ userAgent: UA.ipadOs, maxTouchPoints: 5 }).os).toBe('ios');
		expect(detectArDevice({ userAgent: UA.ipadOs, maxTouchPoints: 0 }).os).toBe('desktop');
	});

	it('classifies Android Chrome as a real browser', () => {
		expect(detectArDevice({ userAgent: UA.pixel, maxTouchPoints: 5 })).toEqual({
			os: 'android',
			inApp: null,
			iosMajor: null,
			androidMajor: 14,
		});
	});

	it('names the in-app browser so the notice can tell people where to go', () => {
		expect(detectArDevice({ userAgent: UA.instagramIos }).inApp).toBe('Instagram');
		expect(detectArDevice({ userAgent: UA.facebookAndroid }).inApp).toBe('Facebook');
		expect(detectArDevice({ userAgent: UA.plainWebView }).inApp).toBe('Android WebView');
		expect(detectArDevice({ userAgent: UA.googleAppIos }).inApp).toBe('Google app');
		expect(detectArDevice({ userAgent: UA.iphone }).inApp).toBeNull();
	});

	it('reads an old iPhone as iOS 11', () => {
		expect(detectArDevice({ userAgent: UA.oldIphone }).iosMajor).toBe(11);
	});
});

describe('resolveArSource: what the phone is asked to load', () => {
	it('skips a browser-only blob: Download link and uses the public model behind it', () => {
		expect(resolveArSource(['blob:https://three.ws/1f0e', GLB])).toEqual({ url: GLB, reason: 'ok' });
	});

	it('reports a model that only exists in this tab instead of encoding a dead QR', () => {
		expect(resolveArSource(['blob:https://three.ws/1f0e', null])).toEqual({ url: null, reason: 'local' });
		expect(resolveArSource(['data:model/gltf-binary;base64,AAAA'])).toEqual({ url: null, reason: 'local' });
	});

	it('swaps the meshopt display copy for the full .glb Scene Viewer can decode', () => {
		const web = GLB.replace(/\.glb$/, '.web.glb');
		expect(resolveArSource([web]).url).toBe(GLB);
	});

	it('makes a same-site relative path absolute and refuses http or non-GLB targets', () => {
		expect(resolveArSource(['/cdn/forge/anon/a.glb']).url).toBe('https://three.ws/cdn/forge/anon/a.glb');
		expect(resolveArSource(['http://example.com/a.glb']).reason).toBe('unsupported');
		expect(resolveArSource(['https://three.ws/forge']).reason).toBe('unsupported');
		expect(resolveArSource([]).reason).toBe('missing');
	});
});

describe('arViewUrl', () => {
	it('builds the one landing page every QR and share link points at', () => {
		const url = arViewUrl(GLB, { title: 'Brass lamp' });
		expect(url).toBe(`https://three.ws/ar/view?src=${encodeURIComponent(GLB)}&title=Brass+lamp`);
	});

	it('omits an empty title and caps a long one to keep the QR scannable', () => {
		expect(arViewUrl(GLB)).toBe(`https://three.ws/ar/view?src=${encodeURIComponent(GLB)}`);
		const long = new URL(arViewUrl(GLB, { title: 'x'.repeat(300) }));
		expect(long.searchParams.get('title')).toHaveLength(80);
	});
});

describe('arWeight', () => {
	it('grades a model against Scene Viewer limits', () => {
		expect(arWeight(4.8 * 1024 * 1024)).toBe('ok');
		expect(arWeight(AR_RECOMMENDED_BYTES)).toBe('ok');
		expect(arWeight(AR_RECOMMENDED_BYTES + 1)).toBe('heavy');
		expect(arWeight(SCENE_VIEWER_MAX_BYTES + 1)).toBe('over');
		expect(arWeight(null)).toBe('unknown');
		expect(arWeight(0)).toBe('unknown');
	});
});

describe('arPlacementScale: the size a model first appears at', () => {
	it('keeps a room-sized model at its authored metres (Forge lanes are about 1 m)', () => {
		expect(arPlacementScale({ x: 0.99, y: 0.62, z: 0.48 })).toBe(1);
		expect(arPlacementScale({ x: 0.3, y: 1.8, z: 0.4 })).toBe(1);
	});

	it('brings a wrong-unit model to a 1 m longest side', () => {
		expect(arPlacementScale({ x: 0.002, y: 0.001, z: 0.001 })).toBeCloseTo(500, 6);
		expect(arPlacementScale({ x: 40, y: 10, z: 20 })).toBeCloseTo(0.025, 6);
	});

	it('leaves an empty box alone', () => {
		expect(arPlacementScale({ x: 0, y: 0, z: 0 })).toBe(1);
	});

	it('formats the placed size for the page', () => {
		expect(formatDimensions({ x: 0.99, y: 0.62, z: 0.48 })).toBe('0.99 × 0.62 × 0.48 m');
		expect(formatDimensions({ x: 40, y: 10, z: 20 }, 0.025)).toBe('1.0 × 0.25 × 0.50 m');
	});
});

describe('arNotice: the designed message for each unsupported case', () => {
	const dev = (ua, touch = 5) => detectArDevice({ userAgent: ua, maxTouchPoints: touch });

	it('tells an in-app browser user which real browser to open', () => {
		const ig = arNotice(dev(UA.instagramIos), { canActivateAR: false });
		expect(ig.kind).toBe('in-app');
		expect(ig.body).toContain('Safari');
		expect(arNotice(dev(UA.facebookAndroid)).body).toContain('Chrome');
	});

	it('tells an old iPhone why and what still works', () => {
		expect(arNotice(dev(UA.oldIphone)).kind).toBe('old-ios');
	});

	it('explains a phone without AR support', () => {
		expect(arNotice(dev(UA.pixel), { canActivateAR: false }).kind).toBe('no-ar');
	});

	it('warns Android about a model over the Scene Viewer limit', () => {
		const n = arNotice(dev(UA.pixel), { canActivateAR: true, weight: 'over' });
		expect(n.kind).toBe('heavy');
		expect(n.body).toContain('15 MB');
	});

	it('points desktop at the QR code', () => {
		expect(arNotice(dev(UA.macChrome, 0)).kind).toBe('desktop');
	});

	it('stays quiet when the phone can just launch', () => {
		expect(arNotice(dev(UA.iphone), { canActivateAR: true, weight: 'ok' })).toBeNull();
		expect(arNotice(dev(UA.pixel), { canActivateAR: null, weight: 'unknown' })).toBeNull();
	});
});

// GLTFExporter's binary writer reaches for the browser FileReader; shim it over
// Node's Blob (same shim as tests/usdz-animated.test.js).
beforeAll(() => {
	if (typeof globalThis.FileReader === 'undefined') {
		globalThis.FileReader = class {
			readAsArrayBuffer(blob) {
				blob.arrayBuffer().then((b) => {
					this.result = b;
					this.onloadend?.();
				});
			}
			readAsDataURL(blob) {
				blob.arrayBuffer().then((b) => {
					this.result = `data:${blob.type || ''};base64,${Buffer.from(b).toString('base64')}`;
					this.onloadend?.();
				});
			}
		};
	}
});

// A box shaped like a Forge lane output: centered on the origin, longest side
// 1 m, so half of it sits below y = 0 until it is grounded.
async function centeredBoxGlb({ w = 1, h = 0.6, d = 0.5 } = {}) {
	const scene = new Scene();
	scene.add(new Mesh(new BoxGeometry(w, h, d), new MeshStandardMaterial({ color: 0x8844ff })));
	const buffer = await new Promise((resolve, reject) =>
		new GLTFExporter().parse(scene, resolve, reject, { binary: true }),
	);
	return new Blob([buffer], { type: 'model/gltf-binary' });
}

function pointsBounds(usdaText) {
	const m = usdaText.match(/point3f\[\] points = \[([^\]]+)\]/);
	if (!m) throw new Error('no points in geometry');
	const nums = [...m[1].matchAll(/\(([^)]+)\)/g)].map((t) => t[1].split(',').map(Number));
	const min = [Infinity, Infinity, Infinity];
	const max = [-Infinity, -Infinity, -Infinity];
	for (const p of nums) {
		for (let i = 0; i < 3; i++) {
			min[i] = Math.min(min[i], p[i]);
			max[i] = Math.max(max[i], p[i]);
		}
	}
	return { min, max };
}

// Apply the composed xform ops of every Xform above the mesh to its points:
// enough for the translate + uniform scale the AR grounding writes.
function worldBounds(files) {
	const model = strFromU8(files['model.usda']);
	const geomName = Object.keys(files).find((f) => f.startsWith('geometries/'));
	const local = pointsBounds(strFromU8(files[geomName]));
	const mats = [...model.matchAll(/matrix4d xformOp:transform = \(([^\n]+)\)\n/g)].map((m) =>
		[...m[1].matchAll(/\(([^)]+)\)/g)].map((r) => r[1].split(',').map(Number)),
	);
	const apply = (p) => {
		let v = [...p];
		for (const rows of mats.reverse()) {
			// USD row-vector convention: v' = v * M.
			v = [0, 1, 2].map((c) => v[0] * rows[0][c] + v[1] * rows[1][c] + v[2] * rows[2][c] + rows[3][c]);
		}
		return v;
	};
	const a = apply(local.min);
	const b = apply(local.max);
	return {
		min: [0, 1, 2].map((i) => Math.min(a[i], b[i])),
		max: [0, 1, 2].map((i) => Math.max(a[i], b[i])),
	};
}

describe('USDZ for iPhone Quick Look (end-to-end on a real GLB)', () => {
	it('produces a package Quick Look can open: stored entries, 64-byte aligned, usda first', async () => {
		const usdz = await glbBlobToUsdzBlob(await centeredBoxGlb(), { ground: true });
		expect(usdz.type).toBe('model/vnd.usdz+zip');
		const bytes = new Uint8Array(await usdz.arrayBuffer());
		const report = validateUsdz(bytes);
		expect(report.errors).toEqual([]);
		expect(report.ok).toBe(true);
		expect(report.entries[0].name).toMatch(/\.usd[ac]?$/);
		expect(report.entries.every((e) => e.method === 0)).toBe(true);
	});

	it('sits the model on the floor and centers it, at its authored 1 m size', async () => {
		const usdz = await glbBlobToUsdzBlob(await centeredBoxGlb(), { ground: true });
		const files = unzipSync(new Uint8Array(await usdz.arrayBuffer()));
		const { min, max } = worldBounds(files);
		expect(min[1]).toBeCloseTo(0, 3);
		expect(max[1]).toBeCloseTo(0.6, 3);
		expect(min[0] + max[0]).toBeCloseTo(0, 3);
		expect(min[2] + max[2]).toBeCloseTo(0, 3);
		expect(max[0] - min[0]).toBeCloseTo(1, 3);
	});

	it('rescales a wrong-unit model and still grounds it', async () => {
		const glb = await centeredBoxGlb({ w: 40, h: 10, d: 20 });
		const usdz = await glbBlobToUsdzBlob(glb, { ground: true, scale: 0.025 });
		const { min, max } = worldBounds(unzipSync(new Uint8Array(await usdz.arrayBuffer())));
		expect(min[1]).toBeCloseTo(0, 3);
		expect(max[0] - min[0]).toBeCloseTo(1, 3);
		expect(max[1] - min[1]).toBeCloseTo(0.25, 3);
	});

	it('leaves avatars untouched when grounding is not asked for', async () => {
		const usdz = await glbBlobToUsdzBlob(await centeredBoxGlb());
		const { min } = worldBounds(unzipSync(new Uint8Array(await usdz.arrayBuffer())));
		expect(min[1]).toBeCloseTo(-0.3, 3);
	});
});

describe('validateUsdz rejects packages Quick Look refuses', () => {
	it('flags a deflated entry and a non-USD first entry', async () => {
		const { zipSync, strToU8 } = await import('three/addons/libs/fflate.module.js');
		const bad = zipSync({ 'texture.png': new Uint8Array(200), 'model.usda': [strToU8('#usda 1.0\n'.repeat(50)), { level: 6 }] });
		const report = validateUsdz(bad);
		expect(report.ok).toBe(false);
		expect(report.errors.join(' ')).toMatch(/first entry/i);
		expect(report.errors.join(' ')).toMatch(/compressed/i);
	});

	it('flags bytes that are not a zip at all', () => {
		const report = validateUsdz(new Uint8Array([1, 2, 3, 4]));
		expect(report.ok).toBe(false);
	});
});
