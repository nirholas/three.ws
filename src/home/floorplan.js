/**
 * The floorplan editor: a top-down plan of the house that the 3D scene follows.
 *
 * Home Assistant knows which room a device is in and has no idea where that room
 * is, so the scene ships a default grid and this is where a person turns it into
 * their actual house. Top-down and 2D on purpose: nobody arranges a floorplan in
 * perspective, and the 3D view is the reward rather than the workspace.
 *
 * The most valuable control here is the tray. Dragging an unfiled device into a
 * room writes the area into the user's own Home Assistant registry, so the work
 * improves their dashboards, their voice assistant and their automations, not
 * just our picture of the house. That is also the fix for the most common real
 * house we see: one where nothing is assigned to an area at all.
 *
 * States 1 to 9 of order 07 all live here; each is a branch of render().
 */

import { assignEntityArea, clearLayout, createArea, getLayout, HomeApiError, saveLayout } from './api.js';
import { clear, el, noticeEl } from './connect.js';
// Every string a person reads in this editor goes through here. Room names and
// device names never do: they are the user's own words, interpolated as values
// so the translation model only ever sees {{name}}. See i18n-home.js.
import { formatNumber, plural, t } from './i18n-home.js';

/** Metres per grid square. Matches the scene's CELL so the two read alike. */
const GRID_M = 1.2;
/** Default room footprint in metres, matching scene-model.js CELL - ROOM_GAP. */
const DEFAULT_SIZE = 5.7;
/** Pixels per metre at rest. The view scales to fit, this is the starting point. */
const PX_PER_M = 14;
/** A room smaller than this cannot hold its own label. Mirrors the server cap. */
const MIN_SIZE = 1.5;
const MAX_SIZE = 60;
/** Mirrors the server. A refusal here should never be the first the user hears. */
const MAX_COORD = 500;
/** Undo depth. Deep enough to recover an afternoon, bounded so a tab stays small. */
const HISTORY_MAX = 100;

/**
 * @param {object} options
 * @param {HTMLElement} options.mount
 * @param {string} options.homeId
 * @param {object} options.graph the room graph, for room names and the tray
 * @param {boolean} options.canEdit false for a member without the layout capability
 * @param {(layout: object|null) => void} [options.onChange] fires on every applied edit
 */
