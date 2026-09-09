/**
 * /home/:id, the live 3D home.
 *
 * The page owns state, not geometry. It holds one SSE subscription to the
 * house, turns every event into a scene model, hands that to whichever renderer
 * this device can run, and renders the ten states a real house actually reaches
 * (loading, empty, unfiled, live, stale, disconnected, acting, awaiting a human
 * yes, no WebGL, broken) as designed screens rather than as a spinner and a
 * stack trace.
 *
 * The one rule that outranks everything else here: the house never empties. A
 * dropped socket greys the scene and shows its age. It does not clear it.
 */

import { HomeApiError, callService, getHome, getLayout, grantEntity, openStream } from './api.js';
import { buildSceneModel } from './scene-model.js';
import { createHomeFallback, webglAvailable } from './scene-fallback.js';
import { formatNumber, locale, plural, t } from './i18n-home.js';

const VIEW_KEY = 'three:home:view';
/** A device that cannot hold this for a few seconds is sent to the 2D house. */
const MIN_FPS = 18;
const FPS_GRACE_MS = 6000;

const el = {
	shell: document.getElementById('hs-shell'),
	title: document.getElementById('hs-title'),
	status: document.getElementById('hs-status'),
	rooms: document.getElementById('hs-rooms'),
	stage: document.getElementById('hs-stage'),
	panel: document.getElementById('hs-panel'),
	panelEmpty: document.getElementById('hs-panel-empty'),
	inspector: document.getElementById('hs-inspector'),
	live: document.getElementById('hs-live'),
	alert: document.getElementById('hs-alert'),
	view3d: document.getElementById('hs-view-3d'),
	view2d: document.getElementById('hs-view-2d'),
	viewPlan: document.getElementById('hs-view-plan'),
	plan: document.getElementById('hs-plan'),
	reconnect: document.getElementById('hs-reconnect'),
};

const state = {
	homeId: homeIdFromPath(),
	home: null,
	graph: null,
	model: null,
	/**
	 * The authored floorplan's room map, or null when nobody drew one. Null is
	 * the ordinary state: the scene packs rooms into a default grid without it.
	 */
	layout: null,
	layoutVersion: 0,
	/** The mounted floorplan editor, when the plan view is showing. */
	plan: null,
	view: preferredView(),
	renderer: null,
	stream: null,
	status: 'connecting',
	stale: false,
	lastGraphAt: 0,
	selected: null,
	pending: null,
	/** The control that asked, so a cancelled confirmation gives the keyboard back. */
	confirmReturn: null,
	busy: new Set(),
	log: [],
	// Latency instrumentation: the wall time from an SSE frame landing to the
	// first painted frame that carries it. Reported on window for the
	// measurement pass and for the e2e spec.
	latency: { last: null, samples: [] },
	overlay: null,
	fpsSince: 0,
	// True once a person picked a view, by clicking the toggle or by asking for
	// one in the URL. An explicit choice is never overridden by the frame-rate
	// watchdog: measuring a slow device is a reason to offer the flat house, not
	// a reason to overrule someone who asked for the 3D one.
	viewChosen: new URLSearchParams(location.search).has('view'),
};

window.__homeScene = {
	get model() {
		return state.model;
	},
	get latency() {
		return state.latency;
	},
	get status() {
		return { status: state.status, stale: state.stale, view: state.view };
	},
	stats() {
		return state.renderer?.stats?.() || null;
	},
	/**
	 * Where an entity sits on screen right now, or null when the 3D view is not
	 * mounted or the object is off camera.
	 *
	 * Clicking an object inside the canvas is the page's primary gesture and the
	 * one interaction nothing automated can otherwise reach: a raycast needs a
	 * pixel, and a pixel guessed from outside is a test that passes by luck. This
	 * hands out the real position of a real object so the measurement pass and
	 * the e2e spec click the same place a person would.
	 */
	project(entityId) {
		return state.renderer?.project?.(entityId) || null;
	},
};

boot();

async function boot() {
	if (!state.homeId) {
		showOverlay({
			title: t('home_scene.no_id_title', 'No home in that link'),
			body: t('home_scene.no_id_body', 'A home scene needs a home id, as in /home/<id>. Open one from your list of connected homes.'),
			actions: [{ label: t('home_scene.your_homes', 'Your homes'), href: '/home', primary: true }],
		});
		return;
	}
	el.view3d.addEventListener('click', () => {
		state.viewChosen = true;
		setView('3d', { remember: true });
	});
	el.view2d.addEventListener('click', () => {
		state.viewChosen = true;
		setView('2d', { remember: true });
	});
	el.viewPlan?.addEventListener('click', () => {
		state.viewChosen = true;
		setView('plan', { remember: true });
	});
	el.reconnect.addEventListener('click', () => reconnect());
	document.addEventListener('keydown', onKeydown);
	holdScreenAwake();

	await load();
}

/**
 * The decision, and why it is this one.
 *
 * The live house is the only surface in the lane a screen is meant to sit on:
 * a kitchen tablet on a shelf showing which lights are on. A wall display that
 * blanks every thirty seconds is not a display, and the user cannot fix it
 * without turning off the device's screen timeout for everything else it does.
 * So this page, and only this page, asks for a screen wake lock.
 *
 * The other half matters more. A phone must never be held awake by a tab it is
 * not looking at, so the lock is dropped the moment the document is hidden and
 * only re-taken when it comes back visible. That is also what the platform
 * requires: a wake lock is released automatically on hide, and re-acquiring is
 * the only way back, so the visibility handler is the feature, not a guard
 * around it.
 *
 * Everything here is best-effort. Screen Wake Lock is absent on some browsers
 * and the request is refused outright on a low battery, both of which are the
 * device making a correct decision. The scene is unaffected either way, so a
 * failure is never surfaced to the user.
 */
function holdScreenAwake() {
	if (!('wakeLock' in navigator)) return;
	let sentinel = null;

	const acquire = async () => {
		if (sentinel || document.visibilityState !== 'visible') return;
		try {
			sentinel = await navigator.wakeLock.request('screen');
			sentinel.addEventListener('release', () => {
				sentinel = null;
			});
		} catch {
			sentinel = null;
		}
	};

	const release = () => {
		sentinel?.release?.().catch(() => {});
		sentinel = null;
	};

	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') acquire();
		else release();
	});
	window.addEventListener('pagehide', release);
	acquire();
}

