// One JPEG frame from a video, via ffmpeg. A video does not become a mesh by
// itself: the frame is what image-to-3D reconstructs. A full walkthrough cloud
// is the separate /capture lane.

import { spawn } from 'node:child_process';

function grabOnce(file, ffmpeg, seek) {
	return new Promise((resolve, reject) => {
		const child = spawn(ffmpeg, [
			'-hide_banner',
			'-loglevel', 'error',
			'-ss', String(seek),
			'-i', file,
			'-frames:v', '1',
			'-vf', 'scale=min(1280\\,iw):-2',
			'-f', 'image2',
			'-vcodec', 'mjpeg',
			'pipe:1',
		], { stdio: ['ignore', 'pipe', 'pipe'] });
		const chunks = [];
		let errText = '';
		child.stdout.on('data', (chunk) => chunks.push(chunk));
		child.stderr.on('data', (chunk) => { errText += chunk.toString(); });
		child.on('error', (err) => {
			if (err.code === 'ENOENT') {
				reject(new Error('ffmpeg is not installed, so a video cannot be turned into a frame. Install ffmpeg, or pass a photo.'));
				return;
			}
			reject(err);
		});
		child.on('close', (code) => {
			const buf = Buffer.concat(chunks);
			if (code !== 0 || buf.length < 32) {
				reject(new Error(errText.trim() || `could not read a frame from ${file}`));
				return;
			}
			resolve(new Uint8Array(buf));
		});
	});
}

// One JPEG, at most 1280 pixels wide. Seek one second in, then the first frame
// when the clip is shorter than that. A missing ffmpeg is reported once.
export async function grabVideoFrame(file, { ffmpeg = 'ffmpeg', seek = '1' } = {}) {
	try {
		return await grabOnce(file, ffmpeg, seek);
	} catch (err) {
		if (seek === '0' || /ffmpeg is not installed/.test(err?.message || '')) throw err;
		return grabOnce(file, ffmpeg, '0');
	}
}