export function mountFloorplan({ mount, homeId, graph, canEdit = true, onChange }) {
	const state = {
		version: 0,
		rooms: new Map(),
		orphaned: [],
		unplaced: [],
		loading: true,
		saving: false,
		error: null,
		notice: null,
		conflict: null,
		/** The new-room form, when it is open. `{ error }` while it is. */
		naming: null,
		creating: false,
		selected: null,
		history: [],
		future: [],
		unreadable: null,
	};

	const view = el('div', 'hm-plan');
	mount.append(view);

	load();
	return {
		destroy: () => view.remove(),
		reload: load,
		/**
		 * The house changed under us, so redraw the tray from the new graph.
		 *
		 * Filing a device and making a room both write Home Assistant's own
		 * registry, and neither produces a state event that would correct a tray
		 * built from the old graph. The scene re-reads the house and hands the
		 * result back here.
		 */
		setGraph(next) {
			if (!next) return;
			graph = next;
			render();
		},
	};

	async function load() {
		state.loading = true;
		render();
		try {
			const res = await getLayout(homeId);
			state.version = res.version || 0;
			state.rooms = new Map(Object.entries(res.layout?.rooms || {}));
			state.orphaned = res.orphaned || [];
			state.unplaced = res.unplaced || [];
			state.unreadable = res.unreadable || null;
			state.error = null;
		} catch (err) {
			state.error = describeError(err);
		} finally {
			state.loading = false;
			render();
		}
	}

	// ---- editing -----------------------------------------------------------

	/** Every mutation goes through here, so undo is complete by construction. */
	function apply(mutate, { label } = {}) {
		const before = serialize();
		mutate();
		const after = serialize();
		if (before === after) return;
		state.history.push(before);
		if (state.history.length > HISTORY_MAX) state.history.shift();
		state.future.length = 0;
		state.notice = label ? { tone: 'info', title: label } : null;
		render();
		onChange?.(toDocument());
	}

	function undo() {
		if (!state.history.length) return;
		state.future.push(serialize());
		restore(state.history.pop());
	}

	function redo() {
		if (!state.future.length) return;
		state.history.push(serialize());
		restore(state.future.pop());
	}

	function restore(snapshot) {
		state.rooms = new Map(Object.entries(JSON.parse(snapshot)));
		state.notice = null;
		render();
		onChange?.(toDocument());
	}

	function serialize() {
		return JSON.stringify(Object.fromEntries(state.rooms));
	}

	function toDocument() {
		if (!state.rooms.size) return null;
		return { format: 1, units: 'm', rooms: Object.fromEntries(state.rooms) };
	}

	/** Place a room that has never been placed, in the first free grid slot. */
	function placeRoom(roomId) {
		apply(() => {
			state.rooms.set(roomId, { ...firstFreeSlot(), w: DEFAULT_SIZE, d: DEFAULT_SIZE });
			state.unplaced = state.unplaced.filter((id) => id !== roomId);
			state.selected = roomId;
		}, { label: `${nameOf(roomId)} placed` });
	}

	function removeRoom(roomId) {
		apply(() => {
			state.rooms.delete(roomId);
			if (!state.unplaced.includes(roomId) && liveRoomIds().includes(roomId)) state.unplaced.push(roomId);
			if (state.selected === roomId) state.selected = null;
		}, { label: `${nameOf(roomId)} removed from the plan` });
	}

	function moveRoom(roomId, x, z) {
		const room = state.rooms.get(roomId);
		if (!room) return;
		const snapped = { x: snap(clampCoord(x)), z: snap(clampCoord(z)) };
		if (overlapsAny(roomId, { ...room, ...snapped })) return;
		apply(() => state.rooms.set(roomId, { ...room, ...snapped }));
	}

	function resizeRoom(roomId, w, d) {
		const room = state.rooms.get(roomId);
		if (!room) return;
		const next = { ...room, w: clampSize(snap(w)), d: clampSize(snap(d)) };
		if (overlapsAny(roomId, next)) return;
		apply(() => state.rooms.set(roomId, next));
	}

	/**
	 * Overlap is prevented while dragging rather than validated afterwards. A
	 * plan that can enter an invalid state and then refuse to save is a plan that
	 * loses somebody's work.
	 */
	function overlapsAny(roomId, box) {
		for (const [id, other] of state.rooms) {
			if (id === roomId) continue;
			if (boxesOverlap(box, other)) return true;
		}
		return false;
	}

	function firstFreeSlot() {
		for (let ring = 0; ring < 24; ring += 1) {
			for (let dx = -ring; dx <= ring; dx += 1) {
				for (let dz = -ring; dz <= ring; dz += 1) {
					if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
					const box = { x: dx * (DEFAULT_SIZE + 1.5), z: dz * (DEFAULT_SIZE + 1.5), w: DEFAULT_SIZE, d: DEFAULT_SIZE };
					if (!overlapsAny(null, box)) return { x: box.x, z: box.z };
				}
			}
		}
		return { x: 0, z: 0 };
	}

	// ---- saving ------------------------------------------------------------

	async function save() {
		if (state.saving) return;
		state.saving = true;
		state.conflict = null;
		render();
		try {
			const res = await saveLayout(homeId, { version: state.version, layout: toDocument() ?? { rooms: {} } });
			state.version = res.version;
			state.orphaned = res.orphaned || [];
			state.unplaced = res.unplaced || [];
			state.notice = {
				tone: 'ok',
				title: t('home_floorplan.saved_title', 'Floorplan saved'),
				body: t('home_floorplan.saved_body', 'Your 3D home follows this plan now.'),
			};
			state.history.length = 0;
			state.future.length = 0;
		} catch (err) {
			if (err instanceof HomeApiError && err.code === 'layout_conflict') {
				// State 5. Never a silent overwrite and never a lost edit: both
				// documents are held and the person chooses.
				state.conflict = { mine: toDocument(), theirs: err.current };
			} else {
				state.error = describeError(err);
			}
		} finally {
			state.saving = false;
			render();
		}
	}

	function keepMine() {
		const theirs = state.conflict?.theirs;
		state.version = theirs?.version ?? state.version;
		state.conflict = null;
		save();
	}

	function takeTheirs() {
		const theirs = state.conflict?.theirs;
		if (!theirs) return;
		state.version = theirs.version;
		state.rooms = new Map(Object.entries(theirs.layout?.rooms || {}));
		state.conflict = null;
		state.history.length = 0;
		state.future.length = 0;
		state.notice = {
			tone: 'info',
			title: t('home_floorplan.took_theirs_title', 'Loaded the other version'),
			body: t('home_floorplan.took_theirs_body', 'Your changes were not saved. Redraw and save again if you still want them.'),
		};
		render();
		onChange?.(toDocument());
	}

	async function resetPlan() {
		state.saving = true;
		render();
		try {
			const res = await clearLayout(homeId);
			state.version = res.version || 0;
			state.rooms = new Map();
			state.unplaced = res.unplaced || liveRoomIds();
			state.orphaned = [];
			state.history.length = 0;
			state.future.length = 0;
			state.notice = {
				tone: 'info',
				title: t('home_floorplan.reset_title', 'Back to the default arrangement'),
				body: t('home_floorplan.reset_body', 'Rooms pack into a grid per floor until you draw a plan again.'),
			};
		} catch (err) {
			state.error = describeError(err);
		} finally {
			state.saving = false;
			render();
			onChange?.(null);
		}
	}

	/**
	 * Drop an unfiled device into a room. This is a write to Home Assistant, not
	 * to us, so it is confirmed by re-reading the graph rather than assumed.
	 */
	async function fileEntity(entityId, areaId) {
		try {
			await assignEntityArea(homeId, { entityId, areaId });
			state.notice = {
				tone: 'ok',
				// Both names are the house's own: the entity id and the room the
				// user named. Interpolated, never part of the source string.
				title: t('home_floorplan.filed_title', '{{device}} is in {{room}} now', { device: entityId, room: nameOf(areaId) }),
				body: t('home_floorplan.filed_body', 'That was written to your Home Assistant, so it shows up in your dashboards and voice assistant too.'),
			};
			onChange?.(toDocument(), { refreshGraph: true });
		} catch (err) {
			// State 9: the local plan is untouched and the failure is named. A
			// YAML entity has no registry entry and cannot be filed, which is
			// common and needs a sentence rather than a stack trace.
			state.notice = { tone: 'error', title: t('home_floorplan.file_failed', 'Could not file that device'), body: describeError(err).body };
		}
		render();
	}

	/**
	 * Make a room that does not exist yet, in Home Assistant, and place it.
	 *
	 * State 2: a house where nothing has ever been assigned to an area. Without
	 * this the tray offers one synthetic "Everything" bucket, filing has nowhere
	 * to file to, and the only advice we can give is "go and use Home Assistant's
	 * settings first", which is a chore that loses the person. The room is
	 * created in their own registry, so it reaches their dashboards and voice
	 * assistant too, exactly like filing a device does.
	 */
	async function createRoom(name) {
		if (state.creating) return;
		const thenFile = state.naming?.thenFile || null;
		state.creating = true;
		state.naming = { error: null, thenFile, value: name };
		render();
		try {
			const res = await createArea(homeId, { name });
			const area = res?.area;
			if (!area?.id) throw new Error('Home Assistant did not name the new room.');

			// Teach the local graph about it immediately, so nameOf, the file menu
			// and liveRoomIds all work before the refreshed graph comes back. The
			// authoritative copy arrives through setGraph a moment later.
			graph = { ...(graph || {}), rooms: [...(graph?.rooms || []), { id: area.id, name: area.name, entities: [] }] };

			state.naming = null;
			state.creating = false;
			placeRoom(area.id);
			state.notice = area.created
				? {
					tone: 'ok',
					title: t('home_floorplan.room_made_title', '{{room}} is a room in your home now', { room: area.name }),
					body: t('home_floorplan.room_made_body', 'It was made in your Home Assistant, so you can file devices into it here and use it there.'),
				}
				: {
					tone: 'info',
					title: t('home_floorplan.room_existed_title', '{{room}} already existed', { room: area.name }),
					body: t('home_floorplan.room_existed_body', 'It is on the plan now.'),
				};
			render();
			onChange?.(toDocument(), { refreshGraph: true });

			// The room was made in order to hold this device, so finish the job
			// rather than handing back a form and making them find it again.
			if (thenFile) await fileEntity(thenFile, area.id);
		} catch (err) {
			// The form stays open holding what they typed, and still remembers the
			// device it was opened for: a name that was refused is a name to fix,
			// not a reason to start over and go and find the device again.
			state.creating = false;
			state.naming = { error: describeError(err).body, thenFile, value: name };
			render();
		}
	}

	// ---- rendering ---------------------------------------------------------

	function render() {
		clear(view);

		if (state.loading) return view.append(skeleton());
		if (state.error) return view.append(noticeEl({ tone: 'error', ...state.error, action: { label: t('home_floorplan.try_again', 'Try again'), onClick: load } }));

		if (state.unreadable) {
			view.append(noticeEl({
				tone: 'error',
				title: t('home_floorplan.unreadable_title', 'This floorplan could not be read'),
				body: t('home_floorplan.unreadable_body', '{{reason}} The 3D home is using its default arrangement. Drawing and saving replaces the stored plan.', { reason: state.unreadable }),
			}));
		}
		if (state.notice) view.append(noticeEl(state.notice));
		if (state.conflict) view.append(conflictPanel());
		if (state.naming && canEdit) view.append(namingForm());

		view.append(toolbar());
		view.append(canvas());
		view.append(tray());
	}

	function toolbar() {
		const bar = el('div', 'hm-plan-toolbar');
		bar.setAttribute('role', 'toolbar');
		bar.setAttribute('aria-label', t('home_floorplan.toolbar_aria', 'Floorplan'));

		if (!canEdit) {
			// State 8: read only. The plan is still worth seeing.
			bar.append(el('p', 'hm-plan-readonly', t('home_floorplan.readonly', 'You can see this floorplan. Editing it needs the owner or an admin.')));
			return bar;
		}

		bar.append(button(t('home_floorplan.undo', 'Undo'), undo, { disabled: !state.history.length, key: 'Ctrl+Z' }));
		bar.append(button(t('home_floorplan.redo', 'Redo'), redo, { disabled: !state.future.length, key: 'Ctrl+Shift+Z' }));
		bar.append(button(t('home_floorplan.new_room', 'New room'), () => openNaming(), { disabled: state.creating }));
		const dirty = state.history.length > 0;
		bar.append(button(state.saving ? t('home_floorplan.saving', 'Saving') : t('home_floorplan.save', 'Save floorplan'), save, { primary: true, disabled: state.saving || !dirty }));
		bar.append(button(t('home_floorplan.reset', 'Reset to default'), resetPlan, { disabled: state.saving || !state.rooms.size }));

		// Two counts in one sentence, so it is one translatable string rather
		// than two fragments a translator cannot order for their own language.
		const count = el('span', 'hm-plan-count', t('home_floorplan.count', '{{placed}} placed, {{toPlace}} to place', {
			placed: formatNumber(state.rooms.size),
			toPlace: formatNumber(state.unplaced.length),
		}));
		count.setAttribute('aria-live', 'polite');
		bar.append(count);
		return bar;
	}

	/** Open the new-room form, optionally to hold a device that needs somewhere. */
	function openNaming(thenFile = null) {
		state.naming = { error: null, thenFile, value: '' };
		state.notice = null;
		render();
		view.querySelector('.hm-plan-naming input')?.focus();
	}

	/**
	 * Name a new room.
	 *
	 * A form rather than window.prompt: prompt cannot be styled, cannot show the
	 * error the server returned without a second dialog, blocks the whole tab,
	 * and is suppressed outright in some browsers. This is three elements and it
	 * behaves like the rest of the product.
	 */
	function namingForm() {
		const form = el('form', 'hm-plan-naming');
		form.setAttribute('aria-label', t('home_floorplan.naming_aria', 'Make a new room'));

		const id = `hm-plan-newroom-${Math.random().toString(36).slice(2, 8)}`;
		const label = el('label', null, state.naming.thenFile
			? t('home_floorplan.name_room_for', 'Name a room for {{device}}', { device: state.naming.thenFile })
			: t('home_floorplan.name_new_room', 'Name the new room'));
		label.htmlFor = id;
		form.append(label);

		const input = el('input', 'hm-plan-naming-input');
		input.id = id;
		input.type = 'text';
		input.maxLength = 64;
		input.required = true;
		input.autocomplete = 'off';
		// A placeholder is an example, so it is translated: a French reader is
		// shown a French room, not the English word for one.
		input.placeholder = t('home_floorplan.name_placeholder', 'Kitchen');
		// Survives the re-render a refusal causes, so the name is theirs to fix
		// rather than to retype.
		input.value = state.naming.value || '';
		input.addEventListener('input', () => { state.naming.value = input.value; });
		form.append(input);

		const actions = el('div', 'hm-plan-naming-actions');
		const submit = el('button', 'hm-plan-btn is-primary', state.creating ? t('home_floorplan.making', 'Making') : t('home_floorplan.make_this_room', 'Make this room'));
		submit.type = 'submit';
		submit.disabled = state.creating;
		actions.append(submit);

		const cancel = el('button', 'hm-plan-btn', t('home_floorplan.cancel', 'Cancel'));
		cancel.type = 'button';
		cancel.disabled = state.creating;
		cancel.addEventListener('click', () => { state.naming = null; render(); });
		actions.append(cancel);
		form.append(actions);

		if (state.naming.error) {
			const err = el('p', 'hm-plan-naming-error', state.naming.error);
			err.setAttribute('role', 'alert');
			form.append(err);
		}

		form.addEventListener('submit', (e) => {
			e.preventDefault();
			const name = input.value.trim();
			if (!name) {
				state.naming = { ...state.naming, error: t('home_floorplan.name_required', 'Give the room a name, like Kitchen.'), value: input.value };
				return render();
			}
			createRoom(name);
		});
		return form;
	}

	function conflictPanel() {
		const wrap = el('div', 'hm-plan-conflict');
		wrap.setAttribute('role', 'alertdialog');
		wrap.append(el('h3', null, t('home_floorplan.conflict_title', 'Someone else changed this floorplan')));
		wrap.append(el('p', null, t(
			'home_floorplan.conflict_body',
			'They saved version {{version}} while you were drawing. Nothing is lost yet: pick which one to keep.',
			{ version: state.conflict.theirs?.version === undefined ? '?' : formatNumber(state.conflict.theirs.version) },
		)));
		const actions = el('div', 'hm-plan-conflict-actions');
		actions.append(button(t('home_floorplan.keep_mine', 'Keep mine'), keepMine, { primary: true }));
		actions.append(button(t('home_floorplan.take_theirs', 'Take theirs'), takeTheirs));
		wrap.append(actions);
		return wrap;
	}

	function canvas() {
		const rooms = [...state.rooms.entries()];
		const bounds = planBounds(rooms);
		const wrap = el('div', 'hm-plan-canvas');
		wrap.tabIndex = 0;
		wrap.setAttribute('role', 'application');
		wrap.setAttribute('aria-label', t('home_floorplan.canvas_aria', 'Floorplan. Arrow keys move the selected room, plus and minus resize it.'));

		if (!rooms.length) {
			// States 1 and 2: nothing placed. Which message depends on whether the
			// house has areas at all, because those are different problems.
			const live = liveRoomIds();
			wrap.append(noticeEl(live.length
				? {
					tone: 'info',
					title: t('home_floorplan.empty_title', 'No plan yet'),
					body: t('home_floorplan.empty_body', 'Your 3D home is using a default grid. Place a room below to start drawing the real thing.'),
				}
				: {
					tone: 'info',
					title: t('home_floorplan.no_areas_title', 'Nothing is filed into a room yet'),
					body: t('home_floorplan.no_areas_body', 'Home Assistant has no areas for this house. Make a room below, then drag your devices into it: that writes the room into your Home Assistant, not just here.'),
				}));
			return wrap;
		}

		const surface = el('div', 'hm-plan-surface');
		surface.style.width = `${(bounds.w + 4) * PX_PER_M}px`;
		surface.style.height = `${(bounds.d + 4) * PX_PER_M}px`;

		for (const [id, room] of rooms) {
			surface.append(roomEl(id, room, bounds));
		}
		wrap.append(surface);
		wrap.addEventListener('keydown', onCanvasKey);
		return wrap;
	}

	function roomEl(id, room, bounds) {
		const orphan = state.orphaned.includes(id);
		const node = el('div', `hm-plan-room${state.selected === id ? ' is-selected' : ''}${orphan ? ' is-orphan' : ''}`);
		const w = room.w ?? DEFAULT_SIZE;
		const d = room.d ?? DEFAULT_SIZE;
		node.style.left = `${(room.x - w / 2 - bounds.minX + 2) * PX_PER_M}px`;
		node.style.top = `${(room.z - d / 2 - bounds.minZ + 2) * PX_PER_M}px`;
		node.style.width = `${w * PX_PER_M}px`;
		node.style.height = `${d * PX_PER_M}px`;
		node.tabIndex = 0;
		node.setAttribute('role', 'button');
		// The room's own name is the user's word, interpolated. The size is
		// formatted for the reader's locale, so 5,7 in French and 5.7 in English.
		node.setAttribute('aria-label', orphan
			? t('home_floorplan.room_aria_orphan', '{{room}}, {{w}} by {{d}} metres, no longer in this home', { room: nameOf(id), w: formatNumber(w), d: formatNumber(d) })
			: t('home_floorplan.room_aria', '{{room}}, {{w}} by {{d}} metres', { room: nameOf(id), w: formatNumber(w), d: formatNumber(d) }));
		node.setAttribute('aria-pressed', String(state.selected === id));

		node.append(el('span', 'hm-plan-room-name', nameOf(id)));
		node.append(el('span', 'hm-plan-room-size', t('home_floorplan.room_size', '{{w}} x {{d}} m', { w: formatNumber(w), d: formatNumber(d) })));

		if (orphan) {
			// State 6: the area was deleted in Home Assistant. Never crash, never
			// silently discard the rest of somebody's plan.
			const drop = el('button', 'hm-plan-room-drop', t('home_floorplan.remove', 'Remove'));
			drop.type = 'button';
			drop.setAttribute('aria-label', t('home_floorplan.remove_aria', 'Remove {{room}} from the plan', { room: nameOf(id) }));
			drop.addEventListener('click', (e) => { e.stopPropagation(); removeRoom(id); });
			node.append(el('span', 'hm-plan-room-tag', t('home_floorplan.orphan_tag', 'not in this home')));
			node.append(drop);
		}

		node.addEventListener('click', () => { state.selected = id; render(); });
		if (canEdit) {
			node.addEventListener('pointerdown', (e) => startDrag(e, id, room));
			node.append(resizeHandle(id, room));
			node.addEventListener('dragover', (e) => { e.preventDefault(); node.classList.add('is-drop'); });
			node.addEventListener('dragleave', () => node.classList.remove('is-drop'));
			node.addEventListener('drop', (e) => {
				e.preventDefault();
				node.classList.remove('is-drop');
				const entityId = e.dataTransfer?.getData('text/entity-id');
				if (entityId && !orphan && !id.startsWith('__')) fileEntity(entityId, id);
			});
		}
		return node;
	}

	function resizeHandle(id, room) {
		const handle = el('button', 'hm-plan-handle');
		handle.type = 'button';
		handle.setAttribute('aria-label', t('home_floorplan.resize_aria', 'Resize {{room}}', { room: nameOf(id) }));
		handle.addEventListener('pointerdown', (e) => {
			e.stopPropagation();
			const start = { x: e.clientX, y: e.clientY, w: room.w ?? DEFAULT_SIZE, d: room.d ?? DEFAULT_SIZE };
			drag(e, (dx, dy) => resizeRoom(id, start.w + dx / PX_PER_M, start.d + dy / PX_PER_M));
		});
		return handle;
	}

	function startDrag(e, id, room) {
		if (e.target.closest('.hm-plan-handle') || e.target.closest('.hm-plan-room-drop')) return;
		state.selected = id;
		const start = { x: room.x, z: room.z };
		drag(e, (dx, dy) => moveRoom(id, start.x + dx / PX_PER_M, start.z + dy / PX_PER_M));
	}

	/** One pointer-capture drag loop, shared by move and resize. */
	function drag(e, onMove) {
		e.preventDefault();
		const origin = { x: e.clientX, y: e.clientY };
		const target = e.currentTarget;
		target.setPointerCapture?.(e.pointerId);
		const move = (ev) => onMove(ev.clientX - origin.x, ev.clientY - origin.y);
		const up = () => {
			target.releasePointerCapture?.(e.pointerId);
			window.removeEventListener('pointermove', move);
			window.removeEventListener('pointerup', up);
		};
		window.addEventListener('pointermove', move);
		window.addEventListener('pointerup', up);
	}

	function onCanvasKey(e) {
		if (!canEdit) return;
		const mod = e.ctrlKey || e.metaKey;
		if (mod && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			return e.shiftKey ? redo() : undo();
		}
		if (!state.selected) return;
		const room = state.rooms.get(state.selected);
		if (!room) return;
		const step = e.shiftKey ? GRID_M * 5 : GRID_M;
		const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
		if (moves[e.key]) {
			e.preventDefault();
			return moveRoom(state.selected, room.x + moves[e.key][0], room.z + moves[e.key][1]);
		}
		if (e.key === '+' || e.key === '=') {
			e.preventDefault();
			return resizeRoom(state.selected, (room.w ?? DEFAULT_SIZE) + GRID_M, (room.d ?? DEFAULT_SIZE) + GRID_M);
		}
		if (e.key === '-' || e.key === '_') {
			e.preventDefault();
			return resizeRoom(state.selected, (room.w ?? DEFAULT_SIZE) - GRID_M, (room.d ?? DEFAULT_SIZE) - GRID_M);
		}
		if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			removeRoom(state.selected);
		}
	}

	function tray() {
		const wrap = el('div', 'hm-plan-tray');
		wrap.append(el('h3', 'hm-plan-tray-title', t('home_floorplan.tray_title', 'To place')));

		// State 2. A house with no areas has nothing to arrange, and the honest
		// answer is not an empty panel: it is the first room.
		if (canEdit && !liveRoomIds().some((id) => !id.startsWith('__'))) {
			const start = el('div', 'hm-plan-tray-start');
			start.append(el('p', null, t('home_floorplan.first_room_body', 'Nothing in this home is in a room yet. Make the first one and the plan starts here.')));
			start.append(button(t('home_floorplan.make_a_room', 'Make a room'), () => openNaming()));
			wrap.append(start);
		}

		const unplaced = state.unplaced.length ? state.unplaced : liveRoomIds().filter((id) => !state.rooms.has(id));
		if (unplaced.length) {
			const list = el('ul', 'hm-plan-tray-rooms');
			for (const id of unplaced) {
				const li = el('li');
				const add = el('button', 'hm-plan-tray-room', nameOf(id));
				add.type = 'button';
				add.disabled = !canEdit;
				add.addEventListener('click', () => placeRoom(id));
				li.append(add);
				list.append(li);
			}
			wrap.append(list);
		} else {
			wrap.append(el('p', 'hm-plan-tray-empty', t('home_floorplan.tray_empty', 'Every room in this home is on the plan.')));
		}

		const loose = graph?.unassigned || [];
		if (loose.length) {
			// One device and many devices are two catalog keys, not an English
			// "s" appended in code: a language with three plural forms cannot be
			// served by a ternary here.
			wrap.append(el('h3', 'hm-plan-tray-title', plural(
				'home_floorplan.loose_count',
				loose.length,
				'{{count}} device not in a room',
				'{{count}} devices not in a room',
			)));
			wrap.append(el('p', 'hm-plan-tray-hint', canEdit
				? t('home_floorplan.tray_hint', 'Drag one onto a room. That files it in your Home Assistant, so it shows up in your dashboards and voice assistant too.')
				: t('home_floorplan.tray_hint_readonly', 'Filing a device into a room needs the owner or an admin.')));
			const list = el('ul', 'hm-plan-tray-entities');
			for (const entity of loose.slice(0, 200)) {
				const li = el('li', 'hm-plan-tray-entity');
				li.textContent = entity.name || entity.entityId;
				li.title = entity.entityId;
				if (canEdit) {
					li.draggable = true;
					li.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/entity-id', entity.entityId));
					// Keyboard parity: dragging is not the only way in.
					const pick = el('button', 'hm-plan-tray-file', t('home_floorplan.file', 'File'));
					pick.type = 'button';
					pick.setAttribute('aria-label', t('home_floorplan.file_aria', 'File {{device}} into a room', { device: entity.name || entity.entityId }));
					pick.addEventListener('click', () => fileByPrompt(entity.entityId));
					li.append(pick);
				}
				list.append(li);
			}
			wrap.append(list);
			if (loose.length > 200) wrap.append(el('p', 'hm-plan-tray-hint', t('home_floorplan.tray_truncated', 'Showing the first 200 of {{total}}.', { total: formatNumber(loose.length) })));
		}
		return wrap;
	}

	/** The keyboard route into filing, so drag is never the only path. */
	function fileByPrompt(entityId) {
		const rooms = liveRoomIds().filter((id) => !id.startsWith('__'));
		// State 2, the common real house: nothing has ever been assigned to an
		// area, so there is nowhere to file this. Make the room here instead of
		// sending them to Home Assistant's settings to do a chore.
		if (!rooms.length) return openNaming(entityId);
		const menu = el('div', 'hm-plan-filemenu');
		menu.setAttribute('role', 'menu');
		for (const id of rooms) {
			const b = el('button', 'hm-plan-filemenu-item', nameOf(id));
			b.type = 'button';
			b.setAttribute('role', 'menuitem');
			b.addEventListener('click', () => { menu.remove(); fileEntity(entityId, id); });
			menu.append(b);
		}
		view.append(menu);
		menu.querySelector('button')?.focus();
	}

	// ---- helpers -----------------------------------------------------------

	function liveRoomIds() {
		const ids = (graph?.rooms || []).map((r) => r.id);
		if ((graph?.unassigned || []).length) ids.push('__unassigned__');
		return ids;
	}

	function nameOf(id) {
		if (id === '__unassigned__') return (graph?.rooms || []).length ? 'Not in a room' : 'Everything';
		return (graph?.rooms || []).find((r) => r.id === id)?.name || id;
	}

	function button(label, onClick, { primary = false, disabled = false, key } = {}) {
		const b = el('button', `hm-plan-btn${primary ? ' is-primary' : ''}`, label);
		b.type = 'button';
		b.disabled = disabled;
		if (key) b.title = key;
		b.addEventListener('click', onClick);
		return b;
	}

	function skeleton() {
		const s = el('div', 'hm-plan-skeleton');
		s.setAttribute('aria-busy', 'true');
		s.setAttribute('aria-label', t('home_floorplan.loading_aria', 'Loading the floorplan'));
		for (let i = 0; i < 4; i += 1) s.append(el('div', 'hm-plan-skeleton-room'));
		return s;
	}
}