async function load() {
	setStatus('connecting', 'Connecting');
	try {
		const payload = await getHome(state.homeId);
		state.home = payload.home || null;
		// The house's own label is the user's word for their own home: shown as
		// they typed it, in every locale. Only the fallback for a home nobody
		// named is ours to translate.
		const label = state.home?.label || t('home_scene.untitled_home', 'Your home');
		el.title.textContent = label;
		document.title = `${label} · three.ws`;
		mountRenderer();
		// The authored floorplan, if anyone drew one. Best effort on purpose: a
		// layout that cannot be read must never stop the house from rendering,
		// because the default grid is a complete experience on its own.
		loadLayout();
		if (payload.graph) {
			applyGraph(payload.graph, { stale: Boolean(payload.stale) });
			setStatusFromServer({ status: payload.live_status, stale: payload.stale, detail: payload.error?.message });
		} else if (payload.error) {
			// A 200 carrying a coded failure: the connection record exists, the house
			// did not answer. That is a designed screen, not an exception.
			renderFailure(new HomeApiError(payload.error.code, payload.error.message));
			return;
		}
		subscribe();
	} catch (err) {
		renderFailure(err);
	}
}

// ── the stream ───────────────────────────────────────────────────────────────

function subscribe() {
	state.stream?.close();
	state.stream = openStream(state.homeId, {
		onOpen() {
			setStatus('live', t('home_scene.status_live', 'Live'));
		},
		onGraph(payload) {
			const receivedAt = performance.now();
			applyGraph(payload.graph, { stale: Boolean(payload.stale), receivedAt });
			if (payload.stale) setStatusFromServer(payload);
		},
		onStatus(payload) {
			setStatusFromServer(payload);
		},
		onSilence() {
			// A stream that stopped delivering without closing. Treat it as a
			// disconnect rather than as a very quiet house.
			setStatusFromServer({ status: 'disconnected', stale: true, detail: 'The live stream went quiet.' });
		},
	});
}

function reconnect() {
	el.reconnect.disabled = true;
	setStatus('connecting', 'Connecting');
	load().finally(() => {
		el.reconnect.disabled = false;
	});
}

/**
 * Turn what the server said into one of the four things the top bar can say.
 *
 * The distinction that matters: a house that dropped while the platform is
 * still retrying is STALE, not disconnected. The data is old and the system is
 * working on it, and there is nothing for the person to do but read the age.
 * Disconnected is reserved for the cases where nobody is retrying: the token
 * stopped working, or this browser's own stream is gone. That is the state that
 * offers a button, because that is the state where pressing one helps.
 */
function setStatusFromServer(payload) {
	const status = payload.status || 'live';
	state.stale = Boolean(payload.stale);
	const detail = payload.detail || payload.statusDetail;
	if (status === 'auth_failed' || status === 'revoked' || status === 'disconnected') {
		setStatus('disconnected', status === 'auth_failed' ? t('home_scene.status_reauth', 'Sign in again') : t('home_scene.status_disconnected', 'Disconnected'), detail);
	} else if (status === 'unreachable' || state.stale || status === 'reconnecting' || status === 'pending' || status === 'connecting') {
		setStatus('stale', status === 'reconnecting' ? t('home_scene.status_reconnecting', 'Reconnecting') : t('home_scene.status_stale', 'Stale'), detail);
	} else {
		setStatus('live', 'Live');
	}
}

function setStatus(kind, label, detail) {
	state.status = kind;
	el.status.dataset.status = kind;
	el.status.textContent = label;
	el.status.title = detail || '';
	// Offered whenever the house is not live: on a terminal disconnect it is the
	// only way back, and on a long stale it is a person deciding not to wait.
	el.reconnect.hidden = kind === 'live' || kind === 'connecting';
	const stale = kind === 'stale' || kind === 'disconnected';
	state.stale = stale;
	state.renderer?.setStale?.(stale);
	el.stage.classList.toggle('is-stale', stale);
	renderAge();
	if (kind === 'disconnected') {
		announce(detail || t('home_scene.dropped', 'The connection to your home dropped. The house below is the last state we saw.'));
	}
}

/**
 * Read the authored floorplan and re-lay the scene with it.
 *
 * Deliberately not awaited by load(): the house paints on the default grid
 * immediately and slides into the authored plan when it arrives, which is a
 * better first frame than a blank canvas waiting on a second request. A failure
 * leaves state.layout null, which is exactly the no-layout case the model
 * already handles.
 */
async function loadLayout() {
	try {
		const res = await getLayout(state.homeId);
		state.layout = res?.layout?.rooms || null;
		state.layoutVersion = res?.version || 0;
		if (state.graph) applyGraph(state.graph, { stale: state.stale });
	} catch {
		state.layout = null;
	}
}

// ── the model ────────────────────────────────────────────────────────────────

function applyGraph(graph, { stale = false, receivedAt = 0 } = {}) {
	if (!graph) return;
	state.graph = graph;
	state.lastGraphAt = Date.now();
	state.stale = stale;
	const model = buildSceneModel(graph, { focusRoomId: state.model?.focusRoomId, layout: state.layout });
	state.model = model;
	renderRooms(model);
	renderInspector();
	// The designed nothings are the page's, not the renderer's. Gating them on a
	// mounted renderer meant an empty house painted nothing at all while the 3D
	// module was still being imported, which is the exact case the empty state
	// exists for.
	renderEmptyStates(model);
	renderAge();
	// A cold load straight into ?view=plan mounts the editor before the first
	// graph has landed, so it opens with no rooms to arrange. Hand it the house
	// the moment it arrives, exactly once: later frames are deliberately left
	// alone, because rebuilding the tray on every state change would land under
	// someone who is mid-drag.
	if (state.planAwaitingGraph && state.plan) {
		state.plan.setGraph?.(graph);
		state.planAwaitingGraph = false;
	}
	if (receivedAt) measureLatency(receivedAt);
	if (!state.renderer) return;
	state.renderer.setModel(model);
	state.renderer.setStale?.(stale);
	repositionConfirm();
}

/**
 * How long a real device change takes to reach the screen: the SSE frame lands,
 * the next painted frame carries it, and the difference is the number this
 * order has to report. Measured, not estimated.
 */
function measureLatency(receivedAt) {
	requestAnimationFrame(() => {
		const ms = Math.round(performance.now() - receivedAt);
		state.latency.last = ms;
		state.latency.samples.push(ms);
		// A ten-minute wall display must not grow an array forever.
		if (state.latency.samples.length > 200) state.latency.samples.splice(0, 100);
	});
}

// ── renderers ────────────────────────────────────────────────────────────────

function mountRenderer() {
	const want = state.view === '2d' || !webglAvailable() ? '2d' : '3d';
	if (want === '2d' && state.view !== '2d') {
		// Not a preference: this device genuinely cannot run WebGL, and it is
		// told so rather than being shown a blank canvas.
		announce(t('home_scene.no_webgl_switched', 'This browser cannot run WebGL, so your home is shown as a floor list you can still read and control.'));
		state.view = '2d';
	}
	setView(state.view, { remember: false, force: true });
}

