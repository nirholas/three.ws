// Party client for /play (docs/play-parties.md).
//
// The server (multiplayer/src/party-service.js) owns membership, invites, the
// go-to teleport and the party chat relay. This module is the player-facing half:
// the roster panel, invite cards, nameplate accent, minimap blips, screen-edge
// direction chips, the arrival effect, the party chat channel and the cross-world
// handoff. It is driven by one `party` message type and ticks at 10 Hz off the
// existing frame loop, so it adds no extra timers or network traffic of its own.

import './party.css';
import {
	Mesh, RingGeometry, MeshBasicMaterial, DoubleSide, AdditiveBlending, Vector3,
} from 'three';
import { announce } from './a11y.js';

const BLIP_COLOR = '#7fd1ff';
const DEFAULT_RANGE_M = 70; // minimap radius; chips take over beyond it
const TICK_MS = 100;
const FX_MS = 750;
const EDGE_MARGIN_PX = 64;

function h(tag, attrs = {}, kids = []) {
	const node = document.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) {
		if (v == null || v === false) continue;
		if (k === 'class') node.className = v;
		else if (k === 'text') node.textContent = v;
		else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
		else node.setAttribute(k, v === true ? '' : String(v));
	}
	for (const kid of [].concat(kids)) if (kid != null) node.append(kid);
	return node;
}

const REASONS = {
	invite: {
		offline: () => 'That player is not online right now.',
		self: () => 'You cannot invite yourself.',
		already_member: (n) => `${n} is already in your party.`,
		already_partied: (n) => `${n} is already in another party.`,
		already_invited: (n) => `${n} already has an invite from you.`,
		full: (_n, cap) => `Your party is full (${cap}/${cap}).`,
		busy: () => 'The party service is busy. Try again in a moment.',
		error: () => 'Could not send that invite. Try again.',
	},
	accept: {
		no_invite: () => 'That invite expired.',
		gone: () => 'That party no longer exists.',
		full: () => 'That party is full.',
		already_partied: () => 'Leave your current party before joining another.',
		busy: () => 'The party service is busy. Try again in a moment.',
		error: () => 'Could not join that party. Try again.',
	},
	goto: {
		cooldown: (_n, _c, r) => `Go to is ready in ${r.wait}s.`,
		dead: () => 'You cannot go to a party member while down.',
		target_dead: (n) => `${n} is down right now. Try again in a moment.`,
		driving: () => 'Get out of your vehicle first.',
		no_space: (n) => `No clear spot next to ${n}. Try again in a moment.`,
		not_in_party: () => 'That player is not in your party.',
		error: () => 'Go to failed. Try again.',
	},
	leave: { error: () => 'Could not leave the party. Try again.' },
};

const EVENTS = {
	joined: (m) => `${m.name} joined the party.`,
	left: (m) => `${m.name} left the party.`,
	declined: (m) => `${m.name} declined your party invite.`,
	dissolved: () => 'The party disbanded.',
};

export class PartyClient {
	constructor(host) {
		this.host = host;
		this.state = { cap: 8, me: null, party: null, invites: [] };
		this.scope = 'world';
		this.gotoReadyAt = 0;
		this._tickAt = 0;
		this._plated = new Set();
		this._chips = new Map();
		this._fx = [];
		this._v = new Vector3();
		this._cdSecs = -1;
		this._arrivedFrom = new URLSearchParams(location.search).get('party') || '';
		this._unsub = [];
		this._buildDom();
		this._installChatScope();
		const net = host.net;
		this._unsub.push(net.on('party', (m) => this._onMsg(m)));
		// Messages sent from onJoin land before this client has handlers, so ask for
		// the current state once the wire is up (and again after every reconnect).
		this._unsub.push(net.on('status', ({ status }) => { if (status === 'online') net.sendParty({ op: 'state' }); }));
		if (net.status === 'online') net.sendParty({ op: 'state' });
	}

