// Which way into the club. The pole stage, the cover charge and the dancers are
// the same room whichever door you use; a variant only changes the walk-in that
// src/club-entrance.js plays before the stage opens. The variant is picked from
// the URL path, so every entrance is a plain shareable link:
//
//   /club        the neon alley (the original walk-in)
//
// Any other path (for example the retired /stripclub link) resolves to the
// default entrance, so old shared links still land in a working club.
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

const NEON_ALLEY = {
	name: 'Alley',
	url: '/club/venue/alleyway.glb',
	cover: true,
	door: true,
	credit: {
		title: 'Armentrout Textured Game Environment - Alleyway',
		author: 'dcarmentrout',
		authorUrl: 'https://sketchfab.com/dcarmentrout',
		sourceUrl: 'https://sketchfab.com/3d-models/armentrout-textured-game-environment-alleyway-ad32afd3994643a1b68eb2f44d77c60c',
		license: 'CC BY 4.0',
		licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
	},
};
const GALLERY = {
	name: 'Gallery',
	url: '/club/venue/tour.glb',
	cover: false,
	door: false,
	credit: {
		title: "Richard's Art Gallery - Audio Tour",
		author: 'shinymagic',
		authorUrl: 'https://sketchfab.com/shinymagic',
		sourceUrl: 'https://sketchfab.com/3d-models/richards-art-gallery-audio-tour-0e3e19faa6474fd5974e6a7ed1b221d8',
		license: 'CC BY 4.0',
		licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
	},
};
// The procedural club room (scripts/build-club-venue.mjs, CC0), mounted as the
// last step of the walk-in so the journey ends in a venue three.ws owns outright.
const CLUB_FLOOR = { name: 'Club floor', url: '/club/venue/club-venue.glb', cover: false, door: false };

export const DEFAULT_CLUB_VARIANT = 'club';

export const CLUB_VARIANTS = {
	club: {
		key: 'club',
		path: '/club',
		label: 'Neon alley',
		sequence: [NEON_ALLEY, GALLERY, CLUB_FLOOR],
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