function setView(view, { remember = true, force = false } = {}) {
	if (view === '3d' && !webglAvailable()) {
		announce(t('home_scene.no_webgl_stays', 'WebGL is unavailable in this browser, so the 2D house stays on.'));
		view = '2d';
	}
	if (!force && view === state.view && state.renderer) return;
	state.view = view;
	if (remember) {
		try {
			localStorage.setItem(VIEW_KEY, view);
		} catch {
			// A private window keeps the choice for this visit only.
		}
	}
	el.view3d.setAttribute('aria-pressed', String(view === '3d'));
	el.view2d.setAttribute('aria-pressed', String(view === '2d'));
	el.viewPlan?.setAttribute('aria-pressed', String(view === 'plan'));
	el.view3d.disabled = !webglAvailable();
	if (el.view3d.disabled) el.view3d.title = t('home_scene.no_webgl_title', 'This browser cannot run WebGL.');

	state.renderer?.dispose();
	state.renderer = null;
	clearStage();
	el.stage.classList.toggle('is-flat', view === '2d');

	// The plan is a workspace, not a renderer: it replaces the stage rather than
	// drawing into it, and it keeps no live subscription of its own.
	state.plan?.destroy();
	state.plan = null;
	if (el.plan) el.plan.hidden = view !== 'plan';
	el.stage.hidden = view === 'plan';
	if (view === 'plan') {
		mountPlan();
		renderAge();
		return;
	}

	if (view === '2d') {
		state.renderer = createHomeFallback(el.stage, { onAct: act, onFocusRoom: focusRoom });
		state.fpsSince = 0;
	} else {
		mount3d();
	}
	if (state.model) {
		state.renderer.setModel(state.model);
		state.renderer.setStale?.(state.stale);
		renderEmptyStates(state.model);
	}
	renderAge();
}

/**
 * The floorplan workspace.
 *
 * Loaded on demand: nobody who only wants to see their house should pay for the
 * editor. Its saves feed straight back into the model, so the 3D view is already
 * arranged when they switch back to it.
 */
async function mountPlan() {
	if (!el.plan) return;
	el.plan.textContent = '';
	const { mountFloorplan } = await import('./floorplan.js');
	if (state.view !== 'plan') return;
	// True only on a cold load into ?view=plan, where the editor is mounted
	// before the first graph frame. applyGraph hands the house over when it
	// lands and clears this.
	state.planAwaitingGraph = !state.graph;
	state.plan = mountFloorplan({
		mount: el.plan,
		homeId: state.homeId,
		graph: state.graph,
		// The layout capability. A guest sees the plan and cannot redraw somebody
		// else's home; the server enforces it either way, this only hides controls
		// that would fail.
		canEdit: state.home?.capabilities?.layout !== false,
		onChange(doc, opts) {
			state.layout = doc?.rooms || null;
			if (state.graph) applyGraph(state.graph, { stale: state.stale });
			// Filing a device changed Home Assistant's own registry, so the room
			// graph is stale in a way no state event will correct.
			if (opts?.refreshGraph) refreshGraph();
		},
	});
	el.plan.focus?.();
}

/** Re-read the house after we changed its registry rather than its state. */
async function refreshGraph() {
	try {
		const payload = await getHome(state.homeId);
		if (payload?.graph) {
			applyGraph(payload.graph, { stale: Boolean(payload.stale) });
			// The editor holds its own reference to the graph and builds the tray
			// from it. Filing a device or making a room changed the registry, so
			// without this the tray still offers a device that now has a home.
			state.plan?.setGraph?.(payload.graph);
		}
	} catch {
		// The plan is still correct locally; the graph refreshes on the next event.
	}
}

async function mount3d() {
	// The renderer pulls Three.js, the avatar loader and the clip library. A
	// device that will never show it (or a visitor who prefers the flat house)
	// must not pay for the bytes, so it is imported here and not at module load.
	try {
		const { createHomeScene } = await import('./scene-render.js');
		if (state.view !== '3d') return;
		state.renderer = createHomeScene(el.stage, {
			onSelect: (entityId, object) => {
				state.selected = entityId ? { entityId, object } : null;
				for (const button of el.rooms.querySelectorAll('.hs-room-device')) {
					button.setAttribute('aria-current', String(button.dataset.entityId === entityId));
				}
				renderInspector();
			},
			onFocusRoom: focusRoom,
			onFirstFrame: () => {
				state.fpsSince = performance.now();
				startFpsWatch();
			},
		});
		if (state.model) {
			state.renderer.setModel(state.model);
			state.renderer.setStale?.(state.stale);
			renderEmptyStates(state.model);
		}
	} catch (err) {
		announce(t('home_scene.render_failed', 'The 3D house could not start, so the 2D house is on instead.'));
		console.warn('[home] 3D renderer failed to start', err);
		setView('2d', { remember: false, force: true });
	}
}

/**
 * If this device measurably cannot hold a usable frame rate, move it to the 2D
 * house and say so. Measure, then route: never assume a class of device is too
 * slow, and never leave someone watching a slideshow of their own kitchen.
 */
function startFpsWatch() {
	const started = performance.now();
	const timer = setInterval(() => {
		if (state.view !== '3d' || !state.renderer) return clearInterval(timer);
		const stats = state.renderer.stats?.();
		if (!stats || !stats.fps) return;
		if (performance.now() - started < FPS_GRACE_MS) return;
		clearInterval(timer);
		if (stats.fps >= MIN_FPS) return;
		if (state.viewChosen) {
			// They asked for this view. Say what the device is doing and leave it on.
			announce(t('home_scene.fps_kept', 'This device is holding {{fps}} frames a second in the 3D house. The 2D button is faster if it feels heavy.', { fps: formatNumber(stats.fps) }));
			return;
		}
		announce(t('home_scene.fps_switched', 'This device held only {{fps}} frames a second, so your home switched to the 2D view. The 3D button turns it back on.', { fps: formatNumber(stats.fps) }));
		setView('2d', { remember: false, force: true });
	}, 1000);
}

function clearStage() {
	for (const node of [...el.stage.children]) {
		if (node.classList?.contains('hs-overlay') || node.classList?.contains('hs-confirm') || node.classList?.contains('hs-age')) continue;
		node.remove();
	}
}

// ── the room rail ────────────────────────────────────────────────────────────