	// ---- DOM ----------------------------------------------------------------
	_buildDom() {
		this.pill = h('button', {
			class: 'cc-party-pill', type: 'button', hidden: true, 'aria-expanded': 'false', 'aria-controls': 'cc-party-panel',
			onclick: () => this._togglePanel(),
		});
		this.panel = h('div', { class: 'cc-party-panel', id: 'cc-party-panel', role: 'region', 'aria-label': 'Party', hidden: true });
		this.root = h('div', { id: 'cc-party' }, [this.pill, this.panel]);
		this.invites = h('div', { id: 'cc-party-invites', role: 'region', 'aria-label': 'Party invites', 'aria-live': 'assertive' });
		this.edge = h('div', { id: 'cc-party-edge', 'aria-hidden': 'false' });
		this.flash = h('div', { id: 'cc-party-flash', 'aria-hidden': 'true' });
		document.body.append(this.root, this.invites, this.edge, this.flash);
	}

	_togglePanel(force) {
		const open = force ?? this.panel.hidden;
		this.panel.hidden = !open;
		this.pill.setAttribute('aria-expanded', String(open));
		if (open) this._renderPanel();
	}

	// ---- messages -----------------------------------------------------------
	_onMsg(m) {
		switch (m?.type) {
			case 'state': return this._onState(m);
			case 'event': return this._onEvent(m);
			case 'result': return this._onResult(m);
			case 'chat': return this._onChat(m);
			case 'warp': return this._onWarp(m);
			case 'fx': return this._onFx(m);
			default: return undefined;
		}
	}

	_onState(m) {
		const hadParty = !!this.state.party;
		const prevInvites = new Set(this.state.invites.map((i) => i.pid));
		this.state = { cap: m.cap || 8, me: m.me, party: m.party, invites: m.invites || [] };
		for (const inv of this.state.invites) {
			if (!prevInvites.has(inv.pid)) announce(`${inv.from} invited you to a party.`);
		}
		if (!m.party && this.scope === 'party') this.setScope('world');
		if (m.party && !hadParty && this._arrivedFrom) {
			this.host.ui.toast(`Party intact: you are with ${this._partyNames()}.`, 'success');
			this._arrivedFrom = '';
		}
		this._renderPill();
		this._renderInvites();
		if (!this.panel.hidden) this._renderPanel();
		this._syncScopeButton();
		this._tickAt = 0;
	}

	_onEvent(m) {
		const text = EVENTS[m.ev]?.(m);
		if (text) { this.host.ui.toast(text, m.ev === 'joined' ? 'success' : 'info'); announce(text); }
	}

	_onResult(m) {
		const { cap } = this.state;
		const name = m.name || 'That player';
		if (m.ok) {
			if (m.op === 'invite') this.host.ui.toast(`Invite sent to ${name}.`, 'success');
			else if (m.op === 'accept') this.host.ui.toast('You joined the party.', 'success');
			else if (m.op === 'leave') this.host.ui.toast('You left the party.', 'info');
			return;
		}
		if (m.op === 'goto' && m.reason === 'other_world') {
			const member = this._memberByName(m.name);
			if (member) this._openHandoff(member);
			return;
		}
		if (m.op === 'chat') {
			if (m.reason === 'not_in_party') this.setScope('world');
			return;
		}
		const text = REASONS[m.op]?.[m.reason]?.(name, cap, m) || 'That did not work. Try again.';
		this.host.ui.toast(text, 'warn');
	}

	_onChat(m) {
		this.host.ui.addChat({ name: m.name, text: m.text, mine: m.key === this.state.me, scope: 'party' });
	}

	_onWarp(m) {
		const g = this.host;
		g.localPos.set(m.x, m.y, m.z);
		g.localYaw = m.yaw;
		g.vy = 0;
		g._physicsActivePrev = false; // next physics step re-seeds the Rapier body from localPos
		this.gotoReadyAt = performance.now() + 20_000;
		this.flash.classList.remove('cc-on');
		void this.flash.offsetWidth;
		this.flash.classList.add('cc-on');
		announce(`Arrived next to ${m.name}.`);
		g.net.sendMove({ x: m.x, y: m.y, z: m.z, yaw: m.yaw, motion: 'idle' });
	}

	_onFx(m) {
		if (!m.to) return;
		this._spawnRing(m.to.x, m.to.y, m.to.z, 1);
		if (m.from) this._spawnRing(m.from.x, m.from.y, m.from.z, -1);
	}

