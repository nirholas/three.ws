// Runtime capability gates for the lens. Nothing is assumed from the user agent:
// each capability is proven against the browser objects that actually exist, so
// the Talk view only offers voice when the lens browser really provides it and
// otherwise stays on the focused reply list.

export function detectCapabilities(win = globalThis) {
	const Recognition = win.SpeechRecognition || win.webkitSpeechRecognition || null;
	const synth = win.speechSynthesis || null;
	const hasUtterance = typeof win.SpeechSynthesisUtterance === 'function';
	return {
		speechInput: typeof Recognition === 'function',
		audioOut: !!synth && hasUtterance && typeof synth.speak === 'function',
		Recognition,
	};
}

// One utterance from the wearer. Resolves with the transcript, or rejects with an
// Error whose message is a short reason the view can show.
export function listenOnce(Recognition, lang = 'en-US') {
	return new Promise((resolve, reject) => {
		const rec = new Recognition();
		rec.lang = lang;
		rec.interimResults = false;
		rec.maxAlternatives = 1;
		rec.onresult = (e) => {
			const text = e.results && e.results[0] && e.results[0][0] && e.results[0][0].transcript;
			if (text && text.trim()) resolve(text.trim()); else reject(new Error('Nothing heard'));
		};
		rec.onerror = (e) => reject(new Error(e && e.error === 'not-allowed' ? 'Microphone is off for this app' : 'Nothing heard'));
		rec.onnomatch = () => reject(new Error('Nothing heard'));
		try { rec.start(); } catch { reject(new Error('Voice is unavailable')); }
	});
}

export function speak(win, text) {
	if (!text) return;
	win.speechSynthesis.cancel();
	win.speechSynthesis.speak(new win.SpeechSynthesisUtterance(String(text).slice(0, 400)));
}
