// globe-intel: the /globe page.
//
// A three.js globe that draws eleven layers of live world data, and the panels
// that make it readable. The arithmetic (layer registry, URL state, projection,
// ranking) lives in globe-intel-core.js; this file owns the scene, the pointer
// and the DOM.
//
// Three decisions shape everything here:
//
//   1. ONE PROJECTION, TWO SHAPES. Every drawable thing is stored twice, as a
//      point on the sphere and as a point on the equirectangular plane, and the
//      view control lerps between them. That is why switching to the flat map is
//      a morph rather than a rebuild, and why a point never has to be told which
//      view it is in.
//   2. THE URL IS THE STATE. Camera, zoom, view, range and layer selection all
//      live in the query string, written back as the user moves. Any view of this
//      page can be handed to someone else as a link, which is the whole point of
//      a situational map.
//   3. A DEAD LAYER IS INFORMATION. A failed upstream renders as a named,
//      styled row saying what could not be reached, never as an empty globe.
//      Same for no WebGL: the feed and the layer list still work, because the
//      data is worth reading even when the sphere cannot be drawn.

import {
	AdditiveBlending,
	BackSide,
	BufferAttribute,
	BufferGeometry,
	CanvasTexture,
	Color,
	LineBasicMaterial,
	LineSegments,
	Mesh,
	MeshBasicMaterial,
	PerspectiveCamera,
	Points,
	Raycaster,
	Scene,
	ShaderMaterial,
	SphereGeometry,
	Sprite,
	SpriteMaterial,
	Vector2,
	Vector3,
	WebGLRenderer,
} from 'three';
import { escapeHtml } from './shared/coin-format.js';
import {
	GLOBE_RADIUS,
	LAYERS,
	RANGES,
	blendProjection,
	cameraDistance,
	formatCount,
	hoursForRange,
	latLonToPlane,
	latLonToSphere,
	layerById,
	layerStatusLine,
	markerAlpha,
	markerSize,
	matchesQuery,
	normalizeLon,
	parseGlobeState,
	rankEvents,
	relativeTime,
	serializeGlobeState,
	zoomFromDistance,
} from './globe-intel-core.js';

// ── constants ────────────────────────────────────────────────────────────────

const LAND_URL = '/data/globe-land.json';
const API_URL = '/api/globe/intel';
const FETCH_TIMEOUT_MS = 25_000;
const REFRESH_MS = 5 * 60_000; // GDELT lands a file every 15 minutes; this is well inside it
const MARKER_ALTITUDE = 1.012; // markers float just clear of the surface so they never z-fight
const FEED_LIMIT = 200; // rows rendered; the search box reaches the rest
const MORPH_MS = 900;
const FLY_MS = 700;
const AUTO_SPIN_DEG_PER_SEC = 2.4;
// markerSize() returns a radius in world units; the point shader turns that into
// device pixels through a fixed projection constant. This is the conversion, set
// so a quiet marker lands near 4 CSS pixels and the loudest near 14.
const MARKER_PIXEL_SCALE = 4.5;
const IDLE_BEFORE_SPIN_MS = 6_000;

const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false;

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => (n < lo ? lo : n > hi ? hi : n);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// ── page state ───────────────────────────────────────────────────────────────

let state = parseGlobeState(window.location.search);
let payload = null; // last successful /api/globe/intel response
let loadError = null;
let selectedId = null;
let searchQuery = '';
let activeTab = 'layers';

// ── DOM ──────────────────────────────────────────────────────────────────────

const dom = {
	stage: $('gi-stage'),
	canvas: $('gi-canvas'),
	range: $('gi-range'),
	layers: $('gi-layers'),
	layerNote: $('gi-layer-note'),
	feed: $('gi-feed'),
	search: $('gi-search'),
	detail: $('gi-detail'),
	detailBody: $('gi-detail-body'),
	detailClose: $('gi-detail-close'),
	updated: $('gi-updated'),
	refresh: $('gi-refresh'),
	share: $('gi-share'),
	tooltip: $('gi-tooltip'),
	hint: $('gi-hint'),
	panelLayers: $('gi-panel-layers'),
	panelFeed: $('gi-panel-feed'),
};

// ── scene ────────────────────────────────────────────────────────────────────

const scene = new Scene();
const camera = new PerspectiveCamera(38, 1, 0.05, 60);
const raycaster = new Raycaster();
const pointer = new Vector2();

let renderer = null;

/** Layer id to its rendered Points object and the event array behind it. */
const rendered = new Map();

let landLines = null;
let graticule = null;
let globeMesh = null;
let atmosphere = null;
let selectionSprite = null;

// Morph is 0 on the globe and 1 on the flat map. `morphTarget` is where the view
// control wants it, `morphProgress` is how far the animation has walked toward
// it, and `morph` is that progress eased. Everything that reads a position uses
// `morph`, so the camera, the markers and the selection ring never disagree
// about where the world currently is.
let morphProgress = state.view === 'flat' ? 1 : 0;
let morphTarget = morphProgress;
let morph = morphProgress;

// Camera fly-to, used when a feed row or a search result is chosen.
let fly = null;

let lastPointerAt = performance.now();
let spinning = !reduceMotion;