	// ---- actions ------------------------------------------------------------
	send(payload) { this.host.net?.sendParty(payload); }
	invitePeer(sid) { this.send({ op: 'invite', sid }); }
	inviteFriend(friend) { this.send({ op: 'invite', uid: friend.id, name: friend.name }); }
	accept(pid) { this.send({ op: 'accept', pid }); }
	decline(pid) { this.send({ op: 'decline', pid }); }
	leave() { this.send({ op: 'leave' }); this._togglePanel(false); }

	gotoMember(member) {
		if (member.state === 'here') this.send({ op: 'goto', key: member.key });
		else if (member.state === 'elsewhere') this._openHandoff(member);
	}

	/** Actions for the inspect panel of a peer, keyed by their session id. */
	inspectActions(sid) {
		const members = this.state.party?.members || [];
		const member = members.find((m) => m.sid === sid);
		if (member && !member.me) return [{ label: 'Go to', primary: true, onClick: () => this.gotoMember(member) }];
		if (member) return [];
		return [{ label: 'Invite to party', primary: true, onClick: () => this.invitePeer(sid) }];
	}

	_memberByName(name) {
		return (this.state.party?.members || []).find((m) => m.name === name && !m.me);
	}

	_partyNames() {
		return (this.state.party?.members || []).filter((m) => !m.me).map((m) => m.name).join(', ') || 'your party';
	}

	// ---- rendering ----------------------------------------------------------
	_renderPill() {
		const p = this.state.party;
		this.pill.hidden = !p;
		this.root.classList.toggle('cc-has-party', !!p);
		if (!p) { this._togglePanel(false); return; }
		const n = p.members.length;
		this.pill.replaceChildren(
			h('span', { class: 'cc-party-pill-ico', 'aria-hidden': 'true', text: '◆' }),
			h('span', { text: `Party ${n}/${this.state.cap}` }),
		);
		this.pill.setAttribute('aria-label', `Party, ${n} of ${this.state.cap} members. Open roster.`);
	}

	_renderInvites() {
		const frag = this.state.invites.map((inv) => {
			const card = h('div', { class: 'cc-party-invite', role: 'alert' }, [
				h('div', { class: 'cc-party-invite-text' }, [
					h('b', { text: inv.from }),
					h('span', { text: ' invited you to a party' }),
				]),
				h('div', { class: 'cc-party-invite-actions' }, [
					h('button', { class: 'cc-party-btn cc-primary', type: 'button', text: 'Accept', onclick: () => this.accept(inv.pid) }),
					h('button', { class: 'cc-party-btn', type: 'button', text: 'Decline', onclick: () => this.decline(inv.pid) }),
				]),
			]);
			return card;
		});
		this.invites.replaceChildren(...frag);
	}

	_renderPanel() {
		const p = this.state.party;
		if (!p) { this.panel.replaceChildren(); return; }
		const rows = p.members.map((m) => this._memberRow(m));
		const pending = p.pending.map((x) => h('li', { class: 'cc-party-row cc-pending' }, [
			h('span', { class: 'cc-party-dot' }),
			h('span', { class: 'cc-party-name', text: x.name }),
			h('span', { class: 'cc-party-tag', text: 'invited' }),
		]));
		this.panel.replaceChildren(
			h('div', { class: 'cc-party-head' }, [
				h('div', {}, [
					h('div', { class: 'cc-party-title', text: 'Your party' }),
					h('div', { class: 'cc-party-sub', text: `${p.members.length} of ${this.state.cap} players. Invite from a player card or the Friends drawer.` }),
				]),
				h('button', { class: 'cc-party-x', type: 'button', 'aria-label': 'Close party roster', text: '×', onclick: () => this._togglePanel(false) }),
			]),
			h('ul', { class: 'cc-party-list' }, [...rows, ...pending]),
			h('div', { class: 'cc-party-foot' }, [
				h('button', { class: 'cc-party-btn cc-chat-btn', type: 'button', text: 'Party chat', onclick: () => { this.setScope('party'); this.host.ui.focusChat?.(); } }),
				h('button', { class: 'cc-party-btn cc-danger', type: 'button', text: 'Leave party', onclick: () => this.leave() }),
			]),
		);
	}

