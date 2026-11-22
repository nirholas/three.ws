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

// The binary trailer Insta360 appends to .insv and .insp files. Same layout and
// field as the stitcher reads (workers/model-pano2splat/pano_stitch/trailer.py):
// the last 72 bytes hold 32 reserved bytes, the trailer size (u32 LE), a version
// and a 32 byte ASCII magic; before them a run of records, each closed by a 6 byte
// footer (format u8, id u8, length u32 LE), or on X4 and later an index record
// (id 0) of 10 byte entries. Record 1 is a protobuf whose field 2 names the camera.
const TRAILER_MAGIC = '8db42d694ccc418790edff439fe026bf';
export const TRAILER_TAIL = 72;
export const MAX_TRAILER_BYTES = 64 * 1024 * 1024;
const FOOTER = 6;
const INDEX_ENTRY = 10;
// pano_stitch/layout.py SUPPORTED_MODEL: the dual lens cameras it can stitch.
const STITCHABLE_MODEL = /\b(one\s?x2?|one\s?rs?|x[2-9])\b/i;

function u32le(b, at) {
	return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

/** Bytes the trailer takes at the end of the file (payload plus tail), or 0 when there is none. */
export function trailerLength(tail, fileSize) {
	if (!tail || tail.length < TRAILER_TAIL) return 0;
	const t = tail.subarray(tail.length - TRAILER_TAIL);
	for (let i = 0; i < 32; i++) if (t[40 + i] !== TRAILER_MAGIC.charCodeAt(i)) return 0;
	const size = u32le(t, 32);
	return size >= TRAILER_TAIL && size <= fileSize && size <= MAX_TRAILER_BYTES ? size : 0;
}

function readVarint(buf, pos) {
	let value = 0;
	let scale = 1;
	for (let i = 0; i < 10; i++) {
		if (pos >= buf.length) return null;
		const b = buf[pos++];
		value += (b & 0x7f) * scale;
		if (!(b & 0x80)) return [value, pos];
		scale *= 128;
	}
	return null;
}

function protoText(buf, wanted) {
	let pos = 0;
	while (pos < buf.length) {
		const key = readVarint(buf, pos);
		if (!key) return '';
		pos = key[1];
		const field = Math.floor(key[0] / 8);
		const wire = key[0] % 8;
		if (wire === 0) {
			const v = readVarint(buf, pos);
			if (!v) return '';
			pos = v[1];
		} else if (wire === 1) pos += 8;
		else if (wire === 5) pos += 4;
		else if (wire === 2) {
			const len = readVarint(buf, pos);
			if (!len || len[1] + len[0] > buf.length) return '';
			if (field === wanted) return new TextDecoder().decode(buf.subarray(len[1], len[1] + len[0])).replace(/\0+$/, '').trim();
			pos = len[1] + len[0];
		} else return '';
	}
	return '';
}

function metadataRecord(payload) {
	const n = payload.length;
	if (n < FOOTER) return null;
	const at = n - FOOTER;
	const length = u32le(payload, at + 2);
	if (payload[at + 1] === 0 && payload[at] === 0 && length % INDEX_ENTRY === 0 && length <= at) {
		for (let i = at - length; i < at; i += INDEX_ENTRY) {
			const len = u32le(payload, i + 2);
			const off = u32le(payload, i + 6);
			if (payload[i] === 1 && len > 0 && off + len <= n) return payload.subarray(off, off + len);
		}
		return null;
	}
	let pos = n;
	while (pos >= FOOTER) {
		const len = u32le(payload, pos - 4);
		const start = pos - FOOTER - len;
		if (start < 0) return null;
		if (payload[pos - 5] === 1) return payload.subarray(start, pos - FOOTER);
		pos = start;
	}
	return null;
}

/** The camera model named in a trailer (the last trailerLength() bytes of the file), or ''. */
export function cameraModelFromTrailer(trailer) {
	if (!trailer || trailer.length < TRAILER_TAIL + FOOTER) return '';
	const meta = metadataRecord(trailer.subarray(0, trailer.length - TRAILER_TAIL));
	return meta ? protoText(meta, 2) : '';
}

/** Whether the raw stitcher accepts files from this camera. */
export function isStitchableCamera(model) {
	return STITCHABLE_MODEL.test(String(model || ''));
}

function unstitchableRaw(cameraModel, kind) {
	const photo = kind === 'insp';
	return {
		verdict: 'raw',
		title: `Raw 360 ${photo ? 'photo' : 'video'} from an ${cameraModel}`,
		summary: `Raw files from the ${cameraModel} cannot be stitched on three.ws. Export a stitched 360 ${photo ? 'JPEG' : 'MP4'} from the Insta360 app or Insta360 Studio, then use that file.`,
		notes: ['Only the dual lens Insta360 ONE X, ONE X2, ONE R, ONE RS and X2 to X6 are stitched from raw files here.'],
		lanes: photo ? lanes('panoScene', 'environment') : lanes('splat', 'motion'),
	};
}

function lanes(...ids) {
	return ids.map((id) => ({ id, ...LANES[id] }));
}

/**
 * @param {{ name: string, mime?: string, width?: number, height?: number, durationS?: number, readError?: boolean, cameraModel?: string }} file
 * @returns {{ verdict: 'raw'|'equirect'|'flat'|'unknown', title: string, summary: string, notes: string[], lanes: Array<{id:string,title:string,path:string,action:string}> }}
 */
export function assessFile(file) {
	const { name, mime = '', width = 0, height = 0, durationS = 0, readError = false, cameraModel = '' } = file;
	const kind = kindOf(name, mime);
	if ((kind === 'insv' || kind === 'insp') && cameraModel && !isStitchableCamera(cameraModel)) return unstitchableRaw(cameraModel, kind);
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
