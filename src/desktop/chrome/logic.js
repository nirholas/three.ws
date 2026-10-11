// Pure rules behind the desktop chrome (taskbar status, notification centre,
// Run dialog, power menu). No DOM here, so every rule is unit tested.

/** Taskbar clock text. Seconds tick like a real system clock when asked. */
export function formatClock(d, { clock24 = false, seconds = false } = {}) {
	const time = d.toLocaleTimeString([], {
		hour: clock24 ? '2-digit' : 'numeric',
		minute: '2-digit',
		...(seconds ? { second: '2-digit' } : {}),
		hour12: !clock24,
	});
	const date = d.toLocaleDateString([], { year: 'numeric', month: 'numeric', day: 'numeric' });
	return { time, date };
}

/** Battery API snapshot to what the tray and quick settings show. Null when the browser has no battery. */
export function batteryInfo(b) {
	if (!b || !Number.isFinite(b.level)) return null;
	const pct = Math.round(Math.min(1, Math.max(0, b.level)) * 100);
	const secs = b.charging ? b.chargingTime : b.dischargingTime;
	let eta = '';
	if (Number.isFinite(secs) && secs > 0) {
		const h = Math.floor(secs / 3600);
		const m = Math.round((secs % 3600) / 60);
		eta = h ? `${h} h ${m} min` : `${m} min`;
	}
	let label;
	if (b.charging && pct >= 100) label = 'Fully charged';
	else if (b.charging) label = eta ? `Charging, full in ${eta}` : 'Charging';
	else label = eta ? `${eta} remaining` : 'On battery';
	const tier = pct <= 10 ? 'critical' : pct <= 25 ? 'low' : 'ok';
	return { pct, charging: !!b.charging, label, tier };
}

/** navigator.onLine + navigator.connection to a status line. */
export function networkInfo({ online = true, type = '', effectiveType = '', downlink, rtt } = {}) {
	if (!online) return { online: false, label: 'Offline', detail: 'No internet connection' };
	const kind = { wifi: 'Wi-Fi', ethernet: 'Ethernet', cellular: 'Cellular', bluetooth: 'Bluetooth', wimax: 'WiMAX' }[type] || 'Connected';
	const parts = [];
	if (effectiveType) parts.push(effectiveType.toUpperCase());
	if (Number.isFinite(downlink) && downlink > 0) parts.push(`${downlink >= 10 ? Math.round(downlink) : downlink.toFixed(1)} Mbps`);
	if (Number.isFinite(rtt) && rtt > 0) parts.push(`${Math.round(rtt)} ms`);
	return { online: true, label: kind, detail: parts.length ? parts.join(' / ') : 'Internet access' };
}

const MAX_NOTES = 50;

/** Prepend a notification, newest first, capped. Returns a new list. */
export function addNotification(list, n, now = Date.now(), max = MAX_NOTES) {
	const title = String(n?.title || '').trim().slice(0, 120);
	const body = String(n?.body || '').trim().slice(0, 400);
	if (!title && !body) return list;
	const note = { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: title || body, body: title ? body : '', app: typeof n?.app === 'string' ? n.app : '', at: now };
	return [note, ...(Array.isArray(list) ? list : [])].slice(0, max);
}

/** Parse stored notifications defensively. */
export function sanitizeNotifications(raw) {
	let data = raw;
	if (typeof raw === 'string') {
		try {
			data = JSON.parse(raw);
		} catch {
			return [];
		}
	}
	if (!Array.isArray(data)) return [];
	return data
		.filter((n) => n && typeof n.id === 'string' && typeof n.title === 'string' && Number.isFinite(n.at))
		.map((n) => ({ id: n.id, title: n.title.slice(0, 120), body: typeof n.body === 'string' ? n.body.slice(0, 400) : '', app: typeof n.app === 'string' ? n.app : '', at: n.at }))
		.slice(0, MAX_NOTES);
}

/** "Just now", "5 min ago", "3 h ago", then a short date. */
export function relTime(at, now = Date.now()) {
	const s = Math.max(0, Math.round((now - at) / 1000));
	if (s < 45) return 'Just now';
	const m = Math.round(s / 60);
	if (m < 60) return `${m} min ago`;
	const h = Math.round(m / 60);
	if (h < 24) return `${h} h ago`;
	return new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * What the Run dialog should do with its input.
 * 'url' opens an outside site in a new tab, 'path' a three.ws page,
 * 'file' a path in the virtual file system, 'query' searches apps by name.
 */
export function parseRun(input) {
	const v = String(input || '').trim();
	if (!v) return { kind: 'empty' };
	if (/^https?:\/\//i.test(v)) return { kind: 'url', value: v };
	if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(v) && !v.startsWith('/')) return { kind: 'url', value: `https://${v}` };
	if (/^~(\/|$)/.test(v)) return { kind: 'file', value: v.replace(/^~/, '') || '/' };
	if (/^\/(Desktop|Documents|Pictures|Downloads|Music|Videos|Trash)(\/|$)/.test(v)) return { kind: 'file', value: v };
	if (v.startsWith('/')) return { kind: 'path', value: v };
	return { kind: 'query', value: v.toLowerCase() };
}

/** Classic command aliases people type into Run. */
export const RUN_ALIASES = {
	cmd: 'terminal',
	powershell: 'terminal',
	bash: 'terminal',
	sh: 'terminal',
	terminal: 'terminal',
	notepad: 'notepad',
	calc: 'calculator',
	explorer: 'files',
	files: 'files',
	taskmgr: 'taskmgr',
	mspaint: 'paint',
	paint: 'paint',
	control: 'settings',
	settings: 'settings',
	'ms-settings:': 'settings',
	clock: 'clock',
	weather: 'weather',
	camera: 'camera',
	photos: 'photos',
	wmplayer: 'media',
	winver: 'about',
};
