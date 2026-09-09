/**
 * The 2D house.
 *
 * Not a consolation prize. This is the accessibility path, the old-device path
 * and the "WebGL is blocked by policy" path, and it has to be able to do
 * everything the 3D scene can do: read the whole house and act on it. It reads
 * the SAME scene model, so a room that exists in one exists in the other and
 * the two cannot drift.
 *
 * It is also the automatic destination for a device that measurably cannot hold
 * a frame rate, which is why it is built to be genuinely good rather than
 * merely present.
 */

import { formatNumber, locale, plural, t } from './i18n-home.js';

/**
 * Domains a person can act on from here, and the two services each offers.
 *
 * The third slot is a catalog key, not a label: the label is resolved at render
 * time so switching language re-renders into the new one rather than keeping
 * whatever was current when this module was first evaluated.
 */
const CONTROLS = {
	light: { on: ['light', 'turn_on', 'act_turn_on', 'Turn on'], off: ['light', 'turn_off', 'act_turn_off', 'Turn off'] },
	switch: { on: ['switch', 'turn_on', 'act_turn_on', 'Turn on'], off: ['switch', 'turn_off', 'act_turn_off', 'Turn off'] },
	fan: { on: ['fan', 'turn_on', 'act_turn_on', 'Turn on'], off: ['fan', 'turn_off', 'act_turn_off', 'Turn off'] },
	lock: { on: ['lock', 'unlock', 'act_unlock', 'Unlock'], off: ['lock', 'lock', 'act_lock', 'Lock'] },
	cover: { on: ['cover', 'open_cover', 'act_open', 'Open'], off: ['cover', 'close_cover', 'act_close', 'Close'] },
	media_player: { on: ['media_player', 'media_play', 'act_play', 'Play'], off: ['media_player', 'media_pause', 'act_pause', 'Pause'] },
	vacuum: { on: ['vacuum', 'start', 'act_start', 'Start'], off: ['vacuum', 'return_to_base', 'act_send_home', 'Send home'] },
};

/**
 * @param {HTMLElement} container
 * @param {object} options
 * @param {(request: { entityId: string, domain: string, service: string, name: string, roomId: string }) => void} options.onAct
 * @param {(roomId: string) => void} [options.onFocusRoom]
 */
