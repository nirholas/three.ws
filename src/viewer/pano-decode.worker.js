// One-shot decode worker for src/viewer/environment.js. createImageBitmap runs
// here so a 72 MP photo never blocks the page's main thread.
self.onmessage = async ({ data }) => {
	try {
		const bitmap = await createImageBitmap(new Blob([data.buffer], { type: data.mime }), data.options);
		self.postMessage({ bitmap }, [bitmap]);
	} catch (err) {
		self.postMessage({ error: String(err?.message || err) });
	}
};
