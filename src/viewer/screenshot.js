function _capture(viewer) {
	return new Promise((resolve) => {
		viewer.renderer.render(viewer.scene, viewer.activeCamera);
		viewer.renderer.domElement.toBlob(resolve, 'image/png');
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