function renderRooms(model) {
	el.rooms.classList.remove('hs-skeleton');
	el.rooms.removeAttribute('aria-busy');
	el.rooms.innerHTML = '';
	if (!model.rooms.length) {
		const note = document.createElement('p');
		note.className = 'hs-panel-empty';
		note.textContent = t('home_scene.no_rooms', 'No rooms yet.');
		el.rooms.appendChild(note);
		return;
	}
	for (const floor of model.floors) {
		const section = document.createElement('section');
		section.className = 'hs-floor';
		if (model.floors.length > 1) {
			const name = document.createElement('p');
			name.className = 'hs-floor-name';
			name.textContent = floor.name;
			section.appendChild(name);
		}
		const list = document.createElement('ul');
		list.className = 'hs-room-list';
		for (const roomId of floor.roomIds) {
			const room = model.rooms.find((r) => r.id === roomId);
			if (!room) continue;
			const item = document.createElement('li');
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'hs-room';
			button.setAttribute('aria-current', String(room.id === model.focusRoomId));
			button.dataset.roomId = room.id;

			// Decorative: it carries the room's real light colour, which is lovely
			// and is never the only place a fact lives. Every state it hints at is
			// also a word in the meta below or in the description read to a screen
			// reader, so a person who cannot separate warm white from cool white,
			// or cannot see the rail at all, loses nothing.
			const dot = document.createElement('span');
			dot.className = 'hs-room-dot';
			dot.setAttribute('aria-hidden', 'true');
			dot.dataset.lit = String(Boolean(room.light.on));
			dot.style.setProperty('--room-dot', room.light.on ? room.light.hex : 'rgba(255,255,255,0.14)');
			dot.style.setProperty('--room-halo', room.light.on ? `${Math.round(3 + room.light.brightness * 7)}px` : '0px');
			button.appendChild(dot);

			const name = document.createElement('span');
			name.className = 'hs-room-name';
			name.textContent = room.name;
			button.appendChild(name);

			const meta = document.createElement('span');
			meta.className = 'hs-room-meta';
			if (room.security && !room.security.secure) {
				meta.classList.add('hs-room-alert');
				// The word carries it, not the colour: `hs-room-alert` is red AND
				// says "open", and the two never disagree.
				meta.textContent = t('home_scene.meta_open', 'open');
			} else if (room.light.total) {
				// Lights on used to live only in the dot's colour, which is exactly
				// the failure WCAG 1.4.1 is about. The count is the same fact in
				// words, and it is more useful than the bare entity count it
				// replaced: "2/5" answers "did I leave a light on in there".
				meta.textContent = t('home_scene.meta_lights', '{{on}}/{{total}}', { on: formatNumber(room.light.count), total: formatNumber(room.light.total) });
			} else if (room.climate) {
				meta.textContent = room.climate.label;
			} else {
				meta.textContent = formatNumber(room.entityCount);
			}
			button.appendChild(meta);

			// The whole room in one sentence, for the reader that cannot see any
			// of the above. It replaces the button's own label rather than adding
			// to it, so "Kitchen, 2 of 5" is never read as two disconnected
			// fragments.
			button.setAttribute('aria-label', t('home_scene.said_room', '{{name}}. {{description}}', { name: room.name, description: describeRoom(room) }));

			button.addEventListener('click', () => focusRoom(room.id));
			item.appendChild(button);

			// The devices of the room the house is looking at, as real controls.
			//
			// This is the keyboard and screen-reader path into the house, and it
			// is the reason the 3D view is operable at all: a WebGL canvas is one
			// opaque element, so picking a lamp by clicking it in the scene is a
			// gesture only a mouse or a finger can make. Without this list, a
			// person navigating by keyboard could reach the rooms and the panel
			// and never reach a single device. It is not a fallback rendering of
			// the scene: it is the same model, the same selection and the same
			// inspector the canvas drives, reached a different way.
			//
			// Only the focused room expands, which is also what the camera is
			// doing, so the two stay one thing rather than two lists to keep in
			// sync. It stays visible rather than screen-reader-only on purpose:
			// an invisible control that takes focus fails WCAG 2.4.7, and picking
			// a small object out of a 3D scene is fiddly with a mouse too.
			const expanded = room.id === model.focusRoomId;
			button.setAttribute('aria-expanded', String(expanded));
			if (expanded && room.objects.length) {
				const devicesId = `hs-devices-${room.id}`;
				button.setAttribute('aria-controls', devicesId);
				item.appendChild(renderRoomDevices(room, devicesId));
			}
			list.appendChild(item);
		}
		section.appendChild(list);
		el.rooms.appendChild(section);
	}
}

/**
 * A room as one plain sentence: what is lit, what it measures, what is open.
 * Used for the rail button's own label and for the spoken announcement when the
 * house looks at a room, so the two can never say different things.
 */
function describeRoom(room) {
	const bits = [];
	if (room.light.total) {
		bits.push(room.light.count === 0
			? t('home_scene.desc_no_lights', 'No lights on out of {{total}}.', { total: formatNumber(room.light.total) })
			: t('home_scene.desc_lights_on', '{{on}} of {{total}} lights on.', { on: formatNumber(room.light.count), total: formatNumber(room.light.total) }));
	}
	// The climate label is a number and the house's own unit. Neither is copy.
	if (room.climate) bits.push(`${room.climate.label}.`);
	if (room.security) {
		const open = room.security.unlocked.length + room.security.open.length;
		bits.push(room.security.secure
			? t('home_scene.desc_secure', 'Everything here is closed and locked.')
			: t('home_scene.desc_open', '{{count}} open or unlocked.', { count: formatNumber(open) }));
	}
	// Plural through the catalog, never through a ternary on an English suffix:
	// most locales do not form a plural by adding an s, and several need forms
	// English has no word for.
	bits.push(plural('home_scene.desc_devices', room.entityCount, '{{count}} device.', '{{count}} devices.'));
	return bits.join(' ');
}

function focusRoom(roomId) {
	if (!state.model) return;
	state.model = { ...state.model, focusRoomId: roomId };
	state.renderer?.focusRoom?.(roomId);
	// The rail is rebuilt rather than patched, because the focused room now owns
	// a device list and moving that list is a structural change. The keyboard is
	// put back on the room that was just chosen: rebuilding under someone's
	// fingers and dropping focus to the document is the classic way an otherwise
	// correct list becomes unusable without a mouse.
	const hadFocus = el.rooms.contains(document.activeElement);
	renderRooms(state.model);
	if (hadFocus) el.rooms.querySelector(`.hs-room[data-room-id="${cssEscape(roomId)}"]`)?.focus();
	const room = state.model.rooms.find((r) => r.id === roomId);
	if (room) announce(t('home_scene.said_room', '{{name}}. {{description}}', { name: room.name, description: describeRoom(room) }));
}

/**
 * One room's devices, as buttons that select and buttons that act.
 *
 * Selecting is separated from acting deliberately: the first press moves the
 * inspector to that device and says what it is, and only the explicit action
 * button next to it moves anything physical. On a phone that also means a
 * stray tap on a device name can never open a door.
 */