/**
 * Per-point shader.
 *
 * A plain PointsMaterial cannot size a point per row, and severity IS the size
 * on this page, so the material is written out. The pulse term is deliberately
 * tied to severity rather than applied to everything: a globe where every dot
 * breathes is noise, one where only the loudest twelve do is a signal.
 */
const POINT_VERTEX = /* glsl */ `
	attribute float aSize;
	attribute float aAlpha;
	attribute float aPulse;
	attribute vec3 aColor;
	uniform float uPixelRatio;
	uniform float uTime;
	varying vec3 vColor;
	varying float vAlpha;
	void main() {
		vColor = aColor;
		vAlpha = aAlpha;
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		float pulse = 1.0 + 0.22 * aPulse * sin(uTime * 2.1 + aPulse * 9.0);
		gl_PointSize = aSize * pulse * uPixelRatio * (320.0 / max(0.1, -mv.z));
		gl_Position = projectionMatrix * mv;
	}
`;

const POINT_FRAGMENT = /* glsl */ `
	precision mediump float;
	uniform float uRing;
	varying vec3 vColor;
	varying float vAlpha;
	void main() {
		float d = length(gl_PointCoord - vec2(0.5));
		if (d > 0.5) discard;
		// A filled marker is a core plus a halo; a ring marker is an annulus, used
		// for the layers that describe an AREA (a hotspot cell, a country's
		// connectivity, a chokepoint) rather than a single incident.
		float filled = smoothstep(0.5, 0.18, d) + smoothstep(0.5, 0.0, d) * 0.32;
		float ring = smoothstep(0.5, 0.42, d) * smoothstep(0.26, 0.34, d);
		float shape = mix(filled, ring * 1.6, uRing);
		gl_FragColor = vec4(vColor, clamp(shape, 0.0, 1.0) * vAlpha);
	}
`;

function pointMaterial(isRing) {
	return new ShaderMaterial({
		uniforms: {
			uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
			uTime: { value: 0 },
			uRing: { value: isRing ? 1 : 0 },
		},
		vertexShader: POINT_VERTEX,
		fragmentShader: POINT_FRAGMENT,
		transparent: true,
		depthWrite: false,
		blending: AdditiveBlending,
	});
}

function initRenderer() {
	try {
		renderer = new WebGLRenderer({ canvas: dom.canvas, antialias: true, alpha: true });
	} catch {
		return false;
	}
	if (!renderer.getContext()) return false;
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
	renderer.setClearColor(0x000000, 0);
	resize();
	return true;
}

function resize() {
	if (!renderer) return;
	const w = dom.stage.clientWidth || 1;
	const h = dom.stage.clientHeight || 1;
	renderer.setSize(w, h, false);
	camera.aspect = w / h;
	camera.updateProjectionMatrix();
}

/** The dark sphere the markers sit on, plus its rim light. */
function buildGlobeBody() {
	globeMesh = new Mesh(
		new SphereGeometry(GLOBE_RADIUS, 96, 64),
		new MeshBasicMaterial({ color: 0x0b1020, transparent: true, opacity: 1 }),
	);
	scene.add(globeMesh);

	atmosphere = new Mesh(
		new SphereGeometry(GLOBE_RADIUS * 1.14, 64, 48),
		new ShaderMaterial({
			uniforms: { uOpacity: { value: 1 } },
			vertexShader: /* glsl */ `
				varying vec3 vNormal;
				void main() {
					vNormal = normalize(normalMatrix * normal);
					gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				precision mediump float;
				uniform float uOpacity;
				varying vec3 vNormal;
				void main() {
					float rim = pow(1.0 - abs(dot(vNormal, vec3(0.0, 0.0, 1.0))), 3.0);
					gl_FragColor = vec4(0.35, 0.58, 1.0, rim * 0.5 * uOpacity);
				}
			`,
			transparent: true,
			side: BackSide,
			depthWrite: false,
			blending: AdditiveBlending,
		}),
	);
	scene.add(atmosphere);
}

/**
 * Geometry that exists in both projections at once.
 *
 * Sphere and plane positions are computed once and kept; `position` is rewritten
 * from them whenever the morph value moves. Doing it this way (rather than in a
 * vertex shader) keeps `position` truthful, which is what the raycaster reads:
 * a shader-side morph would have made every marker unpickable in the flat view.
 */
function makeMorphGeometry(coords, altitude) {
	const n = coords.length;
	const sphere = new Float32Array(n * 3);
	const plane = new Float32Array(n * 3);
	const out = { x: 0, y: 0, z: 0 };
	for (let i = 0; i < n; i++) {
		latLonToSphere(coords[i][0], coords[i][1], altitude, out);
		sphere[i * 3] = out.x;
		sphere[i * 3 + 1] = out.y;
		sphere[i * 3 + 2] = out.z;
		latLonToPlane(coords[i][0], coords[i][1], (altitude - GLOBE_RADIUS) * 0.5, out);
		plane[i * 3] = out.x;
		plane[i * 3 + 1] = out.y;
		plane[i * 3 + 2] = out.z;
	}
	const geometry = new BufferGeometry();
	geometry.setAttribute('position', new BufferAttribute(new Float32Array(sphere), 3));
	geometry.userData.sphere = sphere;
	geometry.userData.plane = plane;
	return geometry;
}