	_memberRow(m) {
		const world = m.world;
		const tag = m.leader ? 'leader' : '';
		const where = m.state === 'elsewhere' && world ? (world.symbol ? '$' + world.symbol : world.name || 'another world') : m.state === 'away' ? 'away' : '';
		const btn = m.me ? null : this._gotoButton(m);
		return h('li', { class: `cc-party-row cc-${m.state}` + (m.me ? ' cc-me' : '') }, [
			h('span', { class: 'cc-party-dot', title: m.state === 'here' ? 'In this world' : m.state === 'elsewhere' ? 'In another world' : 'Reconnecting' }),
			h('span', { class: 'cc-party-name', text: m.me ? `${m.name} (you)` : m.name }),
			tag ? h('span', { class: 'cc-party-tag cc-lead', text: tag }) : null,
			where ? h('span', { class: 'cc-party-tag', text: where }) : null,
			btn,
		]);
	}

	_gotoButton(m) {
		const away = m.state === 'away';
		const label = m.state === 'elsewhere' ? 'Join world' : 'Go to';
		const btn = h('button', {
			class: 'cc-party-btn cc-goto', type: 'button', text: label, disabled: away,
			'aria-label': away ? `${m.name} is reconnecting` : `${label}: ${m.name}`,
			'data-label': label, onclick: () => this.gotoMember(m),
		});
		return btn;
	}

	// ---- cross-world handoff ------------------------------------------------
	_worldUrl(world, pid) {
		const q = new URLSearchParams({ coin: world.coin });
		if (world.name) q.set('name', world.name);
		if (world.symbol) q.set('symbol', world.symbol);
		if (world.image) q.set('image', world.image);
		if (world.tier === 'holders') q.set('tier', 'holders');
		q.set('party', pid);
		return `/play?${q.toString()}`;
	}

