// Glyphs for dock, desktop and window chrome. 24px grid, stroke-based, no fills,
// so they inherit currentColor and stay crisp at every size.

const P = {
	logo: '<path d="M12 3 3.5 8v8L12 21l8.5-5V8z"/><path d="M12 3v18M3.5 8 12 13l8.5-5"/>',
	sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
	cube: '<path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M12 12 4 7.5M12 12l8-4.5M12 12v9"/>',
	compass: '<circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5z"/>',
	chat: '<path d="M4 5h16v11H9l-5 4z"/>',
	store: '<path d="M4 9 5.5 4h13L20 9M4 9v11h16V9M4 9c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3s3-1.3 3-3c0 1.7 1.3 3 3 3"/>',
	brain: '<path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 2.8A3 3 0 0 0 6 14v1a3 3 0 0 0 3 3h1V4zM15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 2.8 3 3 0 0 1-2 3.2v1a3 3 0 0 1-3 3h-1V4z"/>',
	folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
	image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/>',
	pulse: '<path d="M3 12h4l2.5-7 5 14L17 12h4"/>',
	radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.5"/><path d="M12 12 18 6"/>',
	terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/>',
	play: '<circle cx="12" cy="12" r="9"/><path d="m10 8.5 6 3.5-6 3.5z"/>',
	gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.5M12 18.5V21M3 12h2.5M18.5 12H21M5.6 5.6l1.8 1.8M16.6 16.6l1.8 1.8M18.4 5.6l-1.8 1.8M7.4 16.6l-1.8 1.8"/>',
	grid: '<rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><rect x="14" y="14" width="6" height="6" rx="1.2"/>',
	search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
	sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
	moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/>',
	external: '<path d="M14 4h6v6M20 4 10 14M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
	reload: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
	classic: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18"/>',
	desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
	user: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6"/>',
	minimize: '<path d="M5 12h14"/>',
	maximize: '<rect x="5" y="5" width="14" height="14" rx="1.5"/>',
	restore: '<rect x="4.5" y="8.5" width="11" height="11" rx="1.5"/><path d="M8.5 8.5V5.5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3"/>',
	widgets: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><path d="M17 13.5v7M13.5 17h7"/>',
	power: '<path d="M12 3v8M6.3 6.8a8 8 0 1 0 11.4 0"/>',
	chevron: '<path d="m9 6 6 6-6 6"/>',
	close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

export function icon(name, size = 20) {
	const body = P[name] || P.logo;
	return (
		`<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" ` +
		`stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" ` +
		`aria-hidden="true" focusable="false">${body}</svg>`
	);
}
