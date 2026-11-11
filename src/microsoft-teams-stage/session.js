/**
 * The Live Share session behind the review stage. This module is the only
 * place that imports @microsoft/live-share and the Fluid client, and the stage
 * imports it dynamically, so the chunk loads only inside a Teams meeting or in
 * explicit local test mode (?liveshare=local).
 *
 * Shared state, one Fluid container per meeting:
 *   follow    LiveFollowMode<pose>   presenter camera, followers, suspensions
 *   presence  LivePresence           name, colour, laser pointer, current model
 *   model     LiveState              which model the meeting is reviewing
 *   anim      LiveState              clip id, playing, time, rate (timestamped)
 *   pins      SharedMap              comment pins keyed by id
 *
 * Teams mode uses the Teams-provided host (meeting-scoped container, Azure
 * Fluid Relay run by Microsoft). Local mode uses TestLiveShareHost against a
 * local Fluid service, with the container id in the URL hash so a second
 * browser joins the same session.
 */

import { LiveShareClient, LiveFollowMode, LivePresence, LiveState, TestLiveShareHost, FollowModeType, PresenceState } from '@microsoft/live-share';
import { SharedMap } from 'fluid-framework';
import { InsecureTokenProvider } from '@fluidframework/test-client-utils';

export { FollowModeType };

const SCHEMA = {
	initialObjects: {
		follow: LiveFollowMode,
		presence: LivePresence,
		model: LiveState,
		anim: LiveState,
		pins: SharedMap,
	},
};

class Emitter {
	#handlers = new Map();
	on(event, fn) {
		if (!this.#handlers.has(event)) this.#handlers.set(event, new Set());
		this.#handlers.get(event).add(fn);
		return () => this.#handlers.get(event)?.delete(fn);
	}
	emit(event, ...args) {
		for (const fn of this.#handlers.get(event) || []) fn(...args);
	}
}

/**
 * Join (or create) the meeting's container.
 * @param {object} opts
 * @param {'teams'|'local'} opts.mode
 * @param {object} [opts.teamsHost]   ILiveShareHost from LiveShareHost.create() (teams mode)
 * @param {string} [opts.endpoint]    local Fluid service URL (local mode)
 * @param {{ id: string, name: string }} opts.user
 * @param {{ name: string, color: string }} opts.profile  presence data for this participant
 */
export async function joinSession({ mode, teamsHost, endpoint, user, profile }) {
	let host;
	let connection;
	if (mode === 'local') {
		host = TestLiveShareHost.create();
		connection = { type: 'local', endpoint, tokenProvider: new InsecureTokenProvider('', { id: user.id, name: user.name }) };
	} else {
		host = teamsHost;
	}
	const client = new LiveShareClient(host, connection ? { connection } : undefined);
	const { container, timestampProvider } = await client.joinContainer(SCHEMA);
	const session = new StageSession(container, timestampProvider, { mode, profile });
	await session.start();
	return session;
}

export class StageSession extends Emitter {
	constructor(container, timestampProvider, { mode, profile }) {
		super();
		this.container = container;
		this.mode = mode;
		this.clock = timestampProvider;
		this.profile = { ...profile, pointer: null, modelKey: '' };
		const { follow, presence, model, anim, pins } = container.initialObjects;
		Object.assign(this, { follow, presence, model, anim, pins });
		this.animStamp = 0;
	}

	async start() {
		this.follow.on('stateChanged', (state, local) => this.emit('follow', state, local));
		this.follow.on('presenceChanged', () => this.emit('follow', this.follow.state, false));
		this.presence.on('presenceChanged', () => this.emit('presence'));
		this.model.on('stateChanged', (state, local) => this.emit('model', state, local));
		this.anim.on('stateChanged', (state, local, _clientId, timestamp) => {
			this.animStamp = timestamp;
			this.emit('anim', state, local, timestamp);
		});
		this.pins.on('valueChanged', () => this.emit('pins'));
		this.container.on('disconnected', () => this.emit('connection', 'disconnected'));
		this.container.on('connected', () => this.emit('connection', 'connected'));

		// No role restriction: every attendee can present, pin and pick a model,
		// which is what a design review needs. Teams still verifies who sent what.
		await Promise.all([
			this.follow.initialize(null),
			this.presence.initialize(this.profile, PresenceState.online),
			this.model.initialize(null),
			this.anim.initialize(null),
		]);
		this.animStamp = this.now();
	}

	/** The meeting-wide clock, the time base of LiveState timestamps. */
	now() {
		return this.clock?.getTimestamp?.() ?? Date.now();
	}

	get userId() {
		return this.presence.localUser?.userId || this.follow.localUser?.userId || '';
	}

	/** Everyone online, with the name and colour they announced. */
	participants() {
		return this.presence.getUsers(PresenceState.online).map((u) => ({
			userId: u.userId,
			name: u.data?.name || u.displayName || 'Guest',
			color: u.data?.color || '#3b82f6',
			pointer: u.data?.pointer || null,
			modelKey: u.data?.modelKey || '',
			isLocal: u.isLocalUser,
		}));
	}

	updatePresence(patch) {
		Object.assign(this.profile, patch);
		return this.presence.update({ ...this.profile }, PresenceState.online);
	}

	get shared() {
		return true;
	}

	get modelState() {
		return this.model.state;
	}

	get animState() {
		return this.anim.state;
	}

	get followState() {
		return this.follow.state;
	}

	/** Broadcast this participant's camera; followers of this user apply it. */
	updatePose(pose) {
		return this.follow.update(pose);
	}

	present() {
		return this.follow.startPresenting();
	}

	stopPresenting() {
		return this.follow.stopPresenting();
	}

	suspend() {
		return this.follow.beginSuspension();
	}

	resume() {
		return this.follow.endSuspension();
	}

	followUser(userId) {
		return this.follow.followUser(userId);
	}

	stopFollowing() {
		return this.follow.stopFollowing();
	}

	setModel(value) {
		return this.model.set(value);
	}

	setAnim(value) {
		return this.anim.set(value);
	}

	pinList() {
		return [...this.pins.values()];
	}

	addPin(pin) {
		this.pins.set(pin.id, pin);
	}

	removePin(id) {
		this.pins.delete(id);
	}

	dispose() {
		try {
			this.container.dispose();
		} catch {
			// Already closed by the host leaving the meeting.
		}
	}
}