	_openHandoff(member) {
		const world = member.world;
		if (!world?.coin) { this.host.ui.toast(`${member.name} is in a world that cannot be joined by link.`, 'warn'); return; }
		this._closeHandoff();
		const label = world.symbol ? '$' + world.symbol : world.name || `${world.coin.slice(0, 4)}...${world.coin.slice(-4)}`;
		const holders = world.tier === 'holders';
		const art = world.image
			? h('img', { class: 'cc-party-ho-img', src: world.image, alt: '', referrerpolicy: 'no-referrer' })
			: h('span', { class: 'cc-party-ho-mono', text: (world.symbol || world.name || world.coin).charAt(0).toUpperCase() });
		const go = h('button', {
			class: 'cc-party-btn cc-primary', type: 'button', text: `Join ${member.name} in ${label}`,
			onclick: () => { location.assign(this._worldUrl(world, this.state.party.id)); },
		});
		const stay = h('button', { class: 'cc-party-btn', type: 'button', text: 'Stay here', onclick: () => this._closeHandoff() });
		const dlg = h('div', { class: 'cc-party-ho', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'cc-party-ho-t' }, [
			h('div', { class: 'cc-party-ho-card' }, [
				h('div', { class: 'cc-party-ho-art' }, [art]),
				h('h2', { id: 'cc-party-ho-t', class: 'cc-party-ho-title', text: `${member.name} is in another world` }),
				h('p', { class: 'cc-party-ho-world', text: `${world.name || label}${world.symbol ? ' ($' + world.symbol + ')' : ''}${holders ? ' · Holders' : ''}` }),
				h('p', { class: 'cc-party-ho-note', text: 'You will switch worlds. Your party stays together, and Go to brings you back to anyone in a world you share.' }),
				holders ? h('p', { class: 'cc-party-ho-note cc-warn', text: 'This is a holders world. You need to hold the coin to enter.' }) : null,
				h('div', { class: 'cc-party-ho-actions' }, [go, stay]),
			]),
		]);
		dlg.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); this._closeHandoff(); } });
		dlg.addEventListener('click', (e) => { if (e.target === dlg) this._closeHandoff(); });
		this._ho = { dlg, restore: document.activeElement };
		document.body.append(dlg);
		go.focus();
	}

	_closeHandoff() {
		if (!this._ho) return;
		this._ho.dlg.remove();
		this._ho.restore?.focus?.();
		this._ho = null;
	}

	// ---- chat channel -------------------------------------------------------
	_installChatScope() {
		const ui = this.host.ui;
		const row = ui.chatInput?.parentElement;
		if (!row) return;
		this.scopeBtn = h('button', {
			class: 'cc-party-scope', type: 'button', 'aria-pressed': 'false',
			onclick: () => this.setScope(this.scope === 'party' ? 'world' : 'party'),
		});
		row.insertBefore(this.scopeBtn, ui.chatInput);
		ui.chatInterceptor = (text) => this._interceptChat(text);
		this._syncScopeButton();
	}

	_syncScopeButton() {
		const b = this.scopeBtn;
		if (!b) return;
		const has = !!this.state.party;
		const party = this.scope === 'party';
		b.textContent = party ? 'Party' : 'World';
		b.classList.toggle('cc-party-on', party);
		b.setAttribute('aria-pressed', String(party));
		b.setAttribute('aria-disabled', String(!has && !party));
		b.title = has ? (party ? 'Sending to your party. Click for world chat.' : 'Sending to the world. Click for party chat.') : 'Join a party to use party chat (/p to message it).';
		this.host.ui.chat?.classList.toggle('cc-scope-party', party);
		const input = this.host.ui.chatInput;
		if (input) input.placeholder = party ? 'Message your party…' : 'Say something…';
	}

	setScope(scope) {
		if (scope === 'party' && !this.state.party) {
			this.host.ui.toast('Join a party first: invite someone from their player card or the Friends drawer.', 'info');
			return;
		}
		this.scope = scope;
		this._syncScopeButton();
	}

	_interceptChat(text) {
		const cmd = text.match(/^\/p(?:arty)?\s+(.+)/i);
		if (!cmd && (this.scope !== 'party' || text.startsWith('/'))) return false;
		if (!this.state.party) {
			this.host.ui.toast('You are not in a party. Invite someone from their player card.', 'info');
			this.setScope('world');
			return true;
		}
		this.send({ op: 'chat', text: cmd ? cmd[1] : text });
		return true;
	}

	// ---- per-frame work (10 Hz) --------------------------------------------
	tick() {
		const now = performance.now();
		if (now - this._tickAt < TICK_MS) { this._stepFx(now); return; }
		this._tickAt = now;
		this._applyPlates();
		this._updateChips();
		this._updateCooldown(now);
		this._stepFx(now);
	}

	_hereMembers() {
		return (this.state.party?.members || []).filter((m) => m.state === 'here' && !m.me && m.sid && this.host.remotes.has(m.sid));
	}

	_applyPlates() {
		const want = new Set(this._hereMembers().map((m) => m.sid));
		for (const sid of this._plated) {
			if (!want.has(sid)) this.host.remotes.get(sid)?.label?.classList.remove('cc-party');
		}
		for (const sid of want) this.host.remotes.get(sid)?.label?.classList.add('cc-party');
		this._plated = want;
	}

	/** Minimap blips for party members in this world (consumed by CombatSystem at 10 Hz). */
	blips() {
		return this._hereMembers().map((m) => {
			const p = this.host.remotes.get(m.sid).rig.position;
			return { x: p.x, z: p.z, kind: 'party', color: BLIP_COLOR };
		});
	}

	_updateChips() {
		const g = this.host;
		const members = this._hereMembers();
		const range = g.combat?.hud?.minimap?.range ?? DEFAULT_RANGE_M;
		const w = innerWidth;
		const hgt = innerHeight;
		const seen = new Set();
		for (const m of members) {
			const rig = g.remotes.get(m.sid).rig;
			const dist = Math.hypot(rig.position.x - g.localPos.x, rig.position.z - g.localPos.z);
			if (dist <= range) continue;
			seen.add(m.key);
			let chip = this._chips.get(m.key);
			if (!chip) {
				chip = this._makeChip(m);
				this._chips.set(m.key, chip);
				this.edge.append(chip.node);
			}
			const v = this._v.set(rig.position.x, rig.position.y + 1.8, rig.position.z).project(g.camera);
			let x = v.x;
			let y = v.y;
			if (v.z > 1) { x = -x; y = -y; }
			const mx = 1 - (EDGE_MARGIN_PX * 2) / w;
			const my = 1 - (EDGE_MARGIN_PX * 2) / hgt;
			const k = Math.max(Math.abs(x) / mx, Math.abs(y) / my, 1);
			const px = ((x / k) * 0.5 + 0.5) * w;
			const py = (0.5 - (y / k) * 0.5) * hgt;
			const angle = Math.atan2(-y, x) + Math.PI / 2;
			chip.node.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(-50%, -50%)`;
			chip.arrow.style.transform = `rotate(${angle.toFixed(3)}rad)`;
			chip.name.textContent = m.name;
			chip.dist.textContent = `${Math.round(dist)} m`;
			chip.node.setAttribute('aria-label', `${m.name}, ${Math.round(dist)} metres away. Go to.`);
		}
		for (const [key, chip] of this._chips) {
			if (!seen.has(key)) { chip.node.remove(); this._chips.delete(key); }
		}
	}

	_makeChip(m) {
		const arrow = h('span', { class: 'cc-party-chip-arrow', 'aria-hidden': 'true', text: '▲' });
		const name = h('span', { class: 'cc-party-chip-name' });
		const dist = h('span', { class: 'cc-party-chip-dist' });
		const node = h('button', {
			class: 'cc-party-chip', type: 'button', onclick: () => this.send({ op: 'goto', key: m.key }),
		}, [arrow, name, dist]);
		return { node, arrow, name, dist };
	}

	_updateCooldown(now) {
		const secs = Math.max(0, Math.ceil((this.gotoReadyAt - now) / 1000));
		if (secs === this._cdSecs) return;
		this._cdSecs = secs;
		for (const btn of this.panel.querySelectorAll('.cc-goto')) {
			const base = btn.dataset.label;
			if (base === 'Go to') btn.textContent = secs > 0 ? `Go to (${secs}s)` : 'Go to';
		}
	}

	// ---- arrival effect -----------------------------------------------------
	_spawnRing(x, y, z, dir) {
		const scene = this.host.scene;
		if (!scene) return;
		const geo = new RingGeometry(0.55, 0.75, 48);
		const mat = new MeshBasicMaterial({
			color: BLIP_COLOR, transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false, blending: AdditiveBlending,
		});
		const mesh = new Mesh(geo, mat);
		mesh.rotation.x = -Math.PI / 2;
		mesh.position.set(x, y + 0.06, z);
		scene.add(mesh);
		this._fx.push({ mesh, geo, mat, t0: performance.now(), dir });
	}

	_stepFx(now) {
		for (let i = this._fx.length - 1; i >= 0; i--) {
			const f = this._fx[i];
			const t = (now - f.t0) / FX_MS;
			if (t >= 1) {
				f.mesh.removeFromParent();
				f.geo.dispose();
				f.mat.dispose();
				this._fx.splice(i, 1);
				continue;
			}
			const s = f.dir > 0 ? 0.4 + t * 3.2 : 3.6 - t * 3.2;
			f.mesh.scale.setScalar(s);
			f.mat.opacity = 0.9 * (1 - t);
		}
	}

	dispose() {
		for (const off of this._unsub) off?.();
		this._unsub = [];
		this._closeHandoff();
		for (const sid of this._plated) this.host.remotes?.get(sid)?.label?.classList.remove('cc-party');
		for (const f of this._fx) { f.mesh.removeFromParent(); f.geo.dispose(); f.mat.dispose(); }
		this._fx = [];
		this.root.remove();
		this.invites.remove();
		this.edge.remove();
		this.flash.remove();
		this.scopeBtn?.remove();
		const ui = this.host.ui;
		if (ui) {
			ui.chatInterceptor = null;
			ui.chat?.classList.remove('cc-scope-party');
			if (ui.chatInput) ui.chatInput.placeholder = 'Say something…';
		}
	}
}
