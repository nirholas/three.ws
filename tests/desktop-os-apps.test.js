// Pure logic behind the native desktop apps: calculator engine, unit table, clock logic, weather codes.
import { describe, it, expect } from 'vitest';
import { evaluate, formatNumber, evalProgrammer, toBase, parseInBase, factorial, CalcError } from '../src/desktop/os/apps/calc-engine.js';
import { convert, CATEGORIES } from '../src/desktop/os/apps/unit-convert.js';
import { nextAlarmTime, repeatLabel, formatDuration, parseDuration, stopwatch, lapExtremes, zoneOffsetMinutes, offsetLabel, relativeOffset, isValidZone, checkAlarms, checkTimers, untilLabel } from '../src/desktop/os/apps/alarm-logic.js';
import { describe as wx, compass, uvLabel } from '../src/desktop/os/apps/weather-codes.js';
import { normalise } from '../src/desktop/os/apps/weather-data.js';

describe('calc-engine evaluate', () => {
	it('respects precedence and associativity', () => {
		expect(evaluate('2+3*4')).toBe(14);
		expect(evaluate('(2+3)*4')).toBe(20);
		expect(evaluate('2^3^2')).toBe(512);
		expect(evaluate('-2^2')).toBe(-4);
		expect(evaluate('2^-1')).toBe(0.5);
		expect(evaluate('10-4-3')).toBe(3);
		expect(evaluate('8/2/2')).toBe(2);
	});
	it('handles implicit multiplication, percent, factorial', () => {
		expect(evaluate('2(3+1)')).toBe(8);
		expect(evaluate('2pi')).toBeCloseTo(Math.PI * 2);
		expect(evaluate('50%')).toBe(0.5);
		expect(evaluate('200*10%')).toBe(20);
		expect(evaluate('10%3')).toBe(1);
		expect(evaluate('5!')).toBe(120);
		expect(factorial(0)).toBe(1);
	});
	it('applies degrees and radians to trig', () => {
		expect(evaluate('sin(90)', { angle: 'deg' })).toBeCloseTo(1);
		expect(evaluate('sin(180)', { angle: 'deg' })).toBe(0);
		expect(evaluate('cos(pi)', { angle: 'rad' })).toBeCloseTo(-1);
		expect(evaluate('asin(1)', { angle: 'deg' })).toBeCloseTo(90);
	});
	it('supports logs, roots, multi-arg functions and ans', () => {
		expect(evaluate('log(1000)')).toBeCloseTo(3);
		expect(evaluate('ln(e)')).toBeCloseTo(1);
		expect(evaluate('sqrt(16)+cbrt(27)')).toBe(7);
		expect(evaluate('root(27,3)')).toBeCloseTo(3);
		expect(evaluate('max(2,9)-min(4,1)')).toBe(8);
		expect(evaluate('ans*2', { ans: 21 })).toBe(42);
		expect(evaluate('×'.length ? '6×7÷2' : '')).toBe(21);
	});
	it('rejects bad input without evaluating code', () => {
		expect(() => evaluate('2+')).toThrow(CalcError);
		expect(() => evaluate('(2')).toThrow(/parentheses/);
		expect(() => evaluate('1/0')).toThrow(/zero/);
		expect(() => evaluate('sqrt(-1)')).toThrow(/Not a number/);
		expect(() => evaluate('alert(1)')).toThrow(/Unknown name/);
		expect(() => evaluate('constructor')).toThrow(CalcError);
		expect(() => evaluate('sin 30')).toThrow(/parentheses/);
		expect(() => evaluate('(-1)!')).toThrow(/whole number/);
		expect(() => evaluate('')).toThrow(CalcError);
	});
	it('formats results', () => {
		expect(formatNumber(1234567.891)).toBe('1,234,567.891');
		expect(formatNumber(0.1 + 0.2)).toBe('0.3');
		expect(formatNumber(-1000)).toBe('-1,000');
		expect(formatNumber(1e21)).toMatch(/e21$/);
		expect(formatNumber(0)).toBe('0');
	});
});

