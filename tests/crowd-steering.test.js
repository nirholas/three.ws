// The ambient crowd steers with Yuka (src/game/ambient-crowd.js): arrive at a
// destination while separating from neighbours. This pins the behaviour mix the
// crowd relies on: every vehicle reaches its target, and two walkers sent to the
// same spot do not end up stacked on one point.
import { describe, it, expect } from 'vitest';
import { EntityManager, Vehicle, ArriveBehavior, SeparationBehavior, Vector3 } from 'yuka';

function walker(manager, x, z, target) {
	const v = new Vehicle();
	v.maxSpeed = 1.7; v.maxForce = 6; v.boundingRadius = 0.45;
	v.neighborhoodRadius = 1.6; v.updateNeighborhood = true;
	v.position.set(x, 0, z);
	v.steering.add(new ArriveBehavior(new Vector3(target.x, 0, target.z), 3, 0.4));
	v.steering.add(new SeparationBehavior());
	manager.add(v);
	return v;
}

describe('crowd steering', () => {
	it('gets walkers to a shared destination without stacking them', () => {
		const m = new EntityManager();
		const goal = { x: 10, z: 0 };
		const a = walker(m, 0, 0.2, goal);
		const b = walker(m, 0, -0.2, goal);
		for (let i = 0; i < 60 * 20; i++) m.update(1 / 60);
		const dist = (v) => Math.hypot(v.position.x - goal.x, v.position.z - goal.z);
		expect(dist(a)).toBeLessThan(2);
		expect(dist(b)).toBeLessThan(2);
		expect(a.position.distanceTo(b.position)).toBeGreaterThan(0.3);
	});
});