function applyMorphTo(geometry, t) {
	const { sphere, plane } = geometry.userData;
	if (!sphere) return;
	const attr = geometry.getAttribute('position');
	const arr = attr.array;
	for (let i = 0; i < arr.length; i++) arr[i] = sphere[i] + (plane[i] - sphere[i]) * t;
	attr.needsUpdate = true;
	geometry.computeBoundingSphere();
}

function applyMorph(t) {
	if (landLines) applyMorphTo(landLines.geometry, t);
	if (graticule) applyMorphTo(graticule.geometry, t);
	for (const entry of rendered.values()) applyMorphTo(entry.object.geometry, t);
	if (globeMesh) {
		globeMesh.material.opacity = 1 - t;
		globeMesh.material.transparent = t > 0;
		globeMesh.material.depthWrite = t < 0.5;
		globeMesh.visible = t < 0.995;
	}
	if (atmosphere) {
		atmosphere.material.uniforms.uOpacity.value = 1 - t;
		atmosphere.visible = t < 0.995;
	}
	updateSelectionSprite();
}

/** Coastlines, as line segments in both projections. */
function buildLand(rings) {
	const coords = [];
	for (const ring of rings) {
		for (let i = 0; i < ring.length - 1; i++) {
			// A segment that would jump the seam is dropped rather than drawn across
			// the map; the generator already split rings there, this catches the rest.
			if (Math.abs(ring[i + 1][0] - ring[i][0]) > 180) continue;
			coords.push([ring[i][1], ring[i][0]], [ring[i + 1][1], ring[i + 1][0]]);
		}
	}
	const geometry = makeMorphGeometry(coords, GLOBE_RADIUS * 1.001);
	landLines = new LineSegments(
		geometry,
		new LineBasicMaterial({ color: 0x5b7fb5, transparent: true, opacity: 0.85 }),
	);
	scene.add(landLines);
}

/** A 30 degree graticule, so the sphere reads as a globe even where it is empty. */
function buildGraticule() {
	const coords = [];
	const push = (a, b) => coords.push(a, b);
	for (let lon = -180; lon < 180; lon += 30) {
		for (let lat = -90; lat < 90; lat += 5) push([lat, lon], [lat + 5, lon]);
	}
	for (let lat = -60; lat <= 60; lat += 30) {
		for (let lon = -180; lon < 180; lon += 5) push([lat, lon], [lat, lon + 5]);
	}
	graticule = new LineSegments(
		makeMorphGeometry(coords, GLOBE_RADIUS * 1.0005),
		new LineBasicMaterial({ color: 0x243049, transparent: true, opacity: 0.55 }),
	);
	scene.add(graticule);
}

/** The ring drawn around the selected marker. */
function buildSelectionSprite() {
	const size = 128;
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext('2d');
	ctx.strokeStyle = 'rgba(255,255,255,0.95)';
	ctx.lineWidth = 5;
	ctx.beginPath();
	ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
	ctx.stroke();
	selectionSprite = new Sprite(
		new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, depthWrite: false, depthTest: false }),
	);
	selectionSprite.visible = false;
	scene.add(selectionSprite);
}

// ── layer objects ────────────────────────────────────────────────────────────

function buildLayerObjects() {
	for (const entry of rendered.values()) {
		scene.remove(entry.object);
		entry.object.geometry.dispose();
		entry.object.material.dispose();
	}
	rendered.clear();
	if (!payload) return;

	for (const layer of LAYERS) {
		const data = payload.layers?.[layer.id];
		const events = data?.events || [];
		if (!events.length) continue;

		const coords = events.map((e) => [e.lat, e.lon]);
		const geometry = makeMorphGeometry(coords, MARKER_ALTITUDE);
		const n = events.length;
		const colors = new Float32Array(n * 3);
		const sizes = new Float32Array(n);
		const alphas = new Float32Array(n);
		const pulses = new Float32Array(n);
		const base = new Color(layer.color);

		for (let i = 0; i < n; i++) {
			const e = events[i];
			// Severity brightens the marker as well as growing it, so a dense cluster
			// of quiet points never reads as one loud one.
			const tint = base.clone().lerp(new Color(0xffffff), 0.18 * (e.severity || 0));
			colors[i * 3] = tint.r;
			colors[i * 3 + 1] = tint.g;
			colors[i * 3 + 2] = tint.b;
			sizes[i] = markerSize(e.severity, layer.ring ? { min: 0.018, max: 0.042 } : undefined) * MARKER_PIXEL_SCALE;
			alphas[i] = markerAlpha(e.severity) * (layer.live ? 1 : 0.6);
			pulses[i] = (e.severity || 0) > 0.75 ? 1 : 0;
		}

		geometry.setAttribute('aColor', new BufferAttribute(colors, 3));
		geometry.setAttribute('aSize', new BufferAttribute(sizes, 1));
		geometry.setAttribute('aAlpha', new BufferAttribute(alphas, 1));
		geometry.setAttribute('aPulse', new BufferAttribute(pulses, 1));

		const object = new Points(geometry, pointMaterial(Boolean(layer.ring)));
		object.name = layer.id;
		object.visible = state.layers.includes(layer.id);
		object.renderOrder = layer.live ? 2 : 1;
		scene.add(object);
		rendered.set(layer.id, { object, events });
	}
	applyMorph(morph);
}

