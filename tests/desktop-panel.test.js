import { describe, it, expect } from 'vitest';
import {
	placePanel,
	anchorFor,
	shouldOpenOnClick,
	faceView,
	trayTitle,
	trayTooltip,
	formatSol,
	shortAddress,
	ago,
	agentPower,
	localSummary,
	PANEL_WIDTH,
	PANEL_HEIGHT,
} from '../apps/desktop/src/panel/model.js';

const size = { width: PANEL_WIDTH, height: PANEL_HEIGHT };
const screen = { x: 0, y: 25, width: 1440, height: 875 };

describe('menu bar panel placement', () => {
	it('drops below a menu bar icon, centered on it', () => {
		const r = placePanel({ x: 1000, y: 0, width: 24, height: 24 }, size, screen);
		expect(r.y).toBe(33);
		expect(r.x + r.width / 2).toBeCloseTo(1012, -1);
	});

	it('opens above a taskbar icon', () => {
		const r = placePanel({ x: 1300, y: 876, width: 24, height: 24 }, size, { x: 0, y: 0, width: 1440, height: 870 });
		expect(r.y + r.height).toBeLessThanOrEqual(870 - 8);
		expect(r.y).toBeLessThan(876);
	});

	it('stays inside the work area at the right edge', () => {
		const r = placePanel({ x: 1430, y: 0, width: 10, height: 24 }, size, screen);
		expect(r.x + r.width).toBeLessThanOrEqual(1440 - 8);
	});

	it('stays inside the work area at the left edge', () => {
		expect(placePanel({ x: 0, y: 0, width: 10, height: 24 }, size, screen).x).toBe(8);
	});

	it('shrinks to fit a short display', () => {
		const r = placePanel({ x: 500, y: 0, width: 24, height: 24 }, size, { x: 0, y: 25, width: 1280, height: 400 });
		expect(r.height).toBe(384);
		expect(r.y + r.height).toBeLessThanOrEqual(425);
	});

	it('falls back to the cursor when the OS reports no tray bounds (Linux)', () => {
		expect(anchorFor({ x: 0, y: 0, width: 0, height: 0 }, { x: 900, y: 10 })).toEqual({ x: 900, y: 10, width: 1, height: 1 });
		expect(anchorFor(undefined, { x: 5, y: 6 })).toEqual({ x: 5, y: 6, width: 1, height: 1 });
		const bounds = { x: 1, y: 2, width: 3, height: 4 };
		expect(anchorFor(bounds, { x: 9, y: 9 })).toBe(bounds);
	});

	it('does not reopen on the click that just closed it', () => {
		expect(shouldOpenOnClick(1000, 1100)).toBe(false);
		expect(shouldOpenOnClick(1000, 1400)).toBe(true);
		expect(shouldOpenOnClick(0, 5)).toBe(true);
	});
});

describe('menu bar panel avatar and tray state', () => {
	it('waves when something needs approval and walks while working', () => {
		expect(faceView({ state: 'waiting_approval' }).gesture).toBe('wave');
		expect(faceView({ state: 'working' }).gesture).toBe('walk');
		expect(faceView({ state: 'error' }).tone).toBe('bad');
	});

	it('has a view for no local agents and for an unknown state', () => {
		expect(faceView({ state: 'none' }).key).toBe('none');
		expect(faceView(undefined).key).toBe('none');
		expect(faceView({ state: 'mystery' }).key).toBe('none');
	});

	it('puts approvals ahead of unread in the menu bar title', () => {
		expect(trayTitle({ pendingApprovals: 2, unread: 9 })).toBe('2 to approve');
		expect(trayTitle({ unread: 4 })).toBe('4');
		expect(trayTitle({ unread: 250 })).toBe('99+');
		expect(trayTitle({})).toBe('');
	});

	it('writes a tooltip for every signed-in state', () => {
		expect(trayTooltip({ signedIn: false })).toBe('three.ws Desktop: Not signed in');
		expect(trayTooltip({ signedIn: true, name: 'Ada', pendingApprovals: 1, unread: 3 })).toBe('three.ws Desktop: Ada, 1 awaiting approval, 3 unread');
	});
});

describe('menu bar panel formatting', () => {
	it('formats balances at every scale', () => {
		expect(formatSol(0)).toBe('0');
		expect(formatSol(0.0123456)).toBe('0.0123');
		expect(formatSol(1.23456)).toBe('1.235');
		expect(formatSol(12345.6)).toBe('12,346');
		expect(formatSol(null)).toBeNull();
		expect(formatSol(undefined)).toBeNull();
		expect(formatSol('abc')).toBeNull();
	});

	it('shortens addresses and leaves short strings alone', () => {
		expect(shortAddress('FeMbDoX7R1Psc4GEcvJdsbNbZA3bfztcyDCatJVJpump')).toBe('FeMb...pump');
		expect(shortAddress('abc')).toBe('abc');
		expect(shortAddress(null)).toBe('');
	});

	it('words elapsed time', () => {
		const now = 1_000_000;
		expect(ago(now - 2000, now)).toBe('just now');
		expect(ago(now - 42_000, now)).toBe('42s ago');
		expect(ago(now - 5 * 60_000, now)).toBe('5m ago');
		expect(ago(now - 3 * 3_600_000, now)).toBe('3h ago');
		expect(ago(null, now)).toBeNull();
	});
});

describe('menu bar panel agent controls', () => {
	it('reads the cloud lifecycle', () => {
		expect(agentPower({ status: 'running' })).toMatchObject({ on: true, known: true });
		expect(agentPower({ status: 'stopped' })).toMatchObject({ on: false, known: true });
		expect(agentPower({ status: 'draft' }).known).toBe(false);
		expect(agentPower({ status: null, isPublished: true })).toMatchObject({ on: true, known: false, label: 'Live' });
		expect(agentPower(null).label).toBe('No agent');
	});

	it('decides whether the local tile pauses or resumes', () => {
		expect(localSummary([])).toMatchObject({ total: 0, action: 'pause', allPaused: false });
		expect(localSummary([{ status: 'idle' }, { status: 'paused' }])).toMatchObject({ total: 2, paused: 1, action: 'pause' });
		expect(localSummary([{ status: 'paused' }, { status: 'paused' }])).toMatchObject({ allPaused: true, action: 'resume' });
		expect(localSummary([{ status: 'paused' }, { status: 'killed' }])).toMatchObject({ total: 1, allPaused: true });
	});
});
