// insta360-file-check.js: decide which three.ws 360 lane fits a file a
// visitor picks on /insta360. Pure functions only: the page wiring in
// src/insta360-landing.js reads the file's name, pixel size and duration in
// the browser (nothing is uploaded) and hands them here.
//
// Raw camera files are recognised by extension (.insv, .insp, .lrv, .dng).
// Stitched exports are recognised by shape: an equirectangular frame is 2:1.

/**
 * Every surface this checker can point at, keyed by lane id. `status` is
 * 'rolling-out' while the 360 mode of that surface is still being built and
 * null for surfaces that already take this input. The badges on
 * pages/insta360.html must match (tests/insta360-landing.test.js pins it);
 * flip both when a lane ships.
 */
export const LANES = {
	splat: {
		title: 'Walk around, get a splat',
		path: '/capture',
		action: 'Open Scene Capture',
		status: 'rolling-out',
	},
	panoScene: {
		title: 'Step inside one photo',
		path: '/pano-scene',
		action: 'Open Pano Scene',
		status: 'rolling-out',
	},
	environment: {
		title: "Your 360 photo as your avatar's world",
		path: '/app',
		action: 'Open the viewer',
		status: 'rolling-out',
	},
	motion: {
		title: '360 motion capture',
		path: '/video-to-motion',
		action: 'Open Video to Motion',
		status: 'rolling-out',
	},
	flatCapture: {
		title: 'Video to 3D point cloud',
		path: '/capture',
		action: 'Open Scene Capture',
		status: null,
	},
	flatMotion: {
		title: 'Video to animation',
		path: '/video-to-motion',
		action: 'Open Video to Motion',
		status: null,
	},
	imageTo3d: {
		title: 'Photo to 3D model',
		path: '/image-to-3d',
		action: 'Open Image to 3D',
		status: null,
	},
};

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm', 'mkv']);
const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff']);

/** Width under which a stitched 360 export is softer than current cameras shoot (5.7K). */
export const SHARP_EQUIRECT_WIDTH = 5760;
/** Recommended walkaround length, in seconds. */
export const MIN_WALK_S = 30;
export const MAX_WALK_S = 180;
/** How far from exactly 2:1 a frame may be and still count as equirectangular. */
const EQUIRECT_TOLERANCE = 0.02;

export function extensionOf(name) {
	const m = /\.([a-z0-9]+)$/i.exec(String(name || '').trim());
	return m ? m[1].toLowerCase() : '';
}

/**
 * First pass, by name and MIME type alone. Tells the page whether it needs to
 * read pixel size (image) or size plus duration (video) before assessing.
 * @returns {'insv'|'insp'|'lrv'|'dng'|'exr'|'video'|'image'|'unknown'}
 */