function syncLayerVisibility() {
	for (const [id, entry] of rendered) entry.object.visible = state.layers.includes(id);
}

// ── camera ───────────────────────────────────────────────────────────────────

const camSphere = { x: 0, y: 0, z: 0 };
const camPlane = { x: 0, y: 0, z: 0 };
const targetPlane = { x: 0, y: 0, z: 0 };

function applyCamera() {
	// Blend the two views' distances rather than switching at the midpoint: a step
	// change in camera distance halfway through the morph reads as a stutter.
	const distance =
		cameraDistance(state.zoom, 'global') * (1 - morph) + cameraDistance(state.zoom, 'flat') * morph;
	latLonToSphere(state.lat, state.lon, distance, camSphere);
	latLonToPlane(state.lat, state.lon, distance, camPlane);
	latLonToPlane(state.lat, state.lon, 0, targetPlane);

	const pos = blendProjection(camSphere, camPlane, morph);
	camera.position.set(pos.x, pos.y, pos.z);
	const look = blendProjection({ x: 0, y: 0, z: 0 }, targetPlane, morph);
	camera.up.set(0, 1, 0);
	camera.lookAt(look.x, look.y, look.z);
	raycaster.params.Points.threshold = clamp(distance * 0.014, 0.006, 0.05);
}

function updateSelectionSprite() {
	if (!selectionSprite) return;
	const event = findEvent(selectedId);
	if (!event) {
		selectionSprite.visible = false;
		return;
	}
	const s = latLonToSphere(event.lat, event.lon, MARKER_ALTITUDE);
	const p = latLonToPlane(event.lat, event.lon, (MARKER_ALTITUDE - GLOBE_RADIUS) * 0.5);
	const blended = blendProjection(s, p, morph);
	selectionSprite.position.set(blended.x, blended.y, blended.z);
	const scale = clamp(camera.position.distanceTo(selectionSprite.position) * 0.05, 0.03, 0.14);
	selectionSprite.scale.set(scale, scale, 1);
	selectionSprite.visible = true;
}

// ── frame loop ───────────────────────────────────────────────────────────────

let lastFrame = performance.now();

function frame(now) {
	requestAnimationFrame(frame);
	if (!renderer) return;
	const dt = Math.min(0.1, (now - lastFrame) / 1000);
	lastFrame = now;

	if (morphProgress !== morphTarget) {
		const step = reduceMotion ? 1 : (dt * 1000) / MORPH_MS;
		morphProgress =
			morphTarget > morphProgress
				? Math.min(morphTarget, morphProgress + step)
				: Math.max(morphTarget, morphProgress - step);
		morph = easeInOut(morphProgress);
		applyMorph(morph);
	}

	if (fly) {
		const t = clamp((now - fly.start) / fly.duration, 0, 1);
		const k = easeInOut(t);
		state.lat = fly.fromLat + (fly.toLat - fly.fromLat) * k;
		state.lon = fly.fromLon + (fly.toLon - fly.fromLon) * k;
		state.zoom = fly.fromZoom + (fly.toZoom - fly.fromZoom) * k;
		if (t >= 1) {
			fly = null;
			queueUrlWrite();
		}
	} else if (spinning && morph < 0.02 && now - lastPointerAt > IDLE_BEFORE_SPIN_MS) {
		state.lon = normalizeLon(state.lon + AUTO_SPIN_DEG_PER_SEC * dt);
	}

	for (const entry of rendered.values()) entry.object.material.uniforms.uTime.value = now / 1000;
	applyCamera();
	updateSelectionSprite();
	renderer.render(scene, camera);
}

// ── pointer and keyboard ─────────────────────────────────────────────────────

let dragging = null;
let hoverId = null;

