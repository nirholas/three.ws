import { describe, it, expect } from 'vitest';
import { formatClock, batteryInfo, networkInfo, addNotification, sanitizeNotifications, relTime, parseRun, RUN_ALIASES } from '../src/desktop/chrome/logic.js';

describe('formatClock', () => {
	const d = new Date(2026, 9, 11, 14, 5, 9);
	it('adds seconds only when asked', () => {
		expect(formatClock(d, { clock24: true }).time).not.toMatch(/09$/);
		expect(formatClock(d, { clock24: true, seconds: true }).time).toMatch(/09/);
	});
	it('uses a 24 hour clock when set', () => {
		expect(formatClock(d, { clock24: true }).time).toMatch(/^14/);
		expect(formatClock(d, { clock24: false }).time).toMatch(/^2/);
	});
});

describe('batteryInfo', () => {
	it('is null without a battery', () => {
		expect(batteryInfo(null)).toBeNull();
		expect(batteryInfo({})).toBeNull();
	});
	it('describes discharge with time left and tiers', () => {
		const b = batteryInfo({ level: 0.2, charging: false, dischargingTime: 5400, chargingTime: Infinity });
		expect(b).toMatchObject({ pct: 20, charging: false, tier: 'low', label: '1 h 30 min remaining' });
		expect(batteryInfo({ level: 0.05, charging: false, dischargingTime: Infinity }).tier).toBe('critical');
		expect(batteryInfo({ level: 0.8, charging: false, dischargingTime: Infinity }).label).toBe('On battery');
	});
	it('describes charging and full', () => {
		expect(batteryInfo({ level: 0.5, charging: true, chargingTime: 1200 }).label).toBe('Charging, full in 20 min');
		expect(batteryInfo({ level: 1, charging: true, chargingTime: 0 }).label).toBe('Fully charged');
	});
});

describe('networkInfo', () => {
	it('reports offline', () => {
		expect(networkInfo({ online: false })).toMatchObject({ online: false, label: 'Offline' });
	});
	it('names the link and its quality', () => {
		const n = networkInfo({ online: true, type: 'wifi', effectiveType: '4g', downlink: 9.5, rtt: 50 });
		expect(n.label).toBe('Wi-Fi');
		expect(n.detail).toBe('4G / 9.5 Mbps / 50 ms');
		expect(networkInfo({ online: true }).detail).toBe('Internet access');
	});
});

describe('notifications', () => {
	it('prepends newest first and caps', () => {
		let list = [];
		for (let i = 0; i < 60; i++) list = addNotification(list, { title: `n${i}` }, 1000 + i);
		expect(list).toHaveLength(50);
		expect(list[0].title).toBe('n59');
	});
	it('ignores empty notes and promotes a lone body to the title', () => {
		expect(addNotification([], { title: ' ', body: '' })).toEqual([]);
		expect(addNotification([], { body: 'Saved' })[0]).toMatchObject({ title: 'Saved', body: '' });
	});
	it('sanitizes stored lists', () => {
		const good = addNotification([], { title: 'ok', body: 'b', app: 'files' }, 5);
		expect(sanitizeNotifications(JSON.stringify([...good, { id: 3 }, null, 'x']))).toEqual(good);
		expect(sanitizeNotifications('{bad')).toEqual([]);
		expect(sanitizeNotifications({})).toEqual([]);
	});
});

describe('relTime', () => {
	const now = 1_000_000_000;
	it('buckets', () => {
		expect(relTime(now - 10_000, now)).toBe('Just now');
		expect(relTime(now - 5 * 60_000, now)).toBe('5 min ago');
		expect(relTime(now - 3 * 3_600_000, now)).toBe('3 h ago');
	});
});

describe('parseRun', () => {
	it('classifies input', () => {
		expect(parseRun('  ')).toEqual({ kind: 'empty' });
		expect(parseRun('https://three.ws/forge')).toEqual({ kind: 'url', value: 'https://three.ws/forge' });
		expect(parseRun('example.com')).toEqual({ kind: 'url', value: 'https://example.com' });
		expect(parseRun('/forge')).toEqual({ kind: 'path', value: '/forge' });
		expect(parseRun('/Documents/a.txt')).toEqual({ kind: 'file', value: '/Documents/a.txt' });
		expect(parseRun('~')).toEqual({ kind: 'file', value: '/' });
		expect(parseRun('~/Pictures')).toEqual({ kind: 'file', value: '/Pictures' });
		expect(parseRun('Notepad')).toEqual({ kind: 'query', value: 'notepad' });
	});
	it('maps the classic aliases to apps', () => {
		expect(RUN_ALIASES.cmd).toBe('terminal');
		expect(RUN_ALIASES.calc).toBe('calculator');
		expect(RUN_ALIASES.winver).toBe('about');
	});
});