export function kindOf(name, mime = '') {
	const ext = extensionOf(name);
	if (ext === 'insv' || ext === 'insp' || ext === 'lrv' || ext === 'dng' || ext === 'exr') return ext;
	if (VIDEO_EXT.has(ext) || /^video\//.test(mime)) return 'video';
	if (IMAGE_EXT.has(ext) || /^image\//.test(mime)) return 'image';
	return 'unknown';
}

/** True when the camera wrote one file per lens (X3 and older: `_00_` / `_10_`). */
export function isSplitLensName(name) {
	return /_(00|10)_\d+\.insv$/i.test(String(name || ''));
}

export function isEquirect(width, height) {
	if (!(width > 0) || !(height > 0)) return false;
	return Math.abs(width / height - 2) <= 2 * EQUIRECT_TOLERANCE;
}

function formatDuration(s) {
	const total = Math.round(s);
	const m = Math.floor(total / 60);
	const sec = total % 60;
	return m ? `${m} min ${String(sec).padStart(2, '0')} s` : `${sec} s`;
}

function walkLengthNotes(durationS) {
	if (!(durationS > 0)) return [];
	if (durationS < MIN_WALK_S) {
		return [
			`${formatDuration(durationS)} is short for a walkaround. Aim for 30 s to 3 min so the scene is seen from enough places.`,
		];
	}
	if (durationS > MAX_WALK_S) {
		return [
			`${formatDuration(durationS)} is longer than the 3 min sweet spot. Trim to your best loop to keep the job fast.`,
		];
	}
	return [`${formatDuration(durationS)} is inside the 30 s to 3 min range that reconstructs well.`];
}

function lanes(...ids) {
	return ids.map((id) => ({ id, ...LANES[id] }));
}

/**
 * @param {{ name: string, mime?: string, width?: number, height?: number, durationS?: number, readError?: boolean }} file
 * @returns {{ verdict: 'raw'|'equirect'|'flat'|'unknown', title: string, summary: string, notes: string[], lanes: Array<{id:string,title:string,path:string,action:string}> }}
 */
export function assessFile(file) {
	const { name, mime = '', width = 0, height = 0, durationS = 0, readError = false } = file;
	const kind = kindOf(name, mime);
	const sized = width > 0 && height > 0;
	const sizeLabel = sized ? `${width} x ${height}` : '';

	if (kind === 'insv') {
		const notes = [
			'This is a raw, unstitched 360 video straight off the camera. Upload it as it is: no stitching needed first.',
		];
		if (isSplitLensName(name)) {
			notes.push(
				'The _00_ / _10_ in the name means your camera wrote one file per lens. Add both files of the pair together.',
			);
		}
		notes.push('A plain video player shows only one lens of this file. That is expected.');
		return {
			verdict: 'raw',
			title: 'Raw 360 video (.insv)',
			summary: 'Walk-through footage becomes a Gaussian splat scene; footage of a person becomes an animation.',
			notes,
			lanes: lanes('splat', 'motion'),
		};
	}

	if (kind === 'lrv') {
		return {
			verdict: 'raw',
			title: 'Low-resolution proxy (.lrv)',
			summary:
				'Your camera writes this small preview next to every .insv. It is too low in resolution to reconstruct well.',
			notes: ['Find the .insv with the same name beside it and use that file instead.'],
			lanes: lanes('splat', 'motion'),
		};
	}

	if (kind === 'insp') {
		return {
			verdict: 'raw',
			title: 'Raw 360 photo (.insp)',
			summary: 'One 360 photo becomes a depth scene you can stand inside, or the world around your avatar.',
			notes: ['Upload it as it is: both lenses are stitched on three.ws.'],
			lanes: lanes('panoScene', 'environment'),
		};
	}

	if (kind === 'dng') {
		return {
			verdict: 'raw',
			title: 'RAW photo (.dng)',
			summary: 'DNG is a raw sensor file. Export it as a stitched 360 JPEG from your camera app or desktop editor first.',
			notes: ['Or use the .insp the camera saved for the same shot.'],
			lanes: lanes('panoScene', 'environment'),
		};
	}

	if (kind === 'exr') {
		return {
			verdict: 'equirect',
			title: 'HDR panorama (.exr)',
			summary: 'An HDR equirectangular image lights your avatar with real light from the place you shot.',
			notes: ['Browsers cannot preview EXR, so the 2:1 shape was not checked here. Make sure it was exported as equirectangular.'],
			lanes: lanes('environment', 'panoScene'),
		};
	}

	if (kind === 'video') {
		if (readError || !sized) {
			return {
				verdict: 'unknown',
				title: 'Video, size unreadable here',
				summary:
					'Your browser could not read this video, which often means it is H.265 (HEVC). That does not stop an upload; it only stops this check.',
				notes: [
					'If it is a stitched 360 export, it is 2:1 (for example 5760 x 2880 or 7680 x 3840): use the 360 lanes.',
					'If it is a regular video, use the point cloud and motion lanes.',
				],
				lanes: lanes('splat', 'motion'),
			};
		}
		if (isEquirect(width, height)) {
			const notes = [`${sizeLabel} is 2:1, the shape of a stitched 360 video.`];
			if (width < SHARP_EQUIRECT_WIDTH) {
				notes.push(
					`Under ${SHARP_EQUIRECT_WIDTH} px wide the scene comes out softer. Export at the highest resolution your camera recorded.`,
				);
			}
			notes.push(...walkLengthNotes(durationS));
			return {
				verdict: 'equirect',
				title: 'Stitched 360 video',
				summary: 'Walk-through footage becomes a Gaussian splat scene; footage of a person becomes an animation.',
				notes,
				lanes: lanes('splat', 'motion'),
			};
		}
		return {
			verdict: 'flat',
			title: 'Regular video (not 360)',
			summary: `${sizeLabel} is not 2:1, so this is a normal flat video, like action-cam or phone footage.`,
			notes: ['Flat video already works: reconstruct the space as a point cloud, or turn a person in it into an animation.'],
			lanes: lanes('flatCapture', 'flatMotion'),
		};
	}

	if (kind === 'image') {
		if (readError || !sized) {
			return {
				verdict: 'unknown',
				title: 'Image, size unreadable here',
				summary: 'Your browser could not decode this image, so its shape was not checked.',
				notes: ['A stitched 360 photo is 2:1 (for example 6080 x 3040 or 11904 x 5952).'],
				lanes: lanes('panoScene', 'environment'),
			};
		}
		if (isEquirect(width, height)) {
			return {
				verdict: 'equirect',
				title: 'Stitched 360 photo',
				summary: `${sizeLabel} is 2:1, the shape of an equirectangular 360 photo.`,
				notes:
					width < SHARP_EQUIRECT_WIDTH
						? [`Under ${SHARP_EQUIRECT_WIDTH} px wide it will look soft up close. Export at full resolution if you can.`]
						: ['Full resolution: good for both depth and lighting.'],
				lanes: lanes('panoScene', 'environment'),
			};
		}
		return {
			verdict: 'flat',
			title: 'Regular photo (not 360)',
			summary: `${sizeLabel} is not 2:1, so this is a flat photo.`,
			notes: ['A photo of one object becomes a textured 3D model.'],
			lanes: lanes('imageTo3d'),
		};
	}

	return {
		verdict: 'unknown',
		title: 'Not a format these lanes read',
		summary: 'Pick a raw .insv or .insp, a stitched 360 MP4 or JPEG, or an EXR panorama.',
		notes: [],
		lanes: [],
	};
}
