export function takeScreenshot(viewer) {
	// Render a fresh frame then capture via toBlob (avoids preserveDrawingBuffer overhead).
	viewer.renderer.render(viewer.scene, viewer.activeCamera);
	viewer.renderer.domElement.toBlob((blob) => {
		if (!blob) return;
		const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.download = `3d-screenshot-${timestamp}.png`;
		link.href = url;
		link.click();
		URL.revokeObjectURL(url);
	}, 'image/png');
	flashScreenshotFeedback(viewer);
}

export function flashScreenshotFeedback(viewer) {
	const overlay = document.createElement('div');
	overlay.className = 'screenshot-flash';
	viewer.el.appendChild(overlay);
	overlay.addEventListener('animationend', () => overlay.remove());
}