function ndcFrom(event) {
	const rect = dom.canvas.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
	return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/**
 * What is under the pointer.
 *
 * The globe body is included in the cast on purpose: intersections come back
 * sorted by distance, so a marker on the far side of the sphere loses to the
 * sphere itself and never answers a click through the planet.
 */
function pick() {
	raycaster.setFromCamera(pointer, camera);
	const targets = [...rendered.values()].filter((e) => e.object.visible).map((e) => e.object);
	if (globeMesh?.visible) targets.push(globeMesh);
	const hits = raycaster.intersectObjects(targets, false);
	for (const hit of hits) {
		if (hit.object === globeMesh) return null;
		const entry = rendered.get(hit.object.name);
		const event = entry?.events?.[hit.index];
		if (event) return { event, layerId: hit.object.name };
	}
	return null;
}

function onPointerDown(event) {
	lastPointerAt = performance.now();
	dom.canvas.setPointerCapture?.(event.pointerId);
	dragging = { x: event.clientX, y: event.clientY, lat: state.lat, lon: state.lon, moved: 0 };
	dom.canvas.classList.add('is-dragging');
	dom.hint?.classList.add('is-hidden');
}

function onPointerMove(event) {
	lastPointerAt = performance.now();
	const local = ndcFrom(event);

	if (dragging) {
		const dx = event.clientX - dragging.x;
		const dy = event.clientY - dragging.y;
		dragging.moved = Math.max(dragging.moved, Math.abs(dx) + Math.abs(dy));
		// Drag sensitivity scales with zoom so a close-in camera does not skate
		// across the globe, and the two views drag along their own axes.
		const speed = 0.32 / clamp(state.zoom, 0.6, 6);
		state.lat = clamp(dragging.lat + dy * speed, -85, 85);
		state.lon = normalizeLon(dragging.lon - dx * speed);
		fly = null;
		queueUrlWrite();
		return;
	}

	const hit = pick();
	const nextId = hit?.event?.id || null;
	dom.canvas.classList.toggle('is-over-point', Boolean(hit));
	if (nextId !== hoverId) {
		hoverId = nextId;
		renderTooltip(hit, local);
	} else if (hit) {
		positionTooltip(local);
	}
}

function onPointerUp(event) {
	dom.canvas.releasePointerCapture?.(event.pointerId);
	dom.canvas.classList.remove('is-dragging');
	const wasDrag = dragging && dragging.moved > 5;
	dragging = null;
	if (wasDrag) return;
	ndcFrom(event);
	const hit = pick();
	select(hit?.event?.id || null);
}

function onWheel(event) {
	event.preventDefault();
	lastPointerAt = performance.now();
	const distance = cameraDistance(state.zoom, morph > 0.5 ? 'flat' : 'global');
	const next = distance * Math.exp(event.deltaY * 0.0012);
	state.zoom = zoomFromDistance(next, morph > 0.5 ? 'flat' : 'global');
	fly = null;
	queueUrlWrite();
}

function onKeyDown(event) {
	if (event.metaKey || event.ctrlKey || event.altKey) return;
	const tag = document.activeElement?.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA') {
		if (event.key === 'Escape') document.activeElement.blur();
		return;
	}
	if (event.key === 'Escape') {
		select(null);
		return;
	}
	if (event.key === 'f' || event.key === 'F') {
		setView(state.view === 'flat' ? 'global' : 'flat');
		return;
	}
	if (event.key === ' ') {
		event.preventDefault();
		spinning = !spinning;
		lastPointerAt = spinning ? 0 : performance.now();
		return;
	}
	if (/^[0-9]$/.test(event.key)) {
		const index = event.key === '0' ? 9 : Number(event.key) - 1;
		const layer = LAYERS[index];
		if (layer) toggleLayer(layer.id);
	}
}

// ── tooltip ──────────────────────────────────────────────────────────────────

function positionTooltip(local) {
	dom.tooltip.style.left = `${local.x}px`;
	dom.tooltip.style.top = `${local.y}px`;
}

function renderTooltip(hit, local) {
	if (!hit) {
		dom.tooltip.hidden = true;
		return;
	}
	const layer = layerById(hit.layerId);
	const e = hit.event;
	dom.tooltip.innerHTML = `
		<strong>${escapeHtml(e.title)}</strong>
		<span>${escapeHtml(layer?.label || hit.layerId)}${e.place ? ` · ${escapeHtml(e.place)}` : ''} · ${escapeHtml(relativeTime(e.at))}</span>
	`;
	dom.tooltip.hidden = false;
	positionTooltip(local);
}

// ── data ─────────────────────────────────────────────────────────────────────

let inflight = null;

async function load({ silent = false } = {}) {
	inflight?.abort();
	const controller = new AbortController();
	inflight = controller;
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	if (!silent) {
		loadError = null;
		renderStatus('Loading live layers…');
		if (!payload) renderSkeletons();
	}
	try {
		const res = await fetch(`${API_URL}?range=${encodeURIComponent(state.timeRange)}`, {
			headers: { accept: 'application/json' },
			signal: controller.signal,
		});
		if (!res.ok) throw new Error(`the intel feed answered ${res.status}`);
		payload = await res.json();
		loadError = null;
		buildLayerObjects();
	} catch (err) {
		if (err?.name === 'AbortError') return;
		loadError = err?.message || 'the intel feed could not be reached';
	} finally {
		clearTimeout(timer);
		if (inflight === controller) inflight = null;
		renderAll();
	}
}

function findEvent(id) {
	if (!id) return null;
	for (const entry of rendered.values()) {
		const found = entry.events.find((e) => e.id === id);
		if (found) return found;
	}
	return null;
}

function findLayerFor(id) {
	for (const [layerId, entry] of rendered) {
		if (entry.events.some((e) => e.id === id)) return layerId;
	}
	return null;
}

/** Every event on an enabled layer, ranked and filtered for the feed. */
function feedEvents() {
	const out = [];
	for (const [layerId, entry] of rendered) {
		if (!state.layers.includes(layerId)) continue;
		for (const e of entry.events) {
			if (matchesQuery(e, searchQuery)) out.push({ ...e, layerId });
		}
	}
	return rankEvents(out);
}

// ── UI ───────────────────────────────────────────────────────────────────────

function renderStatus(message, isError = false) {
	dom.updated.textContent = message;
	dom.updated.classList.toggle('is-error', isError);
}

