'use strict';

function formatBytes(n) {
	if (!Number.isFinite(n) || n < 0) return '';
	const units = ['B', 'KB', 'MB', 'GB'];
	let v = n;
	let i = 0;
	while (v >= 1024 && i < units.length - 1) {
		v /= 1024;
		i++;
	}
	return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

function formatDuration(seconds) {
	if (!Number.isFinite(seconds) || seconds < 0) return '';
	const s = Math.round(seconds);
	const m = Math.floor(s / 60);
	return m ? `${m}m ${String(s % 60).padStart(2, '0')}s` : `${s}s`;
}

function formatWhen(iso, now = Date.now()) {
	const t = Date.parse(iso);
	if (!Number.isFinite(t)) return '';
	const mins = Math.round((now - t) / 60000);
	if (mins < 1) return 'just now';
	if (mins < 60) return `${mins} min ago`;
	const hours = Math.round(mins / 60);
	if (hours < 48) return `${hours} h ago`;
	return `${Math.round(hours / 24)} days ago`;
}

module.exports = { formatBytes, formatDuration, formatWhen };
