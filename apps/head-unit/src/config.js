// Every knob the head unit reads, from the environment, validated once at boot.
// The systemd unit in deploy/ sets these; unset means the documented default.

const DEFAULT_DRIVE_URL = 'https://three.ws/drive?surface=headunit';

function int(env, name, fallback, min, max) {
	const raw = env[name];
	if (raw == null || raw === '') return fallback;
	const n = Number(raw);
	if (!Number.isInteger(n) || n < min || n > max) {
		throw new Error(`${name} must be an integer from ${min} to ${max}, got "${raw}"`);
	}
	return n;
}

function driveUrl(raw) {
	const value = raw || DEFAULT_DRIVE_URL;
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`DRIVE_URL is not a URL: "${value}"`);
	}
	if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
		throw new Error(`DRIVE_URL must be https (or a loopback dev server), got "${value}"`);
	}
	// The agent half must render in the head unit preset; add it if missing.
	if (!url.searchParams.has('surface')) url.searchParams.set('surface', 'headunit');
	return url.toString();
}

/** @param {Record<string, string|undefined>} env */
export function readConfig(env = process.env) {
	const hand = (env.HAND_DRIVE || 'lhd').toLowerCase();
	if (hand !== 'lhd' && hand !== 'rhd') throw new Error(`HAND_DRIVE must be lhd or rhd, got "${env.HAND_DRIVE}"`);
	return {
		host: env.HOST || '127.0.0.1',
		port: int(env, 'PORT', 7300, 1, 65535),
		driveUrl: driveUrl(env.DRIVE_URL),
		hand,
		// What the phone is told the car screen is. The page letterboxes it.
		projection: {
			width: int(env, 'PROJECTION_WIDTH', 800, 320, 3840),
			height: int(env, 'PROJECTION_HEIGHT', 600, 240, 2160),
			fps: int(env, 'PROJECTION_FPS', 30, 10, 60),
			dpi: int(env, 'PROJECTION_DPI', 160, 80, 480),
		},
		nightMode: env.NIGHT_MODE === '1' || env.NIGHT_MODE === 'true',
		boxName: env.BOX_NAME || 'three.ws',
		// Capture through the box's own mic for Siri and calls (arecord).
		microphone: env.MICROPHONE !== 'off',
	};
}
