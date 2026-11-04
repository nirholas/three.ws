// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Group, Object3D } from 'three';
import { PlazaStageShow, normalizeDetail } from '../src/game/plaza-stage-show.js';
import { TIP_PRESETS, describeTipError, settleStageTip, THREE_MINT } from '../src/shared/stage-tip.js';

const STAGE_ID = '11111111-1111-5111-8111-111111111111';
const HOST_WALLET = 'HostWa11etHostWa11etHostWa11etHostWa11et111';

class FakeNet {
	constructor() {
		this.handlers = {};
		this.sessionId = 'sess-1';
		this.connect = vi.fn(async () => {});
		this.destroy = vi.fn();
		this.retry = vi.fn();
		this.askResult = true;
		this.ask = vi.fn(() => this.askResult);
	}
	on(ev, fn) {
		(this.handlers[ev] ||= new Set()).add(fn);
		return () => this.handlers[ev].delete(fn);
	}
	emit(ev, ...a) { for (const fn of this.handlers[ev] || []) fn(...a); }
	listenerCount() { return Object.values(this.handlers).reduce((n, s) => n + s.size, 0); }
}

function makeShow(over = {}) {
	const net = new FakeNet();
	const voice = { speak: vi.fn(async () => {}), dispose: vi.fn() };
	const release = vi.fn();
	const rig = new Group();
	const tipAgent = vi.fn(async () => ({ signature: 'SIG1' }));
	const apiFetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
	const hostAnchor = new Group();
	const audienceAnchor = new Group();
	const camera = new Object3D();
	const onShowState = vi.fn();
	const deps = {
		createNet: vi.fn(() => net),
		createVoice: vi.fn(() => voice),
		loadHost: vi.fn(async (url, anchor) => { anchor.add(rig); return { rig, release }; }),
		makeListener: () => new Object3D(),
		makePositional: () => Object.assign(new Object3D(), { setRefDistance() {}, setRolloffFactor() {}, setDistanceModel() {}, stop: vi.fn(), disconnect: vi.fn() }),
		tipAgent,
		apiFetch,
		sleep: async () => {},
		...over.deps,
	};
	const show = new PlazaStageShow({
		stageId: STAGE_ID,
		coin: { mint: THREE_MINT },
		camera,
		hostAnchor,
		audienceAnchor,
		ui: { toast: vi.fn() },
		detail: { phase: 'live', title: 'Meetup', host: 'Nova', hostWallet: HOST_WALLET, hostVoice: 'nova', hostAvatar: 'https://x.test/h.glb' },
		onShowState,
		deps,
	});
	return { show, net, voice, release, rig, tipAgent, apiFetch, hostAnchor, audienceAnchor, camera, onShowState, deps };
}

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { document.body.innerHTML = ''; });

