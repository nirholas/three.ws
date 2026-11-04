import { describe, it, expect } from 'vitest';
import { intentForKey, createFocusRing, createScrubber } from '../src/glass/dpad.js';

describe('glass dpad', () => {
	it('maps band keys to intents', () => {
		expect(intentForKey('Enter')).toBe('select');
		expect(intentForKey('Escape')).toBe('back');
		expect(intentForKey('ArrowDown')).toBe('next');
		expect(intentForKey('ArrowLeft')).toBe('prev');
		expect(intentForKey('x')).toBeNull();
	});
	it('wraps the focus ring both ways', () => {
		const r = createFocusRing(3);
		expect(r.move(-1)).toBe(2);
		expect(r.move(1)).toBe(0);
		expect(r.move(4)).toBe(1);
	});
	it('clamps the ring when the list shrinks and tolerates empty', () => {
		const r = createFocusRing(5);
		r.set(4);
		expect(r.setSize(2)).toBe(1);
		expect(r.setSize(0)).toBe(0);
		expect(r.move(1)).toBe(0);
	});
	it('emits one step per stepPx of drag and none for small moves', () => {
		const steps = [];
		const s = createScrubber({ stepPx: 40, onStep: (d) => steps.push(d) });
		s.start(0, 0);
		s.move(30, 0);
		s.move(85, 3);
		s.move(20, 0);
		s.end();
		expect(steps).toEqual([2, -2]);
	});
});
