const WATERMARK_URL = '/three.svg';
let watermarkImage = null;

async function getWatermark() {
	if (watermarkImage) return watermarkImage;
	try {
		const res = await fetch(WATERMARK_URL);
		if (!res.ok) throw new Error('Failed to load watermark');
		const svgText = await res.text();
		const blob = new Blob([svgText], { type: 'image/svg+xml' });
		const url = URL.createObjectURL(blob);
		const img = new Image();
		img.src = url;
		await new Promise((resolve, reject) => {
			img.onload = resolve;
			img.onerror = reject;
		});
		watermarkImage = img;
		return watermarkImage;
	} catch (e) {
		console.error('Failed to load watermark:', e);
		return null;
	}
}

getWatermark();

function _capture(viewer) {
	return new Promise(async (resolve) => {
		viewer.renderer.render(viewer.scene, viewer.activeCamera);
		const canvas = viewer.renderer.domElement;

		const watermark = await getWatermark();

		if (!watermark) {
			canvas.toBlob(resolve, 'image/png');
			return;
		}

		const tempCanvas = document.createElement('canvas');
		const ctx = tempCanvas.getContext('2d');
		tempCanvas.width = canvas.width;
		tempCanvas.height = canvas.height;

		ctx.drawImage(canvas, 0, 0);

		const margin = canvas.width * 0.04;
		const h = canvas.width * 0.05;
		const w = (h / watermark.height) * watermark.width;
		ctx.globalAlpha = 0.7;
		ctx.drawImage(watermark, margin, canvas.height - h - margin, w, h);
		ctx.globalAlpha = 1.0;

		tempCanvas.toBlob(resolve, 'image/png');
	});
}

export async function captureScreenshot(viewer) {
	flashScreenshotFeedback(viewer);
	return await _capture(viewer);
}

export async function takeScreenshot(viewer) {
	const blob = await captureScreenshot(viewer);
	if (!blob) return;

	const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.download = `3d-screenshot-${timestamp}.png`;
	link.href = url;
	link.click();
	URL.revokeObjectURL(url);
}

export function flashScreenshotFeedback(viewer) {
	const overlay = document.createElement('div');
	overlay.className = 'screenshot-flash';
	viewer.el.appendChild(overlay);
	overlay.addEventListener('animationend', () => overlay.remove());
}
