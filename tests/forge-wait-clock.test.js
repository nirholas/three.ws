// The Forge wait meter's clocks (src/forge-wait-clock.js).
//
// Bug reproduced here (live run 2026-11-27): the job row, and so the
// `elapsed_seconds` every poll reports, is created only after the art director,
// the reference image and the lane submit have finished. The page started its
// clock at the click and then snapped to the server's job age "in both
// directions", so after a slow image step the Elapsed readout jumped backwards
// (for example 1:10 to 0:03), and the measured lane range (p50/p95 of
// created_at to completed_at) was compared against a clock that included time
// those percentiles never measured.

import { describe, it, expect } from 'vitest';
import { createWaitClock } from '../src/forge-wait-clock.js';

function fakeTime() {
	let t = 1_000_000;
	return { now: () => t, advance: (s) => (t += s * 1000) };
}

describe('forge wait clock', () => {
	it('never runs the Elapsed readout backwards when the job is created after a long image step', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.start();
		time.advance(70); // director + reference image + lane submit
		clock.accepted();
		time.advance(3);
		clock.anchor(3); // first poll: the job row is 3 s old
		expect(clock.totalS()).toBe(73);
	});

	it('has no lane time before the job is accepted, so no lane range is judged against the image step', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.start();
		time.advance(70);
		expect(clock.laneS()).toBeNull();
		expect(clock.totalS()).toBe(70);
	});

	it('measures lane time from acceptance and follows the server job age', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.start();
		time.advance(70);
		clock.accepted();
		time.advance(10);
		expect(clock.laneS()).toBe(10);
		clock.anchor(14); // the server says the row is older than the local guess
		expect(clock.laneS()).toBe(14);
		expect(clock.totalS()).toBe(80);
	});

	it('takes a larger server age for both clocks on a coalesced job already in flight', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.start();
		time.advance(5);
		clock.accepted();
		clock.anchor(200);
		expect(clock.totalS()).toBe(200);
		expect(clock.laneS()).toBe(200);
	});

	it('restarts lane time for a failover successor without touching the Elapsed readout', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.start();
		time.advance(30);
		clock.accepted();
		time.advance(300);
		clock.anchor(300);
		clock.anchor(4, { laneChanged: true }); // the successor job on the next lane is 4 s old
		expect(clock.laneS()).toBe(4);
		expect(clock.totalS()).toBe(330);
	});

	it('does not rewind on a younger age from an inconsistent poll of the same lane', () => {
		// Live run 2026-11-27, one trellis_selfhost job: the server reads the job
		// age when it handles the poll, and two polls took about 30 s to answer, so
		// the page received 17 s, then 22 s 34 s later, then 56 s, then 95 s 11 s
		// later. A job cannot get younger on the same lane, so the clock keeps the
		// oldest age it has been told and only moves forward.
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.start();
		time.advance(40);
		clock.accepted();
		time.advance(17);
		clock.anchor(17);
		time.advance(34);
		clock.anchor(22);
		expect(clock.laneS()).toBe(51);
		expect(clock.totalS()).toBe(91);
		time.advance(11);
		clock.anchor(95);
		expect(clock.laneS()).toBe(95);
	});

	it('starts both clocks at the job age on a resumed page', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.resume(95);
		expect(clock.totalS()).toBe(95);
		expect(clock.laneS()).toBe(95);
	});

	it('lets the first server age correct a resumed lane clock downwards, then only forward', () => {
		// A resumed page knows only when the click happened (the in-flight record),
		// not when the job reached the GPU, so its local lane guess is provisional
		// until the first poll names the job's real age.
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.resume(120);
		clock.anchor(50);
		expect(clock.laneS()).toBe(50);
		expect(clock.totalS()).toBe(120);
		time.advance(10);
		clock.anchor(20);
		expect(clock.laneS()).toBe(60);
	});

	it('has no lane time on a page resumed before the submit answered', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.resume(30, { onLane: false });
		expect(clock.laneS()).toBeNull();
		expect(clock.totalS()).toBe(30);
		clock.accepted();
		time.advance(5);
		expect(clock.laneS()).toBe(5);
	});

	it('ignores drift under two seconds and junk ages', () => {
		const time = fakeTime();
		const clock = createWaitClock({ now: time.now });
		clock.start();
		clock.accepted();
		time.advance(10);
		expect(clock.anchor(11)).toBe(false);
		expect(clock.anchor(undefined)).toBe(false);
		expect(clock.anchor(-5)).toBe(false);
		expect(clock.laneS()).toBe(10);
	});
});