function renderRanges() {
	dom.range.innerHTML = RANGES.map(
		(r) =>
			`<button type="button" class="gi-seg-btn" data-range="${r.id}" aria-pressed="${
				r.id === state.timeRange
			}">${escapeHtml(r.label)}</button>`,
	).join('');
}

function renderSkeletons() {
	dom.layers.innerHTML = LAYERS.map(() => '<div class="gi-skeleton"></div>').join('');
	dom.feed.innerHTML = Array.from({ length: 6 }, () => '<div class="gi-skeleton"></div>').join('');
}

function renderLayers() {
	dom.layers.innerHTML = LAYERS.map((layer, index) => {
		const data = payload?.layers?.[layer.id];
		const on = state.layers.includes(layer.id);
		const bad = data?.status === 'unavailable';
		const shortcut = index < 10 ? `Shortcut: ${index === 9 ? '0' : index + 1}` : '';
		return `
			<button type="button" class="gi-layer" data-layer="${layer.id}" aria-pressed="${on}"
				style="--gi-swatch:${layer.color}" title="${escapeHtml(`${layer.blurb} ${shortcut}`.trim())}">
				<span class="gi-swatch" aria-hidden="true"></span>
				<span>
					<span class="gi-layer-name">${escapeHtml(layer.label)}</span>
					<span class="gi-layer-status${bad ? ' is-bad' : ''}">${escapeHtml(layerStatusLine(data, hoursForRange(state.timeRange)))}</span>
				</span>
				<span class="gi-layer-count">${data && !bad ? formatCount(data.count) : ''}</span>
			</button>
		`;
	}).join('');

	const enabled = state.layers.map((id) => payload?.layers?.[id]).filter(Boolean);
	const live = enabled.filter((l) => l.coverage === 'live').length;
	dom.layerNote.textContent = live
		? 'Some layers are reading GDELT live because this deployment has not filled its window yet. They cover about the last hour, not the range you picked.'
		: 'Every layer states the window it actually covered. Click a point on the globe, or open the feed, to read one.';
}

function renderFeed() {
	if (loadError && !payload) {
		dom.feed.innerHTML = `
			<p class="gi-empty">
				<strong>The intel feed could not be reached</strong>
				${escapeHtml(loadError)}. Nothing is cached from this session yet.
			</p>
			<div class="gi-detail-actions"><button type="button" data-action="retry">Try again</button></div>
		`;
		return;
	}
	const events = feedEvents();
	if (!events.length) {
		dom.feed.innerHTML = `
			<p class="gi-empty">
				<strong>${searchQuery ? 'Nothing matches that search' : 'No events on the layers you have on'}</strong>
				${
					searchQuery
						? 'Try a country, a city or an actor name, or clear the search.'
						: 'Switch on a layer, or widen the time range, to see what the feed is carrying.'
				}
			</p>
		`;
		return;
	}
	const fragment = document.createDocumentFragment();
	for (const e of events.slice(0, FEED_LIMIT)) {
		const layer = layerById(e.layerId);
		const row = document.createElement('button');
		row.type = 'button';
		row.className = `gi-feed-row${e.id === selectedId ? ' is-selected' : ''}`;
		row.dataset.event = e.id;
		row.style.setProperty('--gi-accent', layer?.color || 'var(--ink-dim)');
		row.innerHTML = `
			<span class="gi-feed-dot" aria-hidden="true"></span>
			<span>
				<span class="gi-feed-title">${escapeHtml(e.title)}</span>
				<span class="gi-feed-meta">${escapeHtml(
					[layer?.label, e.place, relativeTime(e.at)].filter(Boolean).join(' · '),
				)}</span>
			</span>
		`;
		fragment.append(row);
	}
	if (events.length > FEED_LIMIT) {
		const more = document.createElement('p');
		more.className = 'gi-empty';
		more.textContent = `${formatCount(events.length - FEED_LIMIT)} more on the globe. Search to narrow this list.`;
		fragment.append(more);
	}
	dom.feed.replaceChildren(fragment);
}

function renderDetail() {
	const event = findEvent(selectedId);
	if (!event) {
		dom.detail.hidden = true;
		dom.detailBody.replaceChildren();
		return;
	}
	const layerId = findLayerFor(selectedId);
	const layer = layerById(layerId);
	const data = payload?.layers?.[layerId];
	dom.detail.style.setProperty('--gi-accent', layer?.color || 'var(--ink-dim)');

	const members = Array.isArray(event.members) && event.members.length
		? `<ul class="gi-members">${event.members
				.map((m) => `<li>${escapeHtml(m.title)}${m.place ? ` · ${escapeHtml(m.place)}` : ''}</li>`)
				.join('')}</ul>`
		: '';

	const rows = [
		['Layer', layer?.label || layerId],
		['Place', event.place || event.country || 'Not named'],
		['When', relativeTime(event.at)],
		['Severity', `${Math.round((event.severity || 0) * 100)} of 100`],
		event.nearbyEvents !== undefined ? ['Nearby activity', `${formatCount(event.nearbyEvents)} events within ${event.radiusKm} km`] : null,
		event.count !== undefined ? ['Events in cell', formatCount(event.count)] : null,
		['Coordinates', `${event.lat.toFixed(2)}, ${event.lon.toFixed(2)}`],
		['Source', event.source || data?.source || 'Unattributed'],
	].filter(Boolean);

	dom.detailBody.innerHTML = `
		<span class="gi-detail-kind">${escapeHtml(layer?.label || layerId || 'Event')}</span>
		<h3>${escapeHtml(event.title)}</h3>
		${event.detail ? `<p>${escapeHtml(event.detail)}</p>` : ''}
		${members}
		<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join('')}</dl>
		<div class="gi-detail-actions">
			<button type="button" data-action="focus">Focus on globe</button>
			${event.url ? `<a href="${escapeHtml(event.url)}" target="_blank" rel="noopener noreferrer">Open source</a>` : ''}
		</div>
	`;
	dom.detail.hidden = false;
}

