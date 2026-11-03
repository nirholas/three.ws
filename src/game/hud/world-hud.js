// WorldHud — the one HUD system the World Online briefs push data into.
//
// GTA-style chrome: a rotating minimap with compass + live player blips
// (bottom-left), cash/banked (top-right), health/armor bars (above the
// minimap), a wanted-level star row, an active-objective card, and a vehicle
// speedo. Each element appears ONLY when it has real data — no element is shown
// with placeholder numbers. Sibling briefs feed it:
//   - W04 economy → setCash / setBanked
//   - W07 combat  → setHealth / setArmor / setWanted
//   - W05 quests  → setObjective / clearObjective
//   - W09 social  → minimap.setBlips (party/POIs)
//   - W02 driving → setSpeed / hideSpeed
//
// The host (/play) drives the minimap viewer + blips every frame and forwards
// the player's purse/HP, so what ships today is fully wired to live data; the
// combat/quest/vehicle setters stay dormant until those briefs light them up.

import './world-hud.css';
import { Minimap } from './minimap.js';
import { announce } from '../a11y.js';
import { t } from '../i18n-play.js';

function el(tag, props = {}, kids = []) {
	const n = document.createElement(tag);
	for (const [k, v] of Object.entries(props)) {
		if (k === 'class') n.className = v;
		else if (k === 'text') n.textContent = v;
		else if (k === 'hidden') n.hidden = !!v;
		else if (v != null) n.setAttribute(k, v);
	}
	for (const c of [].concat(kids)) if (c) n.appendChild(c);
	return n;
}

const fmtCash = (n) => '$' + Math.round(Number(n) || 0).toLocaleString();

export class WorldHud {
	constructor() {
		this._cash = 0;
		this._cashShown = 0;
		this._context = 'onfoot';
		this._build();
	}

	_build() {
		// --- Top-right money cluster (cash + optional banked) -------------------
		this.cashEl = el('span', { class: 'wh-cash-amt', text: '$0' });
		this.cashRow = el('div', { class: 'wh-cash', title: 'Cash on hand' }, [
			el('span', { class: 'wh-cash-glyph', text: '$' }), this.cashEl,
		]);
		this.bankedEl = el('span', { class: 'wh-banked-amt', text: '$0' });
		this.bankedRow = el('div', { class: 'wh-banked', hidden: true, title: 'Banked' }, [
			el('span', { class: 'wh-banked-glyph', text: '🏦' }), this.bankedEl,
		]);
		this.wantedRow = el('div', { class: 'wh-wanted', hidden: true, role: 'status', 'aria-label': 'Wanted level' });
		this._stars = [];
		for (let i = 0; i < 5; i++) {
			const s = el('span', { class: 'wh-star', text: '★' });
			this._stars.push(s);
			this.wantedRow.appendChild(s);
		}
		this.moneyCol = el('div', { class: 'wh-money' }, [this.cashRow, this.bankedRow, this.wantedRow]);

		// --- Active objective card (left) --------------------------------------
		this.objTitle = el('div', { class: 'wh-obj-title' });
		this.objDetail = el('div', { class: 'wh-obj-detail' });
		this.objCard = el('div', { class: 'wh-objective', hidden: true, role: 'status' }, [
			el('div', { class: 'wh-obj-bar' }),
			el('div', { class: 'wh-obj-body' }, [this.objTitle, this.objDetail]),
		]);

		// --- Bottom-left vitals + minimap --------------------------------------
		this.hpFill = el('i', { class: 'wh-bar-fill' });
		this.hpBar = el('div', { class: 'wh-bar wh-bar--hp', hidden: true, role: 'progressbar', 'aria-label': 'Health' }, [this.hpFill]);
		this.armorFill = el('i', { class: 'wh-bar-fill' });
		this.armorBar = el('div', { class: 'wh-bar wh-bar--armor', hidden: true, role: 'progressbar', 'aria-label': 'Armor' }, [this.armorFill]);
		this.vitals = el('div', { class: 'wh-vitals' }, [this.hpBar, this.armorBar]);

		this.minimap = new Minimap();
		this.cornerBL = el('div', { class: 'wh-corner-bl' }, [this.vitals, this.minimap.root]);

		// --- Speedo (bottom-right, vehicles only) ------------------------------
		this.speedNum = el('div', { class: 'wh-speed-num', text: '0' });
		this.speedGear = el('div', { class: 'wh-speed-gear', text: '' });
		this.speedFill = el('i', { class: 'wh-speed-fill' });
		this.speedo = el('div', { class: 'wh-speedo', hidden: true }, [
			el('div', { class: 'wh-speed-dial' }, [this.speedFill]),
			el('div', { class: 'wh-speed-read' }, [this.speedNum, el('div', { class: 'wh-speed-unit', text: 'KM/H' })]),
			this.speedGear,
		]);

		this.root = el('div', { id: 'wh-hud', class: 'wh-hud' }, [this.moneyCol, this.objCard, this.cornerBL, this.speedo]);
		this.root.hidden = true;
		document.body.appendChild(this.root);
	}