function renderRoomDevices(room, id) {
	const list = document.createElement('ul');
	list.className = 'hs-room-devices';
	list.id = id;
	for (const object of room.objects) {
		const li = document.createElement('li');
		const pick = document.createElement('button');
		pick.type = 'button';
		pick.className = 'hs-room-device';
		pick.dataset.entityId = object.entityId;
		const selected = state.selected?.entityId === object.entityId;
		pick.setAttribute('aria-current', String(selected));
		const name = document.createElement('span');
		name.className = 'hs-room-device-name';
		name.textContent = object.name;
		const value = document.createElement('span');
		value.className = 'hs-room-device-state';
		value.textContent = object.available ? String(object.state) : t('home_scene.unreachable', 'unreachable');
		pick.append(name, value);
		pick.addEventListener('click', () => selectEntity(object.entityId, object));
		li.appendChild(pick);
		list.appendChild(li);
	}
	return list;
}

/** One selection path for the canvas, the rail and the 2D house. */
function selectEntity(entityId, object) {
	state.selected = entityId ? { entityId, object } : null;
	state.renderer?.select?.(entityId);
	for (const button of el.rooms.querySelectorAll('.hs-room-device')) {
		button.setAttribute('aria-current', String(button.dataset.entityId === entityId));
	}
	renderInspector();
	if (object) {
		announce(t(
			'home_scene.said_device',
			'{{name}}. {{state}} Its controls are in the device panel.',
			{
				name: object.name,
				state: object.available
					? t('home_scene.currently', 'Currently {{state}}.', { state: object.state })
					: t('home_scene.unreachable_sentence', 'Unreachable.'),
			},
		));
	}
}

// ── inspector ────────────────────────────────────────────────────────────────

function renderInspector() {
	const selection = state.selected;
	if (!selection) {
		el.inspector.hidden = true;
		el.panelEmpty.hidden = false;
		renderLog();
		return;
	}
	const object = findObject(selection.entityId) || selection.object;
	if (!object) {
		el.inspector.hidden = true;
		el.panelEmpty.hidden = false;
		return;
	}
	el.panelEmpty.hidden = true;
	el.inspector.hidden = false;
	el.inspector.innerHTML = '';

	const name = document.createElement('h2');
	name.className = 'hs-entity-name';
	name.textContent = object.name;
	el.inspector.appendChild(name);

	const id = document.createElement('p');
	id.className = 'hs-entity-id';
	id.textContent = object.entityId;
	el.inspector.appendChild(id);

	const stateLine = document.createElement('p');
	stateLine.className = 'hs-entity-state';
	stateLine.textContent = object.available
		? t('home_scene.currently', 'Currently {{state}}.', { state: object.state })
		: t('home_scene.device_unreachable', 'Home Assistant cannot reach this device right now.');
	el.inspector.appendChild(stateLine);

	const attrs = describeAttributes(object);
	if (attrs.length) {
		const dl = document.createElement('dl');
		dl.className = 'hs-entity-attrs';
		for (const [key, value] of attrs) {
			const dt = document.createElement('dt');
			dt.textContent = key;
			const dd = document.createElement('dd');
			dd.textContent = value;
			dl.append(dt, dd);
		}
		el.inspector.appendChild(dl);
	}

	const actions = actionsFor(object);
	if (actions.length && object.available) {
		const row = document.createElement('div');
		row.className = 'hs-actions';
		for (const action of actions) {
			const button = document.createElement('button');
			button.type = 'button';
			button.className = action.risky ? 'hs-btn hs-btn--danger' : 'hs-btn';
			button.textContent = state.busy.has(object.entityId) ? t('home_scene.working', 'Working') : action.label;
			button.disabled = state.busy.has(object.entityId);
			button.addEventListener('click', () =>
				act({ entityId: object.entityId, domain: action.domain, service: action.service, name: object.name, roomId: roomOf(object.entityId)?.id }),
			);
			row.appendChild(button);
		}
		el.inspector.appendChild(row);
	}
	renderLog();
}

function describeAttributes(object) {
	const out = [];
	const a = object.attributes || {};
	if (Number.isFinite(Number(a.brightness))) out.push([t('home_scene.attr_brightness', 'Brightness'), percent(Math.round((Number(a.brightness) / 255) * 100))]);
	if (Array.isArray(a.rgb_color)) out.push([t('home_scene.attr_colour', 'Colour'), `rgb(${a.rgb_color.join(', ')})`]);
	if (Number.isFinite(Number(a.current_position))) out.push([t('home_scene.attr_open', 'Open'), percent(Number(a.current_position))]);
	// The unit the house reports, not the one the browser's locale would guess.
	const unit = state.model?.temperatureUnit || '°';
	if (Number.isFinite(Number(a.current_temperature))) out.push([t('home_scene.attr_now', 'Now'), `${formatNumber(a.current_temperature)}${unit}`]);
	if (Number.isFinite(Number(a.temperature))) out.push([t('home_scene.attr_set_to', 'Set to'), `${formatNumber(a.temperature)}${unit}`]);
	if (a.device_class) out.push([t('home_scene.attr_class', 'Class'), String(a.device_class)]);
	// The track title is the media's own name, never ours to translate.
	if (a.media_title) out.push([t('home_scene.attr_playing', 'Playing'), String(a.media_title)]);
	return out.slice(0, 6);
}

function actionsFor(object) {
	const on = object.activity > 0.02;
	switch (object.domain) {
		case 'light':
		case 'switch':
		case 'fan':
			return [on
				? { domain: object.domain, service: 'turn_off', label: t('home_scene.act_turn_off', 'Turn off') }
				: { domain: object.domain, service: 'turn_on', label: t('home_scene.act_turn_on', 'Turn on') }];
		case 'lock':
			return on
				? [{ domain: 'lock', service: 'lock', label: t('home_scene.act_lock', 'Lock') }]
				: [{ domain: 'lock', service: 'unlock', label: t('home_scene.act_unlock', 'Unlock'), risky: true }];
		case 'cover':
			return on
				? [{ domain: 'cover', service: 'close_cover', label: t('home_scene.act_close', 'Close') }]
				: [{ domain: 'cover', service: 'open_cover', label: t('home_scene.act_open', 'Open'), risky: true }];
		case 'media_player':
			return [on
				? { domain: 'media_player', service: 'media_pause', label: t('home_scene.act_pause', 'Pause') }
				: { domain: 'media_player', service: 'media_play', label: t('home_scene.act_play', 'Play') }];
		case 'vacuum':
			return [on
				? { domain: 'vacuum', service: 'return_to_base', label: t('home_scene.act_send_home', 'Send home') }
				: { domain: 'vacuum', service: 'start', label: t('home_scene.act_start', 'Start') }];
		case 'alarm_control_panel':
			return on
				? [{ domain: 'alarm_control_panel', service: 'alarm_disarm', label: t('home_scene.act_disarm', 'Disarm'), risky: true }]
				: [{ domain: 'alarm_control_panel', service: 'alarm_arm_away', label: t('home_scene.act_arm', 'Arm') }];
		default:
			return [];
	}
}

// ── acting ───────────────────────────────────────────────────────────────────