function renderUpdated() {
	if (loadError) {
		// A failure with data already on screen and a failure on the very first
		// load are different situations and deserve different sentences: one is
		// reassurance, the other is an instruction.
		renderStatus(
			payload
				? `${loadError}. The last good view is still on screen.`
				: `${loadError}. Nothing has loaded yet, so the globe is empty.`,
			true,
		);
		return;
	}
	if (!payload) {
		renderStatus('Loading live layers…');
		return;
	}
	const total = formatCount(payload.totalEvents);
	renderStatus(`${total} points · ${payload.rangeLabel} · updated ${relativeTime(payload.generated)}`);
}

function renderAll() {
	renderRanges();
	renderLayers();
	renderFeed();
	renderDetail();
	renderUpdated();
	renderViewButtons();
}

function renderViewButtons() {
	for (const btn of document.querySelectorAll('[data-view]')) {
		btn.setAttribute('aria-pressed', String(btn.dataset.view === state.view));
	}
}

// ── actions ──────────────────────────────────────────────────────────────────

function select(id) {
	selectedId = id;
	if (id) {
		const event = findEvent(id);
		if (event && !isVisibleOnScreen(event)) flyTo(event.lat, event.lon);
	}
	renderFeed();
	renderDetail();
	updateSelectionSprite();
}

/** Whether a point is currently facing the camera, so a click never spins away. */
function isVisibleOnScreen(event) {
	if (morph > 0.5) return true;
	const p = latLonToSphere(event.lat, event.lon, 1);
	const v = new Vector3(p.x, p.y, p.z);
	return v.dot(camera.position.clone().normalize()) > 0.15;
}

function flyTo(lat, lon, zoom = Math.max(state.zoom, 1.6)) {
	const from = normalizeLon(state.lon);
	let to = normalizeLon(lon);
	// Take the short way round, so a fly from Tokyo to Los Angeles crosses the
	// Pacific instead of unwinding across Europe.
	if (to - from > 180) to -= 360;
	if (from - to > 180) to += 360;
	if (reduceMotion) {
		state.lat = lat;
		state.lon = normalizeLon(to);
		state.zoom = zoom;
		queueUrlWrite();
		return;
	}
	fly = {
		start: performance.now(),
		duration: FLY_MS,
		fromLat: state.lat,
		fromLon: from,
		fromZoom: state.zoom,
		toLat: lat,
		toLon: to,
		toZoom: zoom,
	};
}

function toggleLayer(id) {
	const next = new Set(state.layers);
	if (next.has(id)) next.delete(id);
	else next.add(id);
	// Held in registry order, not toggle order, so switching a layer off and back
	// on produces the same URL it had before rather than a reshuffled one.
	state.layers = LAYERS.map((l) => l.id).filter((l) => next.has(l));
	if (selectedId && !state.layers.includes(findLayerFor(selectedId))) selectedId = null;
	syncLayerVisibility();
	renderLayers();
	renderFeed();
	renderDetail();
	queueUrlWrite();
}

function setView(view) {
	state.view = view;
	morphTarget = view === 'flat' ? 1 : 0;
	if (reduceMotion) {
		morphProgress = morphTarget;
		morph = morphTarget;
		applyMorph(morph);
	}
	renderViewButtons();
	queueUrlWrite();
}

function setRange(range) {
	if (range === state.timeRange) return;
	state.timeRange = range;
	renderRanges();
	queueUrlWrite();
	load();
}

function setTab(tab) {
	activeTab = tab;
	dom.panelLayers.hidden = tab !== 'layers';
	dom.panelFeed.hidden = tab !== 'feed';
	for (const btn of document.querySelectorAll('.gi-tab')) {
		btn.setAttribute('aria-selected', String(btn.dataset.tab === tab));
	}
	if (tab === 'feed') dom.search?.focus({ preventScroll: true });
}

// ── URL ──────────────────────────────────────────────────────────────────────

let urlTimer = null;

/**
 * The address bar is written on a trailing edge, not per frame: replaceState is
 * cheap but not free, and a 60fps drag would push 60 history writes a second
 * through it on a machine that has better things to do.
 */
function queueUrlWrite() {
	if (urlTimer) return;
	urlTimer = setTimeout(() => {
		urlTimer = null;
		const search = serializeGlobeState(state);
		window.history.replaceState(null, '', `${window.location.pathname}${search}`);
	}, 260);
}

