// Which way into the club. The pole stage, the cover charge and the dancers are
// the same room whichever door you use; a variant only changes the walk-in that
// src/club-entrance.js plays before the stage opens. The variant is picked from
// the URL path, so every entrance is a plain shareable link:
//
//   /club        the neon alley (the original walk-in)
//   /stripclub   a brick back alley, a third-party CC BY model (credited on screen)
//
// Pure data + helpers, no three.js or DOM, so the routing rule is unit-tested
// without booting a renderer (tests/club-variant.test.js).
//
// A venue entry:
//   url       runtime GLB under public/club/venue/ (Meshopt + WebP, built by
//             scripts/build-club-entrance-venue.mjs)
//   name      minimap label for the room
//   cover     true on the venue whose door takes the cover charge
//   door      true when the exit anchors to a modelled door mesh; false walks
//             the room's longest dimension instead
//   height    metres the model's bounding height is normalised to. Defaults to
//             a single-storey room; an exterior with full building fronts needs
//             its real height or the avatar reads as a giant.
//   fallback  venue mounted instead when this one cannot be loaded, so a missing
//             or failed asset never strands the visitor outside the door
//   credit    attribution a licence requires us to show while the venue is on screen

const NEON_ALLEY = { name: 'Alley', url: '/club/venue/alleyway.glb', cover: true, door: true };
const GALLERY = { name: 'Gallery', url: '/club/venue/tour.glb', cover: false, door: false };
const CLUBHOUSE = { name: 'Clubhouse', url: '/club/venue/space-smugglers-clubhouse.glb', cover: false, door: false };

const BACK_ALLEY = {
	name: 'Back alley',
	url: '/club/venue/back-alley.glb',
	cover: true,
	door: true,
	// Four-storey brick frontage with fire escapes, not a single room.
	height: 13,
	fallback: NEON_ALLEY,
	credit: {
		title: 'environment ally with bar/strip club',
		author: 'anthonydpc',
		authorUrl: 'https://sketchfab.com/tonydpc',
		sourceUrl: 'https://sketchfab.com/3d-models/environment-ally-with-barstrip-club-a98c2e9748b24b7fb781d452814304ef',
		license: 'CC BY 4.0',
		licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
	},
};

export const DEFAULT_CLUB_VARIANT = 'club';

export const CLUB_VARIANTS = {
	club: {
		key: 'club',
		path: '/club',
		label: 'Neon alley',
		sequence: [NEON_ALLEY, GALLERY, CLUBHOUSE],
	},
	stripclub: {
		key: 'stripclub',
		path: '/stripclub',
		label: 'Back alley',
		sequence: [BACK_ALLEY, GALLERY, CLUBHOUSE],
	},
};

/**
 * Resolve the walk-in variant for a URL path. Trailing slashes and case are
 * ignored; anything that is not a known entrance gets the default, so an
 * embed or an odd rewrite still lands in a working club.
 *
 * @param {string} [pathname]
 * @returns {typeof CLUB_VARIANTS[keyof typeof CLUB_VARIANTS]}
 */
export function resolveClubVariant(pathname = '') {
	const clean = String(pathname).toLowerCase().replace(/\/+$/, '');
	for (const variant of Object.values(CLUB_VARIANTS)) {
		if (clean === variant.path) return variant;
	}
	return CLUB_VARIANTS[DEFAULT_CLUB_VARIANT];
}

/** Every entrance, in display order, for the HUD's entrance switcher. */
export function listClubEntrances() {
	return Object.values(CLUB_VARIANTS).map(({ key, path, label }) => ({ key, path, label }));
}
