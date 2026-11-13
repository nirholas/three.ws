/**
 * Countdown text for $THREE holder windows (drops.early on /drops/:slug,
 * names.first_dibs on /threews/claim). Pure so the edges are unit-testable.
 *
 * Under an hour reads m:ss, under a day h:mm:ss, beyond that "Nd Nh" (a drop
 * window can run up to seven days, and a seconds digit there is noise).
 */
export function formatRemaining(ms) {
	const total = Math.max(0, Math.floor(Number(ms) / 1000) || 0);
	const days = Math.floor(total / 86400);
	const hours = Math.floor((total % 86400) / 3600);
	const mins = Math.floor((total % 3600) / 60);
	const secs = total % 60;
	const pad = (n) => String(n).padStart(2, '0');
	if (days > 0) return `${days}d ${hours}h`;
	if (hours > 0) return `${hours}:${pad(mins)}:${pad(secs)}`;
	return `${mins}:${pad(secs)}`;
}
