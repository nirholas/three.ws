// Screen / context capture utilities for the see_screen tool.
// Three modes: canvas (always), text (always), screen (user permission required).

async function captureCanvas(renderer) {
	return renderer.domElement.toDataURL('image/jpeg', 0.6);
}

function captureVisibleText() {
	const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
	const parts = [];
	let total = 0;
	while (walker.nextNode() && total < 2000) {
		const el = walker.currentNode;
		const style = window.getComputedStyle(el);
		if (style.display === 'none' || style.visibility === 'hidden') continue;
		const rect = el.getBoundingClientRect();
		if (rect.width === 0 && rect.height === 0) continue;
		if (el.children.length > 0) continue;
		const text = el.textContent?.trim();
		if (text) {
			parts.push(text);
			total += text.length;
		}
	}
	return parts.join('\n').slice(0, 2000);
}

async function captureScreen() {
	const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
	const track = stream.getVideoTracks()[0];
	try {
		const imageCapture = new ImageCapture(track);
		const bitmap = await imageCapture.grabFrame();
		const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
		canvas.getContext('2d').drawImage(bitmap, 0, 0);
		const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.6 });
		const buf = await blob.arrayBuffer();
		const bytes = new Uint8Array(buf);
		let binary = '';
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return 'data:image/jpeg;base64,' + btoa(binary);
	} finally {
		track.stop();
	}
}

/**
 * Capture the current screen context in the requested mode.
 * @param {import('three').WebGLRenderer} renderer
 * @param {{ mode?: 'canvas' | 'text' | 'screen' }} options
 * @returns {Promise<{ type: 'image' | 'text', data: string }>}
 */
export async function captureContext(renderer, { mode = 'canvas' } = {}) {
	if (mode === 'canvas') return { type: 'image', data: await captureCanvas(renderer) };
	if (mode === 'text') return { type: 'text', data: captureVisibleText() };
	if (mode === 'screen') return { type: 'image', data: await captureScreen() };
	throw new Error(`Unknown capture mode: ${mode}`);
}