describe('calc-engine programmer mode', () => {
	it('evaluates bitwise operators and masks to the width', () => {
		expect(evalProgrammer('F0 & 3C', 'hex', 8)).toBe(0x30n);
		expect(evalProgrammer('1 << 4 | 1', 'dec', 16)).toBe(17n);
		expect(evalProgrammer('~0', 'dec', 8)).toBe(255n);
		expect(evalProgrammer('255 + 1', 'dec', 8)).toBe(0n);
		expect(evalProgrammer('-1', 'dec', 16)).toBe(0xffffn);
		expect(evalProgrammer('(2+3)*4', 'dec', 32)).toBe(20n);
		expect(evalProgrammer('1010 XOR 0110', 'bin', 8)).toBe(0b1100n);
		expect(evalProgrammer('0xFF + 1', 'dec', 16)).toBe(256n);
	});
	it('divides signed and rejects bad digits', () => {
		expect(() => evalProgrammer('5/0', 'dec', 8)).toThrow(/zero/);
		expect(() => evalProgrammer('9', 'oct', 8)).toThrow(CalcError);
		expect(evalProgrammer('-8/2', 'dec', 8)).toBe(BigInt.asUintN(8, -4n));
	});
	it('converts between bases', () => {
		expect(toBase(255n, 'hex', 16)).toBe('FF');
		expect(toBase(5n, 'bin', 8)).toBe('0000 0101');
		expect(toBase(8n, 'oct', 8)).toBe('10');
		expect(parseInBase('ff', 'hex')).toBe(255n);
		expect(() => parseInBase('12', 'bin')).toThrow(CalcError);
	});
});

describe('unit-convert', () => {
	it('converts linear units', () => {
		expect(convert('length', 'km', 'mi', 1)).toBeCloseTo(0.621371, 5);
		expect(convert('length', 'ft', 'in', 1)).toBeCloseTo(12);
		expect(convert('mass', 'lb', 'kg', 10)).toBeCloseTo(4.5359237);
		expect(convert('data', 'GiB', 'MiB', 1)).toBe(1024);
		expect(convert('time', 'h', 'min', 2)).toBe(120);
		expect(convert('speed', 'mph', 'kmh', 60)).toBeCloseTo(96.56064);
		expect(convert('volume', 'gal', 'l', 1)).toBeCloseTo(3.785411784);
		expect(convert('area', 'ac', 'ha', 1)).toBeCloseTo(0.404686, 5);
	});
	it('converts temperature including absolute zero', () => {
		expect(convert('temperature', 'C', 'F', 100)).toBe(212);
		expect(convert('temperature', 'F', 'C', -40)).toBeCloseTo(-40);
		expect(convert('temperature', 'K', 'C', 0)).toBeCloseTo(-273.15);
		expect(() => convert('temperature', 'K', 'C', -1)).toThrow(/absolute zero/);
	});
	it('round-trips every unit in every category', () => {
		for (const [cat, def] of Object.entries(CATEGORIES)) {
			const keys = Object.keys(def.units);
			for (const a of keys) for (const b of keys) {
				const v = convert(cat, b, a, convert(cat, a, b, 37));
				expect(v).toBeCloseTo(37, 6);
			}
		}
	});
	it('rejects unknown units and non-numbers', () => {
		expect(() => convert('length', 'm', 'zz', 1)).toThrow();
		expect(() => convert('nope', 'm', 'm', 1)).toThrow();
		expect(() => convert('length', 'm', 'km', NaN)).toThrow();
	});
});

