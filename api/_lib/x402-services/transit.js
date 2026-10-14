// Live, keyless transit trip planning and delay snapshots over the MBTA's
// public GTFS / GTFS-RT V3 API (a public, keyless JSON projection of its
// static schedule plus realtime TripUpdates). No fixture mode: an upstream
// outage surfaces as a 502, never invented departure times.

const THREE_WS_UA = 'three.ws/1.0 (+https://three.ws; support@three.ws)';
const API_BASE = 'https://api-v3.mbta.com';
const AGENCY_NAME = 'MBTA (Massachusetts Bay Transportation Authority)';
const AGENCY_TIMEZONE = 'America/New_York';
const TIMEOUT_MS = 12_000;
const ON_TIME_SECONDS = 60;
const ROUTE_TYPES = { 0: 'light-rail', 1: 'subway', 2: 'commuter-rail', 3: 'bus', 4: 'ferry' };
const LATLON = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/;

class BadRequestError extends Error {}
class NotFoundError extends Error {}
class UpstreamError extends Error {}

async function feedGet(path, params) {
	const qs = new URLSearchParams(params).toString();
	const url = `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
	let res;
	try {
		res = await fetch(url, {
			headers: { accept: 'application/vnd.api+json', 'user-agent': THREE_WS_UA },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});
	} catch (err) {
		throw new UpstreamError(`Feed GET ${path} failed: ${err.message}`);
	}
	if (!res.ok) {
		const body = await res.text();
		throw new UpstreamError(`Feed GET ${path} failed: HTTP ${res.status} ${body.slice(0, 300)}`);
	}
	const doc = await res.json();
	return { data: doc.data ?? [], included: doc.included ?? [] };
}

function indexIncluded(doc) {
	const map = new Map();
	for (const r of doc.included ?? []) map.set(`${r.type}:${r.id}`, r);
	return map;
}

function related(resource, name, index) {
	const ref = resource.relationships?.[name]?.data;
	if (!ref) return undefined;
	return index.get(`${ref.type}:${ref.id}`);
}

function relatedId(resource, name) {
	return resource?.relationships?.[name]?.data?.id ?? undefined;
}

function attr(resource, name) {
	return resource?.attributes?.[name];
}

let stationCache = null;
const STATION_TTL_MS = 60 * 60 * 1000;

async function stations() {
	if (stationCache && Date.now() - stationCache.fetchedAt < STATION_TTL_MS) return stationCache.stations;
	const doc = await feedGet('/stops', { 'filter[location_type]': '1', 'page[limit]': '500' });
	const list = doc.data.map((s) => ({
		id: s.id,
		name: String(attr(s, 'name') ?? s.id),
		latitude: Number(attr(s, 'latitude') ?? 0),
		longitude: Number(attr(s, 'longitude') ?? 0),
		municipality: String(attr(s, 'municipality') ?? ''),
	}));
	stationCache = { stations: list, fetchedAt: Date.now() };
	return list;
}

export async function searchStations(rawQuery, limit = 10) {
	const q = rawQuery.trim().toLowerCase();
	if (!q) return [];
	const all = await stations();
	const exact = all.filter((s) => s.name.toLowerCase() === q);
	const prefix = all.filter((s) => s.name.toLowerCase().startsWith(q) && !exact.includes(s));
	const contains = all.filter((s) => s.name.toLowerCase().includes(q) && !exact.includes(s) && !prefix.includes(s));
	return [...exact, ...prefix, ...contains].slice(0, limit);
}

async function nearestStation(lat, lon) {
	const all = await stations();
	let best;
	let bestDist = Infinity;
	for (const s of all) {
		const d = haversineKm(lat, lon, s.latitude, s.longitude);
		if (d < bestDist) {
			bestDist = d;
			best = s;
		}
	}
	return best;
}

function haversineKm(lat1, lon1, lat2, lon2) {
	const R = 6371;
	const dLat = ((lat2 - lat1) * Math.PI) / 180;
	const dLon = ((lon2 - lon1) * Math.PI) / 180;
	const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
	return 2 * R * Math.asin(Math.sqrt(a));
}

function localParts(when) {
	const fmt = new Intl.DateTimeFormat('en-CA', {
		timeZone: AGENCY_TIMEZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
	const parts = Object.fromEntries(fmt.formatToParts(when).map((p) => [p.type, p.value]));
	return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

function serviceDate(when) {
	return localParts(when).date;
}

function serviceTime(when) {
	const { hour, minute } = localParts(when);
	return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export async function resolvePlace(raw, label) {
	const value = (raw || '').trim();
	if (!value) throw new BadRequestError(`${label} is required`);

	const coords = value.match(LATLON);
	if (coords) {
		const lat = Number(coords[1]);
		const lon = Number(coords[2]);
		if (Math.abs(lat) > 90 || Math.abs(lon) > 180) throw new BadRequestError(`${label} coordinates are out of range`);
		const near = await nearestStation(lat, lon);
		if (!near) throw new NotFoundError(`No station found near ${label}=${value}`);
		return { stopId: near.id, name: near.name, matchedBy: 'coordinates', latitude: near.latitude, longitude: near.longitude };
	}

	if (/^[A-Za-z0-9_.:-]+$/.test(value)) {
		try {
			const doc = await feedGet(`/stops/${encodeURIComponent(value)}`, {});
			const found = Array.isArray(doc.data) ? doc.data[0] : doc.data;
			if (found?.id) {
				return {
					stopId: found.id,
					name: String(attr(found, 'name') ?? found.id),
					matchedBy: 'stop-id',
					latitude: attr(found, 'latitude'),
					longitude: attr(found, 'longitude'),
				};
			}
		} catch {
			// Not a stop id, fall through to a name search.
		}
	}

	const matches = await searchStations(value, 1);
	if (matches.length === 0) {
		throw new NotFoundError(
			`Could not resolve ${label}="${value}". Try a station name, a feed stop id, or "lat,lon". GET transit-stops searches names for free.`,
		);
	}
	const s = matches[0];
	return { stopId: s.id, name: s.name, matchedBy: 'name', latitude: s.latitude, longitude: s.longitude };
}

function matchesStop(row, wanted) {
	return row.stopId === wanted || row.parentId === wanted;
}

function minutesBetween(a, b) {
	if (!a || !b) return null;
	return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

function shiftPreservingOffset(iso, minutes) {
	const suffix = iso.match(/([+-]\d{2}:\d{2}|Z)$/)?.[1];
	const shifted = new Date(new Date(iso).getTime() + minutes * 60000);
	if (!suffix || suffix === 'Z') return shifted.toISOString();
	const sign = suffix.startsWith('-') ? -1 : 1;
	const [oh, om] = suffix.slice(1).split(':').map(Number);
	const offsetMs = sign * (oh * 60 + om) * 60000;
	return new Date(shifted.getTime() + offsetMs).toISOString().replace(/\.\d{3}Z$/, '') + suffix;
}

function readSchedules(doc) {
	const index = indexIncluded(doc);
	return doc.data.map((s) => {
		const stop = related(s, 'stop', index);
		const parent = stop ? relatedId(stop, 'parent_station') : undefined;
		const stopId = relatedId(s, 'stop') ?? '';
		return {
			tripId: relatedId(s, 'trip') ?? '',
			stopId,
			parentId: parent ?? stopId,
			sequence: Number(attr(s, 'stop_sequence') ?? 0),
			arrival: attr(s, 'arrival_time') ?? null,
			departure: attr(s, 'departure_time') ?? null,
			directionId: Number(attr(s, 'direction_id') ?? 0),
		};
	});
}

async function routesAtStop(stopId) {
	const doc = await feedGet('/routes', { 'filter[stop]': stopId });
	return doc.data.map((r) => ({
		id: r.id,
		name: String(attr(r, 'long_name') || attr(r, 'short_name') || r.id),
		type: ROUTE_TYPES[String(attr(r, 'type') ?? '')] ?? 'transit',
		sortOrder: Number(attr(r, 'sort_order') ?? 0),
	}));
}

async function directLegsOnRoute(route, from, to, departAfter, limit) {
	const doc = await feedGet('/schedules', {
		'filter[stop]': `${from.stopId},${to.stopId}`,
		'filter[route]': route.id,
		'filter[date]': serviceDate(departAfter),
		'filter[min_time]': serviceTime(departAfter),
		sort: 'departure_time',
		include: 'stop,trip',
		'page[limit]': '400',
	});
	const index = indexIncluded(doc);
	const rows = readSchedules(doc);

	const headsigns = new Map();
	for (const s of doc.data) {
		const trip = related(s, 'trip', index);
		const tripId = relatedId(s, 'trip');
		if (trip && tripId) headsigns.set(tripId, String(attr(trip, 'headsign') ?? ''));
	}

	const byTrip = new Map();
	for (const r of rows) {
		if (!r.tripId) continue;
		const list = byTrip.get(r.tripId) ?? [];
		list.push(r);
		byTrip.set(r.tripId, list);
	}

	const legs = [];
	for (const [tripId, tripRows] of byTrip) {
		const origin = tripRows.find((r) => matchesStop(r, from.stopId));
		const dest = tripRows.find((r) => matchesStop(r, to.stopId));
		if (!origin || !dest) continue;
		if (origin.sequence >= dest.sequence) continue;

		const depart = origin.departure ?? origin.arrival;
		if (!depart) continue;
		if (new Date(depart).getTime() < departAfter.getTime()) continue;

		const arrive = dest.arrival ?? dest.departure;
		legs.push({
			routeId: route.id,
			routeName: route.name,
			routeType: route.type,
			headsign: headsigns.get(tripId) ?? '',
			tripId,
			from: { stopId: origin.stopId, name: from.name, scheduledDeparture: depart, predictedDeparture: null },
			to: { stopId: dest.stopId, name: to.name, scheduledArrival: arrive, predictedArrival: null },
			durationMinutes: minutesBetween(depart, arrive),
			realtime: false,
		});
	}

	legs.sort((a, b) => new Date(a.from.scheduledDeparture ?? 0).getTime() - new Date(b.from.scheduledDeparture ?? 0).getTime());
	return legs.slice(0, limit);
}

async function applyPredictions(legs, from) {
	if (legs.length === 0) return;
	try {
		const doc = await feedGet('/predictions', { 'filter[stop]': from.stopId, 'page[limit]': '150' });
		const byTrip = new Map();
		for (const p of doc.data) {
			const tripId = relatedId(p, 'trip');
			if (tripId) byTrip.set(tripId, p);
		}
		for (const leg of legs) {
			const p = byTrip.get(leg.tripId);
			if (!p) continue;
			const predicted = attr(p, 'departure_time') ?? attr(p, 'arrival_time') ?? null;
			if (!predicted) continue;
			leg.from.predictedDeparture = predicted;
			leg.realtime = true;
			const drift = minutesBetween(leg.from.scheduledDeparture, predicted);
			if (drift !== null && leg.to.scheduledArrival) {
				leg.to.predictedArrival = shiftPreservingOffset(leg.to.scheduledArrival, drift);
			}
		}
	} catch {
		// Realtime is an enhancement; scheduled itineraries still stand without it.
	}
}

function toItinerary(legs) {
	const first = legs[0];
	const last = legs[legs.length - 1];
	const departure = first.from.predictedDeparture ?? first.from.scheduledDeparture;
	const arrival = last.to.predictedArrival ?? last.to.scheduledArrival;
	return {
		kind: legs.length === 1 ? 'direct' : 'one-transfer',
		departure,
		arrival,
		durationMinutes: minutesBetween(departure, arrival),
		transfers: legs.length - 1,
		legs,
	};
}

async function findTransfer(fromRoutes, toRoutes) {
	const a = [...fromRoutes].sort((x, y) => x.sortOrder - y.sortOrder).slice(0, 2);
	const b = [...toRoutes].sort((x, y) => x.sortOrder - y.sortOrder).slice(0, 2);
	if (a.length === 0 || b.length === 0) return null;

	const stopSets = new Map();
	const loadStops = async (routeId) => {
		const cached = stopSets.get(routeId);
		if (cached) return cached;
		const doc = await feedGet('/stops', { 'filter[route]': routeId, 'page[limit]': '300' });
		const map = new Map();
		for (const s of doc.data) {
			const parent = relatedId(s, 'parent_station') ?? s.id;
			map.set(parent, String(attr(s, 'name') ?? parent));
		}
		stopSets.set(routeId, map);
		return map;
	};

	for (const routeA of a) {
		const stopsA = await loadStops(routeA.id);
		for (const routeB of b) {
			if (routeA.id === routeB.id) continue;
			const stopsB = await loadStops(routeB.id);
			for (const [stopId, name] of stopsA) {
				if (stopsB.has(stopId)) return { routeA, routeB, point: { stopId, name, matchedBy: 'stop-id' } };
			}
		}
	}
	return null;
}

export async function planTrip(from, to, departAfter, max) {
	if (from.stopId === to.stopId) throw new BadRequestError('from and to resolve to the same stop');

	const [fromRoutes, toRoutes] = await Promise.all([routesAtStop(from.stopId), routesAtStop(to.stopId)]);
	const toIds = new Set(toRoutes.map((r) => r.id));
	const shared = fromRoutes.filter((r) => toIds.has(r.id)).sort((a, b) => a.sortOrder - b.sortOrder);

	const itineraries = [];
	let note;

	if (shared.length > 0) {
		const legSets = await Promise.all(shared.slice(0, 3).map((r) => directLegsOnRoute(r, from, to, departAfter, max)));
		const legs = legSets.flat();
		await applyPredictions(legs, from);
		for (const leg of legs) itineraries.push(toItinerary([leg]));
		note = `${shared.length} route(s) serve both stops directly. Times are scheduled; predictedDeparture/predictedArrival are filled in where the realtime feed has an update for that trip.`;
	} else {
		const transfer = await findTransfer(fromRoutes, toRoutes);
		if (!transfer) {
			note = 'No direct route and no single-transfer interchange found between these stops in this feed. They may need two or more transfers, or lie on unconnected networks.';
		} else {
			const [firstLegs, secondLegsAll] = await Promise.all([
				directLegsOnRoute(transfer.routeA, from, transfer.point, departAfter, max),
				directLegsOnRoute(transfer.routeB, transfer.point, to, departAfter, max * 3),
			]);
			await applyPredictions(firstLegs, from);

			for (const first of firstLegs) {
				const arrive = first.to.predictedArrival ?? first.to.scheduledArrival;
				if (!arrive) continue;
				const readyAt = new Date(new Date(arrive).getTime() + 2 * 60000).getTime();
				const second = secondLegsAll.find((l) => l.from.scheduledDeparture !== null && new Date(l.from.scheduledDeparture).getTime() >= readyAt);
				if (!second) continue;
				itineraries.push(toItinerary([first, second]));
				if (itineraries.length >= max) break;
			}
			note = `No direct route; itineraries transfer at ${transfer.point.name}. A minimum 2-minute connection is enforced.`;
		}
	}

	itineraries.sort((a, b) => new Date(a.departure ?? 0).getTime() - new Date(b.departure ?? 0).getTime());

	return {
		source: 'gtfs-live',
		agency: AGENCY_NAME,
		feed: API_BASE,
		query: { from, to, departAfter: departAfter.toISOString(), max },
		itineraries: itineraries.slice(0, max),
		note,
		retrievedAt: new Date().toISOString(),
	};
}

export async function delaySnapshot(stop, routeId, limit) {
	const params = {
		'filter[stop]': stop.stopId,
		include: 'schedule,route,trip',
		sort: 'arrival_time',
		'page[limit]': String(Math.min(Math.max(limit, 1), 100)),
	};
	if (routeId) params['filter[route]'] = routeId;

	const doc = await feedGet('/predictions', params);
	const index = indexIncluded(doc);

	const arrivals = [];
	for (const p of doc.data) {
		const schedule = related(p, 'schedule', index);
		const route = related(p, 'route', index);
		const trip = related(p, 'trip', index);

		const predicted = attr(p, 'arrival_time') ?? attr(p, 'departure_time') ?? null;
		const scheduled = schedule ? attr(schedule, 'arrival_time') ?? attr(schedule, 'departure_time') ?? null : null;

		let delaySeconds = null;
		if (predicted && scheduled) delaySeconds = Math.round((new Date(predicted).getTime() - new Date(scheduled).getTime()) / 1000);

		arrivals.push({
			routeId: relatedId(p, 'route') ?? '',
			routeName: String(attr(route, 'long_name') || attr(route, 'short_name') || relatedId(p, 'route') || ''),
			tripId: relatedId(p, 'trip') ?? '',
			headsign: String(attr(p, 'trip_headsign') ?? attr(trip, 'headsign') ?? ''),
			directionId: Number(attr(p, 'direction_id') ?? 0),
			stopId: relatedId(p, 'stop') ?? stop.stopId,
			scheduled,
			predicted,
			delaySeconds,
			delayMinutes: delaySeconds === null ? null : Math.round(delaySeconds / 60),
			status: delaySeconds === null ? 'unknown' : delaySeconds < -ON_TIME_SECONDS ? 'early' : delaySeconds > ON_TIME_SECONDS ? 'late' : 'on-time',
			uncertaintySeconds: attr(p, 'arrival_uncertainty') ?? attr(p, 'departure_uncertainty') ?? null,
		});
	}

	const measured = arrivals.filter((a) => a.delaySeconds !== null).map((a) => a.delaySeconds);
	const sorted = [...measured].sort((a, b) => a - b);
	const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
	const worst = sorted.length ? sorted[sorted.length - 1] : null;
	const late = arrivals.filter((a) => a.status === 'late').length;
	const early = arrivals.filter((a) => a.status === 'early').length;
	const onTime = arrivals.filter((a) => a.status === 'on-time').length;

	const verdict = measured.length === 0 ? 'no-data' : (median ?? 0) > 300 ? 'significant-delays' : (median ?? 0) > ON_TIME_SECONDS ? 'minor-delays' : 'running-well';

	return {
		source: 'gtfs-rt-live',
		agency: AGENCY_NAME,
		feed: API_BASE,
		query: { stop, routeId },
		summary: { predictions: arrivals.length, withSchedule: measured.length, onTime, late, early, medianDelaySeconds: median, worstDelaySeconds: worst, verdict },
		arrivals,
		note: 'delaySeconds is the realtime prediction minus the scheduled time for the same trip at this stop, measured from the feed, not modelled. Predictions without a matching scheduled trip (added or unscheduled service) have delaySeconds: null and status: "unknown".',
		retrievedAt: new Date().toISOString(),
	};
}

export function parseWhen(raw) {
	if (!raw) return new Date();
	const t = Date.parse(raw);
	if (Number.isNaN(t)) throw new BadRequestError('departAfter must be an ISO 8601 timestamp, e.g. 2026-08-07T14:30:00Z');
	return new Date(t);
}

export { BadRequestError, NotFoundError, UpstreamError, AGENCY_NAME, API_BASE };