async function act(request, { confirmed = false, remember = false } = {}) {
	const room = request.roomId ? state.model?.rooms.find((r) => r.id === request.roomId) : roomOf(request.entityId);
	state.busy.add(request.entityId);
	state.renderer?.setBusy?.([...state.busy]);
	state.renderer?.setActing?.({ roomId: room?.id || null, entityId: request.entityId });
	renderInspector();

	try {
		if (confirmed && remember) {
			await grantEntity(state.homeId, { entityId: request.entityId, expiresAt: null });
		}
		await callService(state.homeId, {
			domain: request.domain,
			service: request.service,
			data: { entity_id: request.entityId },
			confirmed,
		});
		dismissConfirm();
		pushLog({ text: t('home_scene.log_entry', '{{action}} {{name}}', { action: serviceLabel(request.service), name: request.name }), outcome: 'ok' });
		announce(t('home_scene.act_done', '{{name}}: {{action}}.', { name: request.name, action: serviceLabel(request.service) }));
	} catch (err) {
		if (err instanceof HomeApiError && err.code === 'needs_confirmation') {
			// The gate fired. Ask, next to the thing it would move.
			state.pending = { request, message: err.message, risk: err.pending?.risk || 'physical', entityId: err.pending?.entityId || request.entityId };
			pushLog({ text: t('home_scene.log_entry', '{{action}} {{name}}', { action: serviceLabel(request.service), name: request.name }), outcome: 'refused' });
			// Where the keyboard was when the gate fired. Cancelling or pressing
			// Escape puts it back there, so a keyboard user is returned to the
			// control they pressed instead of to the top of the document.
			state.confirmReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
			renderConfirm();
		} else {
			pushLog({ text: t('home_scene.log_entry', '{{action}} {{name}}', { action: serviceLabel(request.service), name: request.name }), outcome: 'failed' });
			announce(err.message || t('home_scene.act_failed', 'That did not work.'));
			showToastError(err);
		}
	} finally {
		state.busy.delete(request.entityId);
		state.renderer?.setBusy?.([...state.busy]);
		renderInspector();
	}
}

/**
 * The confirmation lives on top of the thing it would move, not in a toast in
 * the corner. A person being asked "unlock the front door?" has to be able to
 * see WHICH door without reading an entity id.
 */
function renderConfirm() {
	dismissConfirm();
	const pending = state.pending;
	if (!pending) return;

	const card = document.createElement('div');
	card.className = 'hs-confirm';
	card.setAttribute('role', 'alertdialog');
	card.setAttribute('aria-modal', 'false');
	card.setAttribute('aria-label', t('home_scene.confirm_aria', 'Confirm this action'));
	// A screen reader reads an alertdialog's own description when focus lands
	// inside it, and the description is these three paragraphs in order: the
	// risk band, the question, and the reason the gate stopped it.
	const cardId = `hs-confirm-${Date.now().toString(36)}`;
	card.setAttribute('aria-describedby', `${cardId}-risk ${cardId}-q ${cardId}-why`);

	const risk = document.createElement('p');
	risk.className = 'hs-confirm-risk';
	risk.id = `${cardId}-risk`;
	risk.textContent = pending.risk === 'security'
		? t('home_scene.risk_security', 'Opens your home')
		: t('home_scene.risk_physical', 'Moves something physical');
	card.appendChild(risk);

	const text = document.createElement('p');
	text.className = 'hs-confirm-text';
	text.id = `${cardId}-q`;
	const object = findObject(pending.entityId);
	// The question, with the user's own name for the thing interpolated in.
	text.textContent = t('home_scene.confirm_question', '{{action}} {{name}}?', {
		action: serviceLabel(pending.request.service),
		name: object?.name || pending.request.name,
	});
	card.appendChild(text);

	const why = document.createElement('p');
	why.className = 'hs-confirm-text';
	why.id = `${cardId}-why`;
	why.style.color = 'var(--ink-dim)';
	why.textContent = pending.message;
	card.appendChild(why);

	const row = document.createElement('div');
	row.className = 'hs-confirm-row';
	const yes = document.createElement('button');
	yes.type = 'button';
	yes.className = 'hs-btn hs-btn--primary';
	yes.textContent = t('home_scene.confirm_yes', 'Yes, do it');
	yes.addEventListener('click', () => {
		const remember = card.querySelector('input')?.checked;
		const request = pending.request;
		state.pending = null;
		// Answering yes hands the keyboard back to the control that asked, so the
		// next Tab continues from the device rather than from the document head.
		const back = state.confirmReturn;
		state.confirmReturn = null;
		act(request, { confirmed: true, remember });
		if (back?.isConnected) back.focus();
	});
	const no = document.createElement('button');
	no.type = 'button';
	no.className = 'hs-btn';
	no.textContent = t('home_scene.confirm_no', 'Cancel');
	no.addEventListener('click', () => {
		state.pending = null;
		dismissConfirm({ restoreFocus: true });
		announce(t('home_scene.cancelled', 'Cancelled. Nothing moved.'));
	});
	row.append(yes, no);
	card.appendChild(row);

	const rememberLabel = document.createElement('label');
	rememberLabel.className = 'hs-confirm-remember';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	rememberLabel.append(checkbox, document.createTextNode(t('home_scene.confirm_remember', 'Do not ask again for {{name}}', {
		name: object?.name || t('home_scene.this_device', 'this device'),
	})));
	card.appendChild(rememberLabel);

	el.stage.appendChild(card);
	state.confirmCard = card;
	// Measured after insertion: the clamp needs the card's real height.
	repositionConfirm();
	requestAnimationFrame(repositionConfirm);
	yes.focus();
	// Assertive, and self-contained: a reader that lands on the Yes button hears
	// the button, not the question, so the question is said in full here.
	alertAssertive(t(
		'home_scene.confirm_spoken',
		'{{risk}}. {{question}} {{why}} Answer with the Yes or Cancel button, or press Escape to cancel.',
		{ risk: risk.textContent, question: text.textContent, why: pending.message },
	));
}

/**
 * Pin the confirmation to the thing it would move.
 *
 * The card grows upward from its anchor, so both axes are clamped to what is
 * actually on screen: an anchor near the top of the stage would otherwise put
 * the question, and the word "unlock" in it, above the visible area.
 */