describe('alarm-logic', () => {
	it('finds the next one-shot and repeating alarm time', () => {
		const from = new Date(2026, 9, 11, 10, 0, 0); // Sunday
		expect(nextAlarmTime({ on: true, h: 11, m: 30, days: [] }, from)).toEqual(new Date(2026, 9, 11, 11, 30));
		expect(nextAlarmTime({ on: true, h: 9, m: 0, days: [] }, from)).toEqual(new Date(2026, 9, 12, 9, 0));
		expect(nextAlarmTime({ on: true, h: 9, m: 0, days: [3] }, from)).toEqual(new Date(2026, 9, 14, 9, 0));
		expect(nextAlarmTime({ on: false, h: 9, m: 0, days: [] }, from)).toBeNull();
	});
	it('fires alarms that crossed their time since the last tick, once', () => {
		const a = { id: 'a', on: true, h: 10, m: 0, days: [] };
		const last = new Date(2026, 9, 11, 9, 59, 0).getTime();
		const now = new Date(2026, 9, 11, 10, 0, 1).getTime();
		const r = checkAlarms([a], now, last);
		expect(r.fired).toHaveLength(1);
		expect(r.alarms[0].on).toBe(false);
		expect(checkAlarms(r.alarms, now + 1000, now).fired).toHaveLength(0);
		const rep = { ...a, days: [0] };
		expect(checkAlarms([rep], now, last).alarms[0].on).toBe(true);
	});
	it('finishes timers at their end time', () => {
		const t = { id: 't', endsAt: 1000, done: false };
		expect(checkTimers([t], 999).fired).toHaveLength(0);
		const r = checkTimers([t], 1000);
		expect(r.fired).toHaveLength(1);
		expect(r.timers[0].done).toBe(true);
	});
	it('labels repeats and durations', () => {
		expect(repeatLabel([])).toBe('Once');
		expect(repeatLabel([1, 2, 3, 4, 5])).toBe('Weekdays');
		expect(repeatLabel([0, 6])).toBe('Weekends');
		expect(repeatLabel([1, 3])).toBe('Mon, Wed');
		expect(formatDuration(65000)).toBe('01:05');
		expect(formatDuration(3723450, true)).toBe('1:02:03.45');
		expect(parseDuration('1:30')).toBe(90000);
		expect(parseDuration('5m 30s')).toBe(330000);
		expect(parseDuration('45')).toBe(45000);
		expect(parseDuration('abc')).toBeNull();
		expect(untilLabel(new Date(2026, 0, 1, 12, 20), new Date(2026, 0, 1, 9, 0))).toBe('in 3 h 20 min');
	});
	it('runs a stopwatch with laps', () => {
		let s = stopwatch.start(stopwatch.fresh(), 1000);
		s = stopwatch.lap(s, 2500);
		s = stopwatch.lap(s, 3000);
		expect(s.laps.map((l) => l.split)).toEqual([1500, 500]);
		expect(lapExtremes(s.laps)).toEqual({ fastest: 2, slowest: 1 });
		s = stopwatch.pause(s, 4000);
		expect(stopwatch.now(s, 9999)).toBe(3000);
	});
	it('computes real zone offsets through Intl', () => {
		const d = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
		expect(zoneOffsetMinutes('UTC', d)).toBe(0);
		expect(zoneOffsetMinutes('Asia/Kolkata', d)).toBe(330);
		expect(zoneOffsetMinutes('America/New_York', d)).toBe(-300);
		expect(zoneOffsetMinutes('America/New_York', new Date(Date.UTC(2026, 6, 15)))).toBe(-240);
		expect(isValidZone('Europe/Paris')).toBe(true);
		expect(isValidZone('Mars/Olympus')).toBe(false);
		expect(offsetLabel(330)).toBe('UTC+5:30');
		expect(offsetLabel(-300)).toBe('UTC-5');
		expect(relativeOffset(330, 0)).toBe('+5 h 30 min');
		expect(relativeOffset(0, 0)).toBe('Same time');
	});
});

