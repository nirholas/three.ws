// Arrival detection for the /glass lens: the first time the wearer comes within a
// pin's radius, that agent is promoted to the lens once. A pin must leave the
// radius by a margin before it can announce itself again, so GPS jitter at the
// edge never re-fires it.

export const ARRIVE_M = 12;
export const LEAVE_M = 20;

export function createArrival({ arriveM = ARRIVE_M, leaveM = LEAVE_M } = {}) {
	const inside = new Set();
	return {
		// pins: [{ id, distance_m }]. Returns the pins that just crossed inward.
		update(pins) {
			const arrived = [];
			const seen = new Set();
			for (const pin of pins) {
				seen.add(pin.id);
				if (inside.has(pin.id)) {
					if (pin.distance_m > leaveM) inside.delete(pin.id);
				} else if (pin.distance_m <= arriveM) {
					inside.add(pin.id);
					arrived.push(pin);
				}
			}
			for (const id of inside) if (!seen.has(id)) inside.delete(id);
			return arrived;
		},
		reset() { inside.clear(); },
	};
}