	// ------------------------------------------------------------- visibility
	show() { this.root.hidden = false; }
	hide() { this.root.hidden = true; }

	// A coarse hint from the host about what the player is doing. Drives nothing
	// destructive — elements still self-gate on having data — but lets us bias
	// minimap scale (wider when driving) and add a body class for theming.
	setContext(ctx) {
		if (ctx === this._context) return;
		this._context = ctx;
		this.root.dataset.context = ctx;
		this.minimap.setRange(ctx === 'driving' ? 130 : 70);
	}

	// ------------------------------------------------------------------ money
	setCash(n, { animate = true } = {}) {
		this._cash = Number(n) || 0;
		this._announceCash(this._cash);
		if (!animate) { this._cashShown = this._cash; this.cashEl.textContent = fmtCash(this._cash); }
		this.cashRow.hidden = false;
	}
	// The counter animates silently; speak each change after the first snapshot
	// so a screen-reader player hears payouts and spends with the new total.
	_announceCash(total) {
		const prev = this._cashSpoken;
		this._cashSpoken = total;
		if (prev == null || prev === total) return;
		const diff = total - prev;
		const delta = (diff > 0 ? '+' : '-') + fmtCash(Math.abs(diff));
		announce(t('play.cash_changed', '{{delta}} cash, {{total}} total', { delta, total: fmtCash(total) }));
	}

	// A money delta worth celebrating (positive = gain pop, negative = spend).
	bumpCash(delta) {
		this.cashRow.classList.remove('is-gain', 'is-loss');
		void this.cashRow.offsetWidth;
		this.cashRow.classList.add(delta >= 0 ? 'is-gain' : 'is-loss');
	}
	setBanked(n) {
		if (n == null) { this.bankedRow.hidden = true; return; }
		this.bankedEl.textContent = fmtCash(n);
		this.bankedRow.hidden = false;
	}

	// ----------------------------------------------------------------- vitals
	setHealth(hp, maxHp) {
		const max = Number(maxHp) || 0;
		if (max <= 0) { this.hpBar.hidden = true; return; }
		const pct = Math.max(0, Math.min(1, (Number(hp) || 0) / max));
		this.hpBar.hidden = false;
		this.hpFill.style.width = (pct * 100).toFixed(1) + '%';
		this.hpBar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
		this.hpBar.classList.toggle('is-critical', pct <= 0.25);
	}
	setArmor(armor, maxArmor) {
		const max = Number(maxArmor) || 0;
		if (max <= 0) { this.armorBar.hidden = true; return; }
		const pct = Math.max(0, Math.min(1, (Number(armor) || 0) / max));
		this.armorBar.hidden = false;
		this.armorFill.style.width = (pct * 100).toFixed(1) + '%';
		this.armorBar.setAttribute('aria-valuenow', String(Math.round(pct * 100)));
	}

	// ----------------------------------------------------------------- wanted
	setWanted(stars) {
		const s = Math.max(0, Math.min(5, Math.round(Number(stars) || 0)));
		this.wantedRow.hidden = s <= 0;
		this._stars.forEach((node, i) => node.classList.toggle('is-on', i < s));
		this.wantedRow.classList.toggle('is-hunting', s >= 3);
	}

	// -------------------------------------------------------------- objective
	setObjective({ title = '', detail = '', color = '' } = {}) {
		this.objTitle.textContent = title;
		this.objDetail.textContent = detail;
		this.objDetail.hidden = !detail;
		this.objCard.style.setProperty('--obj-accent', color || 'var(--cc-accent, #fff)');
		this.objCard.hidden = !title;
		this.objCard.classList.remove('is-in');
		void this.objCard.offsetWidth;
		this.objCard.classList.add('is-in');
	}
	clearObjective() { this.objCard.hidden = true; }

	// ----------------------------------------------------------------- speedo
	setSpeed({ kmh = 0, gear = '', max = 200 } = {}) {
		this.speedo.hidden = false;
		const v = Math.max(0, Math.round(kmh));
		this.speedNum.textContent = String(v);
		this.speedGear.textContent = gear ? String(gear) : '';
		this.speedGear.hidden = !gear;
		const pct = Math.max(0, Math.min(1, kmh / (max || 200)));
		// Sweep the dial fill from −135° to +135° (270° arc).
		this.speedFill.style.transform = `rotate(${(-135 + pct * 270).toFixed(1)}deg)`;
	}
	hideSpeed() { this.speedo.hidden = true; }

	// ------------------------------------------------------------------- frame
	tick(dt) {
		// Ease the cash counter toward its target so earnings roll up GTA-style.
		if (this._cashShown !== this._cash) {
			const diff = this._cash - this._cashShown;
			const stepTo = Math.abs(diff) < 1 ? this._cash : this._cashShown + diff * Math.min(1, dt * 9);
			this._cashShown = Math.abs(this._cash - stepTo) < 0.5 ? this._cash : stepTo;
			this.cashEl.textContent = fmtCash(this._cashShown);
		}
		this.minimap.tick(dt);
	}

	dispose() {
		this.minimap.dispose();
		this.root?.remove();
	}
}