function describeError(err) {
	if (err instanceof HomeApiError) {
		return {
			title: err.code === 'not_found'
				? t('home_floorplan.err_not_found', 'This home is not available')
				: t('home_floorplan.err_generic', 'Something went wrong'),
			body: err.message,
		};
	}
	return {
		title: t('home_floorplan.err_generic', 'Something went wrong'),
		body: err?.message || t('home_floorplan.err_retry', 'Try again in a moment.'),
	};
}

/** Grid snap, in metres. */
function snap(n) {
	return Math.round(n / GRID_M) * GRID_M;
}

function clampCoord(n) {
	return Math.max(-MAX_COORD, Math.min(MAX_COORD, n));
}

function clampSize(n) {
	return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
}

export function boxesOverlap(a, b) {
	const aw = (a.w ?? DEFAULT_SIZE) / 2;
	const ad = (a.d ?? DEFAULT_SIZE) / 2;
	const bw = (b.w ?? DEFAULT_SIZE) / 2;
	const bd = (b.d ?? DEFAULT_SIZE) / 2;
	// Touching walls is adjacency, not overlap: a strict comparison lets rooms
	// share a wall, which is what a real floorplan does.
	return Math.abs(a.x - b.x) < aw + bw - 1e-6 && Math.abs(a.z - b.z) < ad + bd - 1e-6;
}

export function planBounds(entries) {
	let minX = Infinity;
	let minZ = Infinity;
	let maxX = -Infinity;
	let maxZ = -Infinity;
	for (const [, room] of entries) {
		const w = (room.w ?? DEFAULT_SIZE) / 2;
		const d = (room.d ?? DEFAULT_SIZE) / 2;
		minX = Math.min(minX, room.x - w);
		minZ = Math.min(minZ, room.z - d);
		maxX = Math.max(maxX, room.x + w);
		maxZ = Math.max(maxZ, room.z + d);
	}
	if (!Number.isFinite(minX)) return { minX: 0, minZ: 0, w: 0, d: 0 };
	return { minX, minZ, w: maxX - minX, d: maxZ - minZ };
}