describe('PlazaStageShow lifecycle', () => {
	it('opens nothing until start(): no net, no DOM, no audio', () => {
		const { deps, hostAnchor, audienceAnchor } = makeShow();
		expect(deps.createNet).not.toHaveBeenCalled();
		expect(deps.createVoice).not.toHaveBeenCalled();
		expect(document.querySelector('[data-plaza-stage-show]')).toBeNull();
		expect(hostAnchor.children).toHaveLength(0);
		expect(audienceAnchor.children).toHaveLength(0);
	});

	it('start() joins the stage room for the stage id exactly once', async () => {
		const { show, net, deps } = makeShow();
		await show.start();
		await show.start();
		expect(deps.createNet).toHaveBeenCalledTimes(1);
		expect(deps.createNet).toHaveBeenCalledWith({ stageId: STAGE_ID });
		expect(net.connect).toHaveBeenCalledTimes(1);
		expect(net.listenerCount()).toBeGreaterThanOrEqual(6);
	});

	it('puts a designed placeholder on the deck at once, then swaps in the host avatar', async () => {
		let finish;
		const rig = new Group();
		const { show, hostAnchor } = makeShow({ deps: { loadHost: vi.fn(() => new Promise((r) => { finish = r; })) } });
		await show.start();
		expect(hostAnchor.children.some((c) => c.name === 'plaza-stage-host-placeholder')).toBe(true);
		hostAnchor.add(rig);
		finish({ rig, release: vi.fn() });
		await new Promise((r) => setTimeout(r, 0));
		expect(hostAnchor.children).toContain(rig);
		expect(hostAnchor.children.some((c) => c.name === 'plaza-stage-host-placeholder')).toBe(false);
	});

	it('keeps the placeholder when the host GLB is blocked', async () => {
		const { show, hostAnchor } = makeShow({ deps: { loadHost: vi.fn(async () => { throw new Error('blocked'); }) } });
		await show.start();
		await new Promise((r) => setTimeout(r, 0));
		expect(hostAnchor.children.some((c) => c.name === 'plaza-stage-host-placeholder')).toBe(true);
	});

	it('dispose() closes the room, stops audio, removes the avatar, seats and DOM', async () => {
		const { show, net, voice, release, hostAnchor, audienceAnchor, rig } = makeShow();
		await show.start();
		await new Promise((r) => setTimeout(r, 0));
		net.emit('audience', { count: 1, selfId: 'a', members: [{ id: 'a', x: 1, z: 2 }] });
		expect(audienceAnchor.children[0].children).toHaveLength(1);
		show.togglePanel();
		show.dispose();
		expect(net.destroy).toHaveBeenCalledTimes(1);
		expect(net.listenerCount()).toBe(0);
		expect(voice.dispose).not.toHaveBeenCalled(); // voice is created lazily on first utterance
		expect(release).toHaveBeenCalledTimes(1);
		expect(hostAnchor.children).toHaveLength(0);
		expect(audienceAnchor.children).toHaveLength(0);
		expect(document.querySelector('[data-plaza-stage-show]')).toBeNull();
		expect(rig.parent).toBeNull();
		show.dispose();
		expect(net.destroy).toHaveBeenCalledTimes(1);
	});

	it('dispose() stops a voice that was already speaking', async () => {
		const { show, net, voice } = makeShow();
		await show.start();
		net.emit('utterance', { id: 'u1', text: 'Welcome!', voice: 'nova' });
		show.dispose();
		expect(voice.dispose).toHaveBeenCalledTimes(1);
	});

	it('a host avatar that finishes loading after dispose is released, not mounted', async () => {
		let finish;
		const release = vi.fn();
		const { show, hostAnchor } = makeShow({ deps: { loadHost: vi.fn(() => new Promise((r) => { finish = r; })) } });
		await show.start();
		show.dispose();
		finish({ rig: new Group(), release });
		await new Promise((r) => setTimeout(r, 0));
		expect(release).toHaveBeenCalledTimes(1);
		expect(hostAnchor.children).toHaveLength(0);
	});
});

describe('PlazaStageShow show feed', () => {
	it('speaks each utterance with its voice', async () => {
		const { show, net, voice } = makeShow();
		await show.start();
		net.emit('utterance', { id: 'u1', text: 'Hello plaza', voice: 'echo' });
		expect(voice.speak).toHaveBeenCalledWith('Hello plaza', 'echo');
	});

	it('renders the live caption and reports state back to the marquee', async () => {
		const { show, net, onShowState } = makeShow();
		await show.start();
		net.emit('status', { status: 'online' });
		net.emit('host', { caption: 'Welcome to the show', speaking: true, name: 'Nova' });
		const cap = document.querySelector('.pss-caption');
		expect(cap.hidden).toBe(false);
		expect(cap.textContent).toContain('Welcome to the show');
		expect(onShowState).toHaveBeenLastCalledWith(expect.objectContaining({ lastLine: 'Welcome to the show', phase: 'live' }));
	});

	it('marks server-dealt seats and distinguishes the local player', async () => {
		const { show, net, audienceAnchor } = makeShow();
		await show.start();
		net.emit('audience', {
			count: 3, selfId: 'me',
			members: [{ id: 'me', x: 1, z: 1 }, { id: 'b', x: -1, z: 2 }, { id: 'c', x: 3, z: 0, vip: true }],
		});
		const seats = audienceAnchor.children[0].children;
		expect(seats).toHaveLength(3);
		const colors = seats.map((s) => s.userData.ring.material.color.getHex());
		expect(new Set(colors).size).toBe(3);
		net.emit('audience', { count: 1, selfId: 'me', members: [{ id: 'me', x: 1, z: 1 }] });
		expect(audienceAnchor.children[0].children).toHaveLength(1);
	});

	it('shows a designed skeleton while connecting and a retry on failure', async () => {
		const { show, net } = makeShow();
		await show.start();
		show.togglePanel();
		expect(document.querySelector('.pss-skel')).not.toBeNull();
		net.emit('status', { status: 'failed' });
		const retry = [...document.querySelectorAll('.pss button')].find((b) => /retry/i.test(b.textContent));
		expect(retry).toBeTruthy();
		retry.click();
		expect(net.retry).toHaveBeenCalledTimes(1);
	});

	it('tells the player when no show is scheduled', async () => {
		const { show, net } = makeShow();
		await show.start();
		show.setStageDetail({ stage: { host_name: 'Nova', next_show_at: 0 }, live: false, hostWallet: HOST_WALLET });
		net.emit('status', { status: 'online' });
		show.togglePanel();
		expect(document.querySelector('.pss-panel').textContent).toMatch(/no show scheduled|stage is dark/i);
	});

	it('Escape closes the panel', async () => {
		const { show } = makeShow();
		await show.start();
		show.togglePanel();
		expect(show.panelOpen()).toBe(true);
		document.querySelector('.pss').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		expect(show.panelOpen()).toBe(false);
	});
});