describe('weather codes and data', () => {
	it('maps WMO codes', () => {
		expect(wx(0, true)).toEqual({ label: 'Clear sky', kind: 'clear', night: false });
		expect(wx(0, false).label).toBe('Clear night');
		expect(wx(63).kind).toBe('rain');
		expect(wx(95).kind).toBe('storm');
		expect(wx(999).label).toBe('Unknown');
		expect(compass(0)).toBe('N');
		expect(compass(225)).toBe('SW');
		expect(uvLabel(7)).toBe('High');
	});
	it('normalises an Open-Meteo response', () => {
		const times = Array.from({ length: 48 }, (_, i) => `2026-10-11T${String(i % 24).padStart(2, '0')}:00`);
		const raw = {
			timezone: 'Europe/Paris',
			current: { time: '2026-10-11T10:15', temperature_2m: 12, apparent_temperature: 10, relative_humidity_2m: 70, weather_code: 3, is_day: 1, precipitation: 0, wind_speed_10m: 9, wind_direction_10m: 200, surface_pressure: 1010 },
			hourly: { time: times, temperature_2m: times.map((_, i) => i), precipitation_probability: times.map(() => 5), weather_code: times.map(() => 1), is_day: times.map(() => 1) },
			daily: { time: ['2026-10-11'], weather_code: [3], temperature_2m_max: [15], temperature_2m_min: [8], sunrise: ['2026-10-11T07:50'], sunset: ['2026-10-11T18:55'], uv_index_max: [3], precipitation_probability_max: [20], wind_speed_10m_max: [18] },
		};
		const n = normalise(raw, 'C');
		expect(n.hourly).toHaveLength(24);
		expect(n.hourly[0].time).toBe('2026-10-11T10:00');
		expect(n.current.isDay).toBe(true);
		expect(n.daily[0].max).toBe(15);
		expect(n.units.wind).toBe('km/h');
	});
});

import { captureName, pickRecorderType, extForRecorderType, classifyMediaError, elapsedLabel } from '../src/desktop/os/apps/camera-logic.js';

describe('camera-logic', () => {
	it('names captures with a valid, sortable file name', () => {
		expect(captureName(new Date(2026, 9, 11, 7, 5, 9), 'png')).toBe('Camera 2026-10-11 07.05.09.png');
	});
	it('picks the first supported recorder type', () => {
		expect(pickRecorderType((t) => t === 'video/webm')).toBe('video/webm');
		expect(pickRecorderType(() => false)).toBe('');
		expect(extForRecorderType('video/mp4')).toBe('mp4');
		expect(extForRecorderType('video/webm;codecs=vp9,opus')).toBe('webm');
	});
	it('maps getUserMedia errors to recovery steps', () => {
		expect(classifyMediaError({ name: 'NotAllowedError' }).kind).toBe('denied');
		expect(classifyMediaError({ name: 'NotFoundError' }).kind).toBe('none');
		expect(classifyMediaError({ name: 'NotReadableError' }).kind).toBe('busy');
		expect(classifyMediaError({ name: 'Weird', message: 'boom' }).steps[0]).toBe('boom');
		expect(classifyMediaError(null, { hasMediaDevices: false }).kind).toBe('unsupported');
		expect(classifyMediaError(null, { secure: false }).kind).toBe('insecure');
		expect(classifyMediaError({ name: 'NotAllowedError' }).steps.length).toBeGreaterThan(1);
	});
	it('formats elapsed recording time', () => {
		expect(elapsedLabel(0)).toBe('0:00');
		expect(elapsedLabel(65000)).toBe('1:05');
	});
});

import { floodFill, History, hexToRgb, rgbToHex, stepZoom, fitZoom, constrain, pressureWidth, clampDim, formatForName } from '../src/desktop/os/apps/paint-logic.js';

function img(w, h, fill = [255, 255, 255, 255]) {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
	return { data, width: w, height: h };
}
const px = (im, x, y) => [...im.data.slice((y * im.width + x) * 4, (y * im.width + x) * 4 + 4)];