function repositionConfirm() {
	const card = state.confirmCard;
	if (!card || !state.pending) return;
	const rect = el.stage.getBoundingClientRect();
	const scroll = el.stage.scrollTop;
	const height = card.offsetHeight || 190;
	const halfWidth = card.offsetWidth ? card.offsetWidth / 2 : 160;
	const minTop = scroll + height + 12;
	const maxTop = scroll + rect.height - 12;

	const point = state.renderer?.project?.(state.pending.entityId);
	let left = rect.width / 2;
	let top = scroll + rect.height / 2;
	if (point && point.visible) {
		left = point.x;
		top = point.y - 18;
	} else {
		// The 2D house and an off-screen object both anchor to the row instead.
		const row = el.stage.querySelector(`[data-entity-id="${cssEscape(state.pending.entityId)}"]`);
		if (row) {
			const r = row.getBoundingClientRect();
			left = r.left - rect.left + r.width / 2;
			top = r.top - rect.top + scroll - 6;
		}
	}
	card.style.left = `${clamp(left, halfWidth + 8, rect.width - halfWidth - 8)}px`;
	card.style.top = `${clamp(top, minTop, Math.max(minTop, maxTop))}px`;
}

function dismissConfirm({ restoreFocus = false } = {}) {
	const had = Boolean(state.confirmCard);
	state.confirmCard?.remove();
	state.confirmCard = null;
	// Leaving the question standing in an assertive region means the next
	// unrelated announcement is read after a stale "unlock the front door?".
	if (had) writeLive(el.alert, '');
	// Only a dismissal that ENDS the question gives the keyboard back. Re-rendering
	// the card (a second event for the same device) dismisses and rebuilds it, and
	// must leave the return target exactly where act() put it.
	if (!restoreFocus) return;
	const back = state.confirmReturn;
	state.confirmReturn = null;
	if (back?.isConnected) back.focus();
}

function onKeydown(event) {
	if (event.key === 'Escape' && state.pending) {
		state.pending = null;
		dismissConfirm({ restoreFocus: true });
		announce(t('home_scene.cancelled', 'Cancelled. Nothing moved.'));
	}
}

// ── the designed nothings ────────────────────────────────────────────────────

function renderEmptyStates(model) {
	if (model.empty) {
		showOverlay({
			title: t('home_scene.empty_title', 'Your home is connected, and empty'),
			body: t('home_scene.empty_body', 'Home Assistant answered, but it is not exposing any devices yet. Add an integration in Home Assistant (Settings, Devices and services), and this scene fills in as soon as the first device appears. Nothing else to do here.'),
			actions: [{ label: t('home_scene.empty_action', 'Add a device in Home Assistant'), href: integrationsUrl(), external: true, primary: true }],
		});
		return;
	}
	if (model.needsLayout) {
		showOverlay({
			title: t('home_scene.unfiled_title', 'Nothing is in a room yet'),
			body: t('home_scene.unfiled_body', 'Every device in this house is unfiled, so they are all in one room below. Assign them to areas in Home Assistant (Settings, Areas and zones) or lay the house out here, and the scene splits into real rooms.'),
			actions: [
				{ label: t('home_scene.unfiled_action', 'Assign rooms in Home Assistant'), href: areasUrl(), external: true, primary: true },
			],
			dismissable: true,
		});
		return;
	}
	hideOverlay();
}

function showOverlay({ title, body, actions = [], dismissable = false }) {
	hideOverlay();
	const overlay = document.createElement('div');
	overlay.className = 'hs-overlay';
	const h = document.createElement('h2');
	h.textContent = title;
	const p = document.createElement('p');
	p.textContent = body;
	overlay.append(h, p);
	const row = document.createElement('div');
	row.className = 'hs-actions';
	for (const action of actions) {
		if (!action.href && !action.onClick) continue;
		const node = action.href ? document.createElement('a') : document.createElement('button');
		node.className = action.primary ? 'hs-btn hs-btn--primary' : 'hs-btn';
		node.textContent = action.label;
		if (action.href) {
			node.href = action.href;
			if (action.external) {
				node.target = '_blank';
				node.rel = 'noopener noreferrer';
			}
		} else {
			node.type = 'button';
			node.addEventListener('click', action.onClick);
		}
		row.appendChild(node);
	}
	if (dismissable) {
		const close = document.createElement('button');
		close.type = 'button';
		close.className = 'hs-btn';
		close.textContent = t('home_scene.overlay_dismiss', 'Show me the house anyway');
		close.addEventListener('click', hideOverlay);
		row.appendChild(close);
	}
	if (row.children.length) overlay.appendChild(row);
	el.stage.appendChild(overlay);
	state.overlay = overlay;
}

function hideOverlay() {
	state.overlay?.remove();
	state.overlay = null;
}

function renderFailure(err) {
	const code = err instanceof HomeApiError ? err.code : 'call_failed';
	const copy = {
		unauthorized: {
			title: t('home_scene.err_auth_title', 'Sign in to see this home'),
			body: t('home_scene.err_auth_body', 'A home belongs to the account that connected it. Sign in and this page opens straight onto your house.'),
			actions: [{ label: t('home_scene.sign_in', 'Sign in'), href: `/login?next=${encodeURIComponent(location.pathname)}`, primary: true }],
		},
		not_found: {
			title: t('home_scene.err_missing_title', 'That home is not here'),
			body: t('home_scene.err_missing_body', 'Either this home was removed, or it belongs to another account. Your connected homes are one click away.'),
			actions: [{ label: t('home_scene.your_homes', 'Your homes'), href: '/home', primary: true }],
		},
		auth: {
			title: t('home_scene.err_token_title', 'Home Assistant rejected the token'),
			body: t('home_scene.err_token_body', 'The long-lived access token this home was connected with no longer works. Create a new one in Home Assistant (your profile, Security) and reconnect.'),
			actions: [{ label: t('home_scene.err_token_action', 'Reconnect this home'), href: '/home', primary: true }],
		},
		unreachable: {
			title: t('home_scene.err_unreachable_title', 'Your home did not answer'),
			body: t('home_scene.err_unreachable_body', 'three.ws could not reach this Home Assistant. If it only exists on your home network, a public server cannot route to it: use your remote https URL, or run the three.ws add-on inside the network.'),
			actions: [{ label: t('home_scene.try_again', 'Try again'), onClick: () => reconnect(), primary: true }, { label: t('home_scene.connection_settings', 'Connection settings'), href: '/home' }],
		},
		not_connected: {
			title: t('home_scene.err_pending_title', 'Still opening the connection'),
			body: t('home_scene.err_pending_body', 'The link to your house is coming up, or was paused after repeated failures. Give it a moment and try again.'),
			actions: [{ label: t('home_scene.try_again', 'Try again'), onClick: () => reconnect(), primary: true }],
		},
	}[code] || {
		title: t('home_scene.err_generic_title', 'Something went wrong loading your home'),
		body: err?.message || t('home_scene.err_generic_body', 'The request failed. Trying again usually works; if it keeps failing, the connection settings will say why.'),
		actions: [{ label: t('home_scene.try_again', 'Try again'), onClick: () => reconnect(), primary: true }, { label: t('home_scene.connection_settings', 'Connection settings'), href: '/home' }],
	};
	setStatus('disconnected', t('home_scene.status_disconnected', 'Disconnected'), err?.message);
	showOverlay(copy);
	announce(copy.body);
}

