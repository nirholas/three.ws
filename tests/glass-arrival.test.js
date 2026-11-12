import { describe, it, expect } from 'vitest';
import { createArrival } from '../src/glass/arrival.js';
import { detectCapabilities } from '../src/glass/caps.js';
import { cardinal } from '../src/glass/compass.js';
import { fixAgeLabel } from '../src/glass/presence.js';

describe('glass arrival', () => {
	it('announces a pin once when it crosses the radius', () => {
		const a = createArrival({ arriveM: 12, leaveM: 20 });
		expect(a.update([{ id: 'p', distance_m: 40 }])).toEqual([]);
		expect(a.update([{ id: 'p', distance_m: 11 }]).map((p) => p.id)).toEqual(['p']);
		expect(a.update([{ id: 'p', distance_m: 5 }])).toEqual([]);
	});
	it('does not refire on jitter at the edge but does after leaving', () => {
		const a = createArrival({ arriveM: 12, leaveM: 20 });
		a.update([{ id: 'p', distance_m: 10 }]);
		expect(a.update([{ id: 'p', distance_m: 14 }])).toEqual([]);
		expect(a.update([{ id: 'p', distance_m: 11 }])).toEqual([]);
		a.update([{ id: 'p', distance_m: 30 }]);
		expect(a.update([{ id: 'p', distance_m: 8 }]).length).toBe(1);
	});
	it('forgets pins that left the feed', () => {
		const a = createArrival();
		a.update([{ id: 'p', distance_m: 3 }]);
		a.update([]);
		expect(a.update([{ id: 'p', distance_m: 3 }]).length).toBe(1);
	});
});

describe('glass capabilities', () => {
	it('proves voice input and audio out from real browser objects', () => {
		expect(detectCapabilities({})).toMatchObject({ speechInput: false, audioOut: false });
		class R {}
		const caps = detectCapabilities({ webkitSpeechRecognition: R, speechSynthesis: { speak() {} }, SpeechSynthesisUtterance: function U() {} });
		expect(caps.speechInput).toBe(true);
		expect(caps.audioOut).toBe(true);
		expect(detectCapabilities({ speechSynthesis: { speak() {} } }).audioOut).toBe(false);
	});
});

describe('glass scanning helpers', () => {
	it('names the heading ring point', () => {
		expect(cardinal(0)).toEqual({ point: 'N', degrees: 0 });
		expect(cardinal(Math.PI / 2)).toEqual({ point: 'E', degrees: 90 });
		expect(cardinal(-Math.PI / 2)).toEqual({ point: 'W', degrees: 270 });
	});
	it('words the age of the last fix', () => {
		expect(fixAgeLabel(null)).toBe('no fix yet');
		expect(fixAgeLabel(1000, 2000)).toBe('just now');
		expect(fixAgeLabel(0, 42000)).toBe('42 s ago');
		expect(fixAgeLabel(0, 300000)).toBe('5 min ago');
	});
});