export function createHomeFallback(container, options = {}) {
	container.classList.add('hs-flat');
	container.innerHTML = '';
	const list = document.createElement('div');
	list.className = 'hs-flat-floors';
	container.appendChild(list);

	let model = null;
	let stale = false;
	let busy = new Set();

	function render() {
		if (!model) return;
		list.innerHTML = '';
		for (const floor of model.floors) {
			const section = document.createElement('section');
			section.className = 'hs-flat-floor';
			const heading = document.createElement('h2');
			heading.className = 'hs-flat-floor-name';
			heading.textContent = floor.name;
			section.appendChild(heading);

			const grid = document.createElement('div');
			grid.className = 'hs-flat-grid';
			for (const roomId of floor.roomIds) {
				const room = model.rooms.find((r) => r.id === roomId);
				if (room) grid.appendChild(roomCard(room));
			}
			section.appendChild(grid);
			list.appendChild(section);
		}
	}

	function roomCard(room) {
		const card = document.createElement('article');
		card.className = 'hs-card';
		card.dataset.roomId = room.id;
		if (stale) card.classList.add('is-stale');
		// The room's real light, as a real gradient: a dark room is dark here too.
		card.style.setProperty('--room-light', room.light.hex);
		card.style.setProperty('--room-glow', String(room.light.on ? Math.min(0.55, 0.12 + room.light.brightness * 0.4) : 0));

		const head = document.createElement('header');
		head.className = 'hs-card-head';
		const title = document.createElement('button');
		title.type = 'button';
		title.className = 'hs-card-title';
		title.textContent = room.name;
		title.addEventListener('click', () => options.onFocusRoom?.(room.id));
		head.appendChild(title);

		const meta = document.createElement('p');
		meta.className = 'hs-card-meta';
		const bits = [];
		bits.push(room.light.total
			? t('home_scene.flat_lights_on', '{{on}} of {{total}} lights on', { on: formatNumber(room.light.count), total: formatNumber(room.light.total) })
			: t('home_scene.flat_no_lights', 'no lights'));
		if (room.climate) {
			bits.push(plural(
				'home_scene.flat_from_sensors',
				room.climate.sources,
				'{{label}} from {{count}} sensor',
				'{{label}} from {{count}} sensors',
				{ label: room.climate.label },
			));
		}
		if (room.security) {
			bits.push(room.security.secure
				? t('home_scene.flat_secure', 'secure')
				: t('home_scene.flat_open_count', '{{count}} open', { count: formatNumber(room.security.unlocked.length + room.security.open.length) }));
		}
		meta.textContent = bits.join(' · ');
		head.appendChild(meta);
		card.appendChild(head);

		if (room.security && !room.security.secure) {
			const flag = document.createElement('p');
			flag.className = 'hs-card-flag';
			flag.textContent = describeOpen(room);
			card.appendChild(flag);
		}

		const items = document.createElement('ul');
		items.className = 'hs-card-items';
		for (const object of room.objects) items.appendChild(entityRow(object, room));
		card.appendChild(items);

		if (room.readouts.length) {
			const readouts = document.createElement('dl');
			readouts.className = 'hs-card-readouts';
			for (const readout of room.readouts) {
				const dt = document.createElement('dt');
				dt.textContent = readout.name;
				const dd = document.createElement('dd');
				dd.textContent = `${readout.value}${readout.unit ? ` ${readout.unit}` : ''}`;
				readouts.append(dt, dd);
			}
			card.appendChild(readouts);
		}

		if (room.hiddenCount) {
			const more = document.createElement('p');
			more.className = 'hs-card-more';
			more.textContent = plural('home_scene.flat_hidden', room.hiddenCount, '{{count}} more device in this room', '{{count}} more devices in this room');
			card.appendChild(more);
		}
		return card;
	}

	function entityRow(object, room) {
		const row = document.createElement('li');
		row.className = 'hs-item';
		row.dataset.entityId = object.entityId;
		if (!object.available) row.classList.add('is-unavailable');

		const dot = document.createElement('span');
		dot.className = 'hs-item-dot';
		dot.dataset.kind = object.kind;
		dot.style.setProperty('--dot', dotColor(object, room));
		dot.setAttribute('aria-hidden', 'true');
		row.appendChild(dot);

		const name = document.createElement('span');
		name.className = 'hs-item-name';
		name.textContent = object.name;
		row.appendChild(name);

		const state = document.createElement('span');
		state.className = 'hs-item-state';
		state.textContent = object.available ? readableState(object) : t('home_scene.unreachable', 'unreachable');
		row.appendChild(state);

		const control = CONTROLS[object.domain];
		if (control && object.available) {
			const active = object.activity > 0.02;
			const [domain, service, key, source] = active ? control.off : control.on;
			const label = t(`home_scene.${key}`, source);
			const button = document.createElement('button');
			button.type = 'button';
			button.className = 'hs-item-act';
			// Which control this is, in terms that survive the rebuild this list
			// does on every busy change. scene.js's restoreConfirmFocus finds the
			// replacement by these two attributes when the guarded confirmation
			// is answered and the node it was opened from has gone.
			button.dataset.actFor = object.entityId;
			button.dataset.actService = `${domain}.${service}`;
			button.textContent = busy.has(object.entityId) ? t('home_scene.working', 'Working') : label;
			button.disabled = busy.has(object.entityId);
			// The device's name and its room's name are the user's own words, so
			// they are interpolated rather than concatenated into a translatable
			// sentence: a catalog string with "Front Door" baked into it would be
			// machine-translated on the next run.
			button.setAttribute('aria-label', t('home_scene.act_aria', '{{action}} {{name}} in {{room}}', { action: label, name: object.name, room: room.name }));
			button.addEventListener('click', () => {
				options.onAct?.({ entityId: object.entityId, domain, service, name: object.name, roomId: room.id });
			});
			row.appendChild(button);
		}
		return row;
	}

	function dotColor(object, room) {
		if (!object.available) return 'rgba(224, 90, 74, 0.55)';
		if (object.domain === 'light') return object.activity > 0 ? room.light.hex : 'rgba(255,255,255,0.16)';
		if (object.domain === 'lock') return object.activity > 0.5 ? '#e05a4a' : '#2fbf71';
		if (object.domain === 'cover' || object.domain === 'binary_sensor') return object.activity > 0.02 ? '#e0a33a' : 'rgba(255,255,255,0.16)';
		return object.activity > 0.4 ? '#8fa6ff' : 'rgba(255,255,255,0.16)';
	}

	function readableState(object) {
		if (object.domain === 'cover') {
			const position = Number(object.attributes?.current_position);
			if (Number.isFinite(position)) {
				if (position === 0) return t('home_scene.state_closed', 'closed');
				if (position === 100) return t('home_scene.state_open', 'open');
				return t('home_scene.state_part_open', '{{percent}} open', { percent: percent(position) });
			}
		}
		if (object.domain === 'climate') {
			const current = Number(object.attributes?.current_temperature);
			// The house's own unit, straight off the model. A bare degree sign made
			// a thermostat unreadable: 21 and 70 are both plausible room
			// temperatures, and which one is comfortable depends entirely on the
			// symbol this line used to leave off.
			if (Number.isFinite(current)) return `${object.state} · ${current}${model?.temperatureUnit || '°'}`;
		}
		if (object.domain === 'light' && object.activity > 0) {
			const brightness = Number(object.attributes?.brightness);
			if (Number.isFinite(brightness)) {
				return t('home_scene.state_on_at', 'on · {{percent}}', { percent: percent(Math.round((brightness / 255) * 100)) });
			}
		}
		return String(object.state);
	}

	function describeOpen(room) {
		const names = [];
		for (const entityId of [...room.security.unlocked, ...room.security.open]) {
			const object = room.objects.find((o) => o.entityId === entityId);
			names.push(object ? object.name : entityId);
		}
		if (!names.length) return t('home_scene.something_open', 'Something in this room is open.');
		// The device names are the user's own and are joined with the reader's own
		// list separator; only the sentence around them is copy. English "is/are"
		// and the "and 2 more" tail are both catalog keys so a locale can put them
		// where its own grammar needs them.
		const shown = names.slice(0, 3);
		if (names.length > 3) shown.push(t('home_scene.n_more', '{{count}} more', { count: formatNumber(names.length - 3) }));
		const extra = listFormat(shown);
		return room.security.unlocked.length
			? plural('home_scene.is_unlocked', names.length, '{{names}} is unlocked.', '{{names}} are unlocked.', { names: extra })
			: plural('home_scene.is_open', names.length, '{{names}} is open.', '{{names}} are open.', { names: extra });
	}

	return {
		setModel(next) {
			model = next;
			render();
		},
		setStale(next) {
			stale = Boolean(next);
			container.classList.toggle('is-stale', stale);
			for (const card of list.querySelectorAll('.hs-card')) card.classList.toggle('is-stale', stale);
		},
		setBusy(entityIds) {
			busy = new Set(entityIds);
			render();
		},
		focusRoom(roomId) {
			const card = list.querySelector(`[data-room-id="${cssEscape(roomId)}"]`);
			// Someone who asked for less motion gets the card placed, not flown to.
			const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
			card?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
			card?.classList.add('is-focused');
			setTimeout(() => card?.classList.remove('is-focused'), 1800);
		},
		/** Same shape the WebGL scene exposes, so the page treats them alike. */
		setActing(next) {
			if (next?.roomId) this.focusRoom(next.roomId);
		},
		stats() {
			return { fps: 0, objects: model ? model.stats.drawn : 0, rooms: model ? model.rooms.length : 0, mode: '2d' };
		},
		dispose() {
			container.innerHTML = '';
			container.classList.remove('hs-flat');
		},
	};
}

/** A percentage in the reader's own locale, never `${n}%`. */
function percent(value) {
	try {
		return new Intl.NumberFormat(locale(), { style: 'percent', maximumFractionDigits: 0 }).format(Number(value) / 100);
	} catch {
		return `${value}%`;
	}
}

/** "a, b and c" in the reader's own language, never a hardcoded comma-and. */
function listFormat(items) {
	try {
		return new Intl.ListFormat(locale(), { style: 'long', type: 'conjunction' }).format(items);
	} catch {
		return items.join(', ');
	}
}

function cssEscape(value) {
	return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, '\\$&');
}

/**
 * Can this browser actually run the 3D scene? Asked once, answered honestly:
 * a context that fails to create, a software rasterizer, or a device the caller
 * already measured as too slow all route to the 2D house rather than to a black
 * canvas with a spinner over it.
 */
export function webglAvailable() {
	if (typeof document === 'undefined') return false;
	try {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
		if (!gl) return false;
		const lose = gl.getExtension('WEBGL_lose_context');
		lose?.loseContext();
		return true;
	} catch {
		return false;
	}
}