describe('PlazaStageShow questions', () => {
	it('sends a question to the host queue', async () => {
		const { show, net } = makeShow();
		await show.start();
		expect(show.ask('  What is $THREE?  ')).toBe('sent');
		expect(net.ask).toHaveBeenCalledWith('What is $THREE?');
	});

	it('reports offline and empty honestly', async () => {
		const { show, net } = makeShow();
		await show.start();
		net.askResult = false;
		expect(show.ask('hello')).toBe('offline');
		expect(show.ask('   ')).toBe('empty');
	});
});

describe('PlazaStageShow tips (on-chain $THREE spend)', () => {
	async function live() {
		const ctx = makeShow();
		await ctx.show.start();
		ctx.net.emit('status', { status: 'online' });
		ctx.show.togglePanel();
		return ctx;
	}

	it('never signs before the player confirms', async () => {
		const { show, tipAgent, apiFetch } = await live();
		expect(show.requestTip(TIP_PRESETS[1])).toBe(true);
		await Promise.resolve();
		expect(tipAgent).not.toHaveBeenCalled();
		expect(apiFetch).not.toHaveBeenCalled();
	});

	it('shows recipient, amount and token in the confirm step', async () => {
		const { show } = await live();
		show.requestTip(500);
		const card = document.querySelector('.pss-confirm');
		expect(card).not.toBeNull();
		expect(card.textContent).toContain(HOST_WALLET);
		expect(card.textContent).toContain('500 $THREE');
		expect(card.textContent).toContain('Solana');
	});

	it('confirmTip with nothing pending is a no-op', async () => {
		const { show, tipAgent } = await live();
		expect(await show.confirmTip()).toBeNull();
		expect(tipAgent).not.toHaveBeenCalled();
	});

	it('cancel clears the pending tip so a later confirm cannot sign', async () => {
		const { show, tipAgent } = await live();
		show.requestTip(100);
		show.cancelTip();
		expect(await show.confirmTip()).toBeNull();
		expect(tipAgent).not.toHaveBeenCalled();
	});

	it('only offers the preset amounts', async () => {
		const { show } = await live();
		expect(show.requestTip(123456)).toBe(false);
		expect(document.querySelector('.pss-confirm')).toBeNull();
	});

	it('refuses to start a tip when the host is not live or has no wallet', async () => {
		const a = makeShow();
		await a.show.start();
		a.show.setStageDetail({ stage: { host_name: 'Nova' }, live: false, hostWallet: HOST_WALLET });
		a.show.togglePanel();
		expect(a.show.requestTip(100)).toBe(false);
		expect(a.tipAgent).not.toHaveBeenCalled();

		const b = makeShow();
		await b.show.start();
		b.net.emit('status', { status: 'online' });
		b.show.setStageDetail({ stage: { host_name: 'Nova' }, live: true, hostWallet: null });
		b.show.togglePanel();
		expect(b.show.requestTip(100)).toBe(false);
		expect(document.querySelector('.pss-note.bad').textContent).toMatch(/no wallet/i);
	});

	it('confirm signs once, to the host wallet, in $THREE, then records the signature', async () => {
		const { show, tipAgent, apiFetch } = await live();
		show.requestTip(500);
		const [res] = await Promise.all([show.confirmTip(), show.confirmTip()]);
		expect(res).toEqual({ signature: 'SIG1', pending: false });
		expect(tipAgent).toHaveBeenCalledTimes(1);
		expect(tipAgent).toHaveBeenCalledWith(expect.objectContaining({ toAddress: HOST_WALLET, mint: THREE_MINT, amount: 500, token: 'SPL' }));
		expect(apiFetch).toHaveBeenCalledTimes(1);
		const [url, init] = apiFetch.mock.calls[0];
		expect(url).toBe('/api/stage/tip');
		expect(JSON.parse(init.body)).toMatchObject({ stageId: STAGE_ID, signature: 'SIG1', currencyMint: THREE_MINT, amount: 500_000_000, tipperSession: 'sess-1' });
	});

	it('retries the idempotent record while the server reports pending', async () => {
		const answers = [{ pending: true }, { pending: true }, { ok: true }];
		const apiFetch = vi.fn(async () => ({ ok: true, json: async () => answers.shift() }));
		const out = await settleStageTip({
			stageId: STAGE_ID, hostWallet: HOST_WALLET, amount: 100, tipAgent: async () => ({ signature: 'S' }), apiFetch, sleep: async () => {},
		});
		expect(out).toEqual({ signature: 'S', pending: false });
		expect(apiFetch).toHaveBeenCalledTimes(3);
	});

	it('surfaces a rejected wallet prompt as a calm, actionable state', async () => {
		const err = Object.assign(new Error('You cancelled the tip.'), { name: 'TipError', code: 'cancelled' });
		const { show } = await live();
		show.deps.tipAgent = vi.fn(async () => { throw err; });
		show.requestTip(100);
		await show.confirmTip();
		expect(document.querySelector('.pss-note.warn').textContent).toMatch(/cancelled/i);
	});

	it('offers a way to get $THREE when the wallet is short', async () => {
		const err = Object.assign(new Error('x'), { name: 'TipError', code: 'no_balance' });
		const { show } = await live();
		show.deps.tipAgent = vi.fn(async () => { throw err; });
		show.requestTip(100);
		await show.confirmTip();
		const link = document.querySelector('.pss-note a');
		expect(link.href).toContain(THREE_MINT);
		expect(describeTipError(err).kind).toBe('bad');
	});

	it('displays a replayed tip settlement once', async () => {
		const { show, net } = await live();
		const tip = { label: 'Ann', amount: 500_000_000, explorer: 'https://solscan.io/tx/SIG1', ts: 1 };
		net.emit('tip', tip);
		net.emit('tip', { ...tip });
		net.emit('tip', { ...tip, ts: 2 });
		expect(document.querySelectorAll('.pss ul li')).toHaveLength(1);
		net.emit('tip', { label: 'Bo', amount: 100_000_000, explorer: 'https://solscan.io/tx/SIG2', ts: 3 });
		expect(document.querySelectorAll('.pss ul li')).toHaveLength(2);
	});
});

describe('normalizeDetail', () => {
	it('reads both the raw API payload and the marquee state', () => {
		expect(normalizeDetail({ stage: null, live: false }).claimed).toBe(false);
		expect(normalizeDetail({ stage: { host_name: 'N', voice: 'echo' }, live: true, hostWallet: 'W' })).toMatchObject({ live: true, claimed: true, voice: 'echo', hostWallet: 'W' });
		expect(normalizeDetail({ phase: 'scheduled', hostVoice: 'x' })).toMatchObject({ live: false, claimed: true, voice: 'x' });
		expect(normalizeDetail({ phase: 'unclaimed' }).claimed).toBe(false);
	});
});