function showToastError(err) {
	// A failed action is reported in the log and the live region rather than as
	// a modal: the house is still on screen and still usable.
	pushLog({ text: err?.message || t('home_scene.action_failed', 'Action failed'), outcome: 'failed' });
}

function renderAge() {
	const existing = el.stage.querySelector('.hs-age');
	if (!state.stale || !state.lastGraphAt) {
		existing?.remove();
		if (state.ageTimer) {
			clearInterval(state.ageTimer);
			state.ageTimer = 0;
		}
		return;
	}
	const node = existing || document.createElement('div');
	node.className = 'hs-age';
	const write = () => {
		node.textContent = t('home_scene.last_seen', 'Last seen {{ago}}. Showing the house as it was.', {
			ago: relativeAge(Date.now() - state.lastGraphAt),
		});
	};
	write();
	if (!existing) {
		el.stage.appendChild(node);
		state.ageTimer = setInterval(write, 1000);
	}
}

/**
 * "2 minutes ago", in the reader's language, through Intl.RelativeTimeFormat.
 *
 * Not three catalog keys with an English `s` suffix bolted on: that spelling of
 * a plural is wrong in most of the 84 locales this ships in, and several need
 * forms English has no word for. The platform already knows all of them.
 */
function relativeAge(ms) {
	const s = Math.max(0, Math.round(ms / 1000));
	const [value, unit] = s < 60 ? [s, 'second'] : s < 3600 ? [Math.round(s / 60), 'minute'] : [Math.round(s / 3600), 'hour'];
	try {
		return new Intl.RelativeTimeFormat(locale(), { numeric: 'always' }).format(-value, unit);
	} catch {
		return `${value} ${unit}${value === 1 ? '' : 's'} ago`;
	}
}

function pushLog(entry) {
	state.log.unshift({ ...entry, at: new Date() });
	// Bounded on purpose: a wall display left open overnight must not grow one
	// DOM node per action forever.
	state.log = state.log.slice(0, 20);
	renderLog();
}

function renderLog() {
	const existing = el.panel.querySelector('.hs-log');
	existing?.remove();
	if (!state.log.length) return;
	const list = document.createElement('ul');
	list.className = 'hs-log';
	for (const entry of state.log) {
		const li = document.createElement('li');
		if (entry.outcome !== 'ok') li.className = entry.outcome === 'refused' ? 'is-refused' : 'is-failed';
		const time = document.createElement('time');
		time.dateTime = entry.at.toISOString();
		// The site's locale, not the browser's: someone reading three.ws in
		// Japanese should not get a US clock because their OS is set that way.
		time.textContent = entry.at.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' });
		const text = document.createElement('span');
		text.textContent = entry.outcome === 'refused'
			? t('home_scene.log_needs_yes', '{{entry}} (needs your yes)', { entry: entry.text })
			: entry.text;
		li.append(time, text);
		list.appendChild(li);
	}
	el.panel.appendChild(list);
}

/**
 * Ordinary state changes, politely: a light that went on, a house that went
 * stale, a view that switched. A polite region waits for the reader to finish
 * whatever it is saying, which is right for narration and wrong for a question.
 *
 * Writing the same string twice is a no-op in every screen reader, so a repeat
 * (two lights refused for the same reason) is nudged into a different string
 * rather than swallowed.
 */
function announce(message) {
	writeLive(el.live, message);
}

/**
 * The guarded confirmation, assertively. This is the one message in the lane a
 * person must not be able to miss: it stands between them and an unlocked front
 * door, and a polite region can be queued behind a paragraph of room narration
 * for long enough that the card times out unanswered.
 */
function alertAssertive(message) {
	writeLive(el.alert, message);
}

function writeLive(node, message) {
	if (!node) return;
	const text = String(message || '');
	// An identical assignment changes no text node, and a live region only
	// announces a change. Clearing first makes the repeat a change again.
	if (node.textContent === text) node.textContent = '';
	node.textContent = text;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function homeIdFromPath() {
	// Both routes serve this page: /smart-home/:id is where the connect flow's
	// "Open" lands, and /home/:id is the campaign's own address for the scene.
	const match = location.pathname.match(/^\/(?:smart-)?home\/([0-9a-fA-F-]{36})/);
	if (match) return match[1];
	const query = new URLSearchParams(location.search).get('home');
	return query && /^[0-9a-fA-F-]{36}$/.test(query) ? query : null;
}

function preferredView() {
	// An explicit ?view= is a deliberate request for THIS visit: a link someone
	// shared, a bookmark, or the address a wall display is pinned to. It is more
	// specific than whatever this browser happens to remember, so it is read
	// first and wins. Reading storage first meant one visit that ever touched
	// the 2D button pinned every later ?view=3d link back to 2D, on a page whose
	// own toggle treats a ?view= parameter as a choice the person made.
	// It is deliberately not written back: a shared link should not overwrite
	// the preference this browser chose for itself.
	const asked = new URLSearchParams(location.search).get('view');
	if (asked === '2d' || asked === '3d' || asked === 'plan') return asked;
	try {
		const stored = localStorage.getItem(VIEW_KEY);
		if (stored === '2d' || stored === '3d') return stored;
	} catch {
		// Storage disabled: default to 3D and let the WebGL probe decide.
	}
	return '3d';
}

function findObject(entityId) {
	if (!state.model) return null;
	for (const room of state.model.rooms) {
		const found = room.objects.find((o) => o.entityId === entityId);
		if (found) return found;
	}
	return null;
}

function roomOf(entityId) {
	if (!state.model) return null;
	return state.model.rooms.find((room) => room.objects.some((o) => o.entityId === entityId)) || null;
}

/** Home Assistant's own areas screen, on this user's own instance. */
function areasUrl() {
	return state.home?.base_url ? `${state.home.base_url}/config/areas/dashboard` : null;
}

/** ...and the screen where a device gets added in the first place. */
function integrationsUrl() {
	return state.home?.base_url ? `${state.home.base_url}/config/integrations` : null;
}

/**
 * A Home Assistant service id as words: `open_cover` reads "open cover".
 *
 * Deliberately NOT a catalog key. The set of services is the union of what
 * 1,500 integrations expose in the user's own instance, so it is unbounded and
 * it is their house's vocabulary rather than our copy. Translating a guessed
 * subset of it and leaving the rest in English would read worse than leaving
 * the machine name legible everywhere.
 */
function serviceLabel(service) {
	return String(service || '').replace(/_/g, ' ');
}

/** A percentage in the reader's own locale, never `${n}%`. */
function percent(value) {
	try {
		return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(Number(value) / 100);
	} catch {
		return `${value}%`;
	}
}

function clamp(value, min, max) {
	return Math.min(max, Math.max(min, value));
}

function cssEscape(value) {
	return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}
