// Insert into a Map that must not grow without bound. When the map is at `max`
// entries the least recently used key (first in insertion order) is evicted.
// Pair with `touchBounded` on reads to keep recency.
export function setBounded(map, key, value, max) {
	if (map.has(key)) map.delete(key);
	else if (map.size >= max) map.delete(map.keys().next().value);
	map.set(key, value);
	return value;
}

export function touchBounded(map, key) {
	if (!map.has(key)) return undefined;
	const value = map.get(key);
	map.delete(key);
	map.set(key, value);
	return value;
}