/** The share button says what happened, to the eye and to a screen reader. */
function setShareLabel(text, done) {
	dom.share.textContent = text;
	dom.share.setAttribute('aria-label', done ? 'Link copied to the clipboard' : 'Copy a link to this exact view');
	dom.share.classList.toggle('is-done', done);
}

async function shareView() {
	const url = `${window.location.origin}${window.location.pathname}${serializeGlobeState(state)}`;
	try {
		await navigator.clipboard.writeText(url);
		setShareLabel('Link copied', true);
		setTimeout(() => setShareLabel('Share view', false), 1800);
	} catch {
		// Clipboard access can be refused outright (permissions, an insecure
		// context, an embedded frame). Putting the URL in the address bar is the
		// honest fallback: the user can still copy it.
		window.history.replaceState(null, '', `${window.location.pathname}${serializeGlobeState(state)}`);
		setShareLabel('Copy from the address bar', false);
		setTimeout(() => setShareLabel('Share view', false), 2400);
	}
}

// ── wiring ───────────────────────────────────────────────────────────────────

function wireEvents() {
	dom.canvas.addEventListener('pointerdown', onPointerDown);
	dom.canvas.addEventListener('pointermove', onPointerMove);
	dom.canvas.addEventListener('pointerup', onPointerUp);
	dom.canvas.addEventListener('pointercancel', () => {
		dragging = null;
		dom.canvas.classList.remove('is-dragging');
	});
	dom.canvas.addEventListener('pointerleave', () => {
		hoverId = null;
		dom.tooltip.hidden = true;
	});
	dom.canvas.addEventListener('wheel', onWheel, { passive: false });
	window.addEventListener('keydown', onKeyDown);
	window.addEventListener('resize', resize);

	dom.layers.addEventListener('click', (e) => {
		const button = e.target.closest('[data-layer]');
		if (button) toggleLayer(button.dataset.layer);
	});

	dom.range.addEventListener('click', (e) => {
		const button = e.target.closest('[data-range]');
		if (button) setRange(button.dataset.range);
	});

	dom.feed.addEventListener('click', (e) => {
		if (e.target.closest('[data-action="retry"]')) {
			load();
			return;
		}
		const row = e.target.closest('[data-event]');
		if (!row) return;
		select(row.dataset.event);
		const event = findEvent(row.dataset.event);
		if (event) flyTo(event.lat, event.lon);
	});

	dom.search.addEventListener('input', (e) => {
		searchQuery = e.target.value;
		renderFeed();
	});

	dom.detail.addEventListener('click', (e) => {
		if (e.target.closest('[data-action="focus"]')) {
			const event = findEvent(selectedId);
			if (event) flyTo(event.lat, event.lon, Math.max(state.zoom, 2.2));
		}
	});

	dom.detailClose.addEventListener('click', () => select(null));
	dom.refresh.addEventListener('click', () => load());
	dom.share.addEventListener('click', shareView);

	for (const btn of document.querySelectorAll('[data-view]')) {
		btn.addEventListener('click', () => setView(btn.dataset.view));
	}
	for (const btn of document.querySelectorAll('.gi-tab')) {
		btn.addEventListener('click', () => setTab(btn.dataset.tab));
	}

	window.addEventListener('popstate', () => {
		state = parseGlobeState(window.location.search);
		morphTarget = state.view === 'flat' ? 1 : 0;
		if (reduceMotion) {
			morphProgress = morphTarget;
			morph = morphTarget;
			applyMorph(morph);
		}
		syncLayerVisibility();
		renderAll();
	});

	// A tab left open overnight should not keep polling a globe nobody is looking
	// at, and should be current the moment it comes back.
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') load({ silent: true });
	});
	setInterval(() => {
		if (document.visibilityState === 'visible') load({ silent: true });
	}, REFRESH_MS);
}

function showWebglFallback() {
	dom.canvas.hidden = true;
	const notice = document.createElement('p');
	notice.className = 'gi-empty';
	notice.innerHTML =
		'<strong>This browser cannot open a WebGL context</strong>Everything on the globe is still readable in the feed beside it, and at <a href="/api/globe/intel">/api/globe/intel</a>.';
	dom.stage.append(notice);
	setTab('feed');
}

async function loadLand() {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		const res = await fetch(LAND_URL, { signal: controller.signal });
		if (!res.ok) throw new Error(`land geometry answered ${res.status}`);
		const data = await res.json();
		buildLand(data.rings || []);
		applyMorph(morph);
	} catch {
		// The globe is still usable without coastlines: the graticule gives it
		// orientation and every marker is still in the right place. Losing the
		// outline is a degraded picture, not a broken page.
	} finally {
		clearTimeout(timer);
	}
}

function start() {
	renderRanges();
	renderSkeletons();
	setTab(activeTab);

	if (!initRenderer()) {
		showWebglFallback();
	} else {
		buildGlobeBody();
		buildGraticule();
		buildSelectionSprite();
		applyMorph(morph);
		applyCamera();
		requestAnimationFrame(frame);
		new ResizeObserver(resize).observe(dom.stage);
		loadLand();
	}

	wireEvents();
	load();

	if (reduceMotion) spinning = false;
	// The hint has said its piece by the time anyone has read it twice.
	setTimeout(() => dom.hint?.classList.add('is-hidden'), 12_000);
}

start();