describe('paint-logic', () => {
	it('flood fills a bounded region only', () => {
		const im = img(5, 5);
		for (let i = 0; i < 5; i++) im.data.set([0, 0, 0, 255], (2 * 5 + i) * 4); // black wall across row 2
		const n = floodFill(im, 0, 0, [255, 0, 0]);
		expect(n).toBe(10);
		expect(px(im, 4, 1)).toEqual([255, 0, 0, 255]);
		expect(px(im, 0, 3)).toEqual([255, 255, 255, 255]);
		expect(px(im, 2, 2)).toEqual([0, 0, 0, 255]);
	});
	it('fills diagonal-gap regions without leaking through 4-connected walls', () => {
		const im = img(3, 3);
		[[1, 0], [0, 1]].forEach(([x, y]) => im.data.set([0, 0, 0, 255], (y * 3 + x) * 4));
		expect(floodFill(im, 0, 0, [9, 9, 9])).toBe(1);
	});
	it('honours tolerance and opacity', () => {
		const im = img(4, 1);
		im.data.set([250, 250, 250, 255], 4);
		expect(floodFill(img(4, 1), 0, 0, [0, 0, 0], { tolerance: 0, opacity: 0.5 })).toBe(4);
		expect(floodFill(im, 0, 0, [0, 0, 0], { tolerance: 0 })).toBe(1);
		const im2 = img(4, 1);
		im2.data.set([250, 250, 250, 255], 4);
		expect(floodFill(im2, 0, 0, [0, 0, 0], { tolerance: 10 })).toBe(4);
		const half = img(1, 1);
		floodFill(half, 0, 0, [0, 0, 0], { opacity: 0.5 });
		expect(px(half, 0, 0)[0]).toBe(128);
	});
	it('ignores out-of-bounds starts and fills large areas without recursion limits', () => {
		const im = img(2, 2);
		expect(floodFill(im, -1, 0, [0, 0, 0])).toBe(0);
		expect(floodFill(im, 5, 5, [0, 0, 0])).toBe(0);
		expect(floodFill(img(600, 600), 10, 10, [1, 2, 3])).toBe(360000);
	});
	it('undoes and redoes snapshots and bounds memory', () => {
		const h = new History({ maxCount: 3 });
		const s = (n) => ({ data: new Uint8Array(n), tag: n });
		h.push(s(1));
		h.push(s(2));
		expect(h.canUndo).toBe(true);
		const prev = h.undo(s(3));
		expect(prev.tag).toBe(2);
		expect(h.canRedo).toBe(true);
		expect(h.redo(prev).tag).toBe(3);
		h.push(s(4));
		expect(h.canRedo).toBe(false);
		h.push(s(5));
		h.push(s(6));
		expect(h.undoStack.length).toBe(3);
		const big = new History({ maxBytes: 100 });
		big.push(s(60));
		big.push(s(60));
		expect(big.undoStack.length).toBe(1);
		expect(new History().undo(s(1))).toBeNull();
	});
	it('parses colours and zoom and shapes', () => {
		expect(hexToRgb('#ff8000')).toEqual([255, 128, 0]);
		expect(hexToRgb('f00')).toEqual([255, 0, 0]);
		expect(hexToRgb('nope')).toBeNull();
		expect(rgbToHex(255, 128, 0)).toBe('#ff8000');
		expect(stepZoom(1, 1)).toBe(1.25);
		expect(stepZoom(1, -1)).toBe(0.75);
		expect(stepZoom(8, 1)).toBe(8);
		expect(fitZoom(2000, 1000, 1000, 1000)).toBe(0.5);
		expect(fitZoom(100, 100, 1000, 1000)).toBe(1);
		const [sx, sy] = constrain('rect', 0, 0, 10, 4);
		expect([sx, sy]).toEqual([10, 10]);
		const [lx, ly] = constrain('line', 0, 0, 10, 1);
		expect(Math.round(lx)).toBe(10);
		expect(Math.abs(ly)).toBeLessThan(1e-9);
		expect(pressureWidth(10, 'mouse', 0.9)).toBe(10);
		expect(pressureWidth(10, 'pen', 0.5)).toBeCloseTo(10);
		expect(clampDim(99999)).toBe(8192);
		expect(clampDim('abc')).toBe(1);
		expect(formatForName('a.JPG').mime).toBe('image/jpeg');
		expect(formatForName('a.bin').ext).toBe('png');
	});
});
