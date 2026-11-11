# Tech Community article: on-device speech for a 3D agent with ONNX Runtime Web

**Status:** draft, not posted. Posting on the Microsoft Tech Community is an owner step. Every number below was measured on 2026-11-11; re-measure before posting, because versions and model files move.

**Suggested board:** the AI or web development space that fits best when posting.

---

# Wake word, voice activity and transcription in the browser: ONNX Runtime Web inside a 3D agent

A 3D agent that you talk to has a privacy problem the moment it has a microphone. If listening runs on a server, the page streams a live room to someone else's machine just to learn whether anyone spoke. At three.ws, where agents are rigged 3D characters that speak, emote and lip-sync, we moved that listening work into the visitor's browser with [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/) (Microsoft, MIT license). This article walks through the three models we run, the code that runs them, and what they cost.

## The pipeline

Both voice paths in the product start the same way:

```
mic ─▶ silero VAD ─▶ openWakeWord ─▶ capture ─▶ transcription ─▶ agent turn ─▶ speech + lip-sync
```

- **Voice activity detection** decides when someone is speaking and when they have stopped. It is [Silero VAD v5](https://github.com/snakers4/silero-vad) (MIT) through [`@ricky0123/vad-web`](https://github.com/ricky0123/vad) 0.0.31.
- **Wake-word detection** decides whether the speech was addressed to the agent. It runs the pre-trained models and inference graph from [openWakeWord](https://github.com/dscripka/openWakeWord) v0.5.1 (Apache-2.0).
- **Transcription** turns one utterance into text. English goes to [Moonshine Base](https://huggingface.co/onnx-community/moonshine-base-ONNX) (Useful Sensors, MIT); every other language goes to [Whisper Base](https://huggingface.co/onnx-community/whisper-base) (OpenAI, Apache-2.0), pinned to the requested language. Both run through [Transformers.js](https://github.com/huggingface/transformers.js) 4.3.1.

Every one of those models is an ONNX graph, and every one of them executes on ONNX Runtime Web's WebAssembly execution provider. We pin `onnxruntime-web` 1.31.1.

## One microphone, three models

The first design rule is that the browser opens the microphone once. The VAD, the wake word and the utterance capture all read the same `MediaStream` and the same `AudioContext`, so there is one recording indicator and one set of tracks to stop when the user mutes. Our VAD wrapper ([`src/voice/vad.js`](https://github.com/nirholas/three.ws/blob/main/src/voice/vad.js)) hands `MicVAD` the caller's stream instead of letting it call `getUserMedia` itself:

```js
this._vad = await MicVAD.new({
	model: 'v5',
	baseAssetPath: this.assetPath,
	onnxWASMBasePath: this.assetPath,
	// The caller owns the mic. Handing MicVAD the existing stream and
	// context is what keeps this to one getUserMedia for the whole loop.
	getStream: async () => this.stream,
	audioContext: this.audioContext,
	redemptionMs: this.redemptionMs,
	// ...
	ortConfig: (ort) => {
		ort.env.logLevel = 'error';
		// One thread: the loop shares the machine with a WebGL scene, and
		// cross-origin isolation (which multi-threaded wasm needs) is not
		// something a page embedding third-party avatars can assume.
		ort.env.wasm.numThreads = 1;
	},
});
```

Two choices there matter next to a 3D scene. We run the WebAssembly backend with **one thread**, because multi-threaded WebAssembly needs `SharedArrayBuffer`, which needs a cross-origin-isolated page, and an agent embedded on somebody else's site cannot demand those headers. And the WebGL renderer already owns the GPU, so we leave speech on the CPU.

Silero v5 reads 512-sample frames at 16 kHz, which is 32 ms per frame. That granularity is why we use v5 rather than the legacy model, whose 1,536-sample frame is 96 ms. Hands-free turn-taking ends an utterance after 352 ms of trailing silence (11 frames), keeps 480 ms of audio from before speech was detected so the first consonant survives, and ignores anything shorter than 250 ms as a cough or a door.

## The wake word, graph by graph

openWakeWord ships three ONNX models and the framing they were trained on, and the weights only mean something if that framing is reproduced exactly. [`src/voice/wake-word.js`](https://github.com/nirholas/three.ws/blob/main/src/voice/wake-word.js) does that with three `InferenceSession`s:

```
16 kHz mono audio, int16 scale
   -> melspectrogram.onnx      every 80 ms chunk, over the last 1760 samples,
                                giving 8 new mel frames of 32 bins (10 ms hop)
   -> (mel / 10) + 2           upstream's transform, not a normalisation we chose
   -> embedding_model.onnx     a 76-frame (760 ms) window -> one 96-d embedding
   -> <wake word>.onnx         the last 16 embeddings (1.96 s) -> one score
```

Loading is ordinary ONNX Runtime Web, pointed at runtime files we serve ourselves so the always-on microphone path never touches a third-party CDN:

```js
async function loadOrt() {
	if (!ortPromise) {
		ortPromise = import('onnxruntime-web/wasm').then((ort) => {
			ort.env.wasm.wasmPaths = RUNTIME_PATH;
			ort.env.wasm.numThreads = 1;
			ort.env.logLevel = 'error';
			return ort;
		});
	}
	return ortPromise;
}
```

```js
const opts = { executionProviders: ['wasm'] };
const [mel, embed, model] = await Promise.all([
	ort.InferenceSession.create(`${MODEL_PATH}melspectrogram.onnx`, opts),
	ort.InferenceSession.create(`${MODEL_PATH}embedding_model.onnx`, opts),
	ort.InferenceSession.create(`${MODEL_PATH}${this.definition.file}`, opts),
]);
```

Importing `onnxruntime-web/wasm` rather than the default entry keeps the WebGPU runtime out of the download. The mel and embedding stages are shared by every wake phrase, so switching phrases refetches only the small classifier. The default phrase, "Hey Jarvis", costs 3,685,906 bytes across its three graphs; the smallest classifier in the catalog is 204,081 bytes.

Each 80 ms chunk then runs the chain and produces one score. Three details came out of making this behave on an always-on microphone:

**Drop, never queue.** If the previous chunk is still in flight, the new one is dropped. On a slow machine an unbounded backlog turns a fast detection into one that fires seconds late.

```js
async _consume(chunk) {
	// A dropped chunk is better than a queue: on a machine slow enough to fall
	// behind, an unbounded backlog turns a 200 ms detection into a 3 s one.
	if (this._inflight) return;
	this._inflight = true;
```

**Prime with silence.** The detector needs 2,040 ms of audio (the 760 ms mel window plus 16 embeddings at 80 ms) before its first score. Rather than be deaf for two seconds after it loads, and again after every wake, mute or barge-in, it runs the chain over digital silence to fill its ring buffers.

**The agent must not wake itself.** When a 3D agent speaks its own name through laptop speakers, echo cancellation is not a guarantee. The decision that turns a score into a wake is a pure function, so the guard can be tested without a model:

```js
export function decideWake({ score, threshold, above, suppressed, sinceLastWakeMs, refractoryMs = REFRACTORY_MS }) {
	const nowAbove = score >= threshold;
	if (suppressed) return { wake: false, above: nowAbove };
	if (!nowAbove || above) return { wake: false, above: nowAbove };
	if (sinceLastWakeMs < refractoryMs) return { wake: false, above: nowAbove };
	return { wake: true, above: nowAbove };
}
```

While the agent is talking, `suppressed` is true and no score wakes it. Only a rising edge across the 0.5 threshold wakes, and a 1,500 ms refractory window keeps the trailing audio of the wake word, still in the ring buffer, from scoring twice.

## Transcription on the device

The agent runtime's `whisper` speech-to-text provider ([`src/runtime/whisper-stt.js`](https://github.com/nirholas/three.ws/blob/main/src/runtime/whisper-stt.js)) uses the same VAD to cut one utterance, then hands the 16 kHz buffer to a Transformers.js pipeline running on ONNX Runtime Web:

```js
const { pipeline, env } = await transformersModule;
// Models come from the Hugging Face CDN only. Without this the library first
// probes /models/<id>/ on the current origin, which on a host page that
// embeds an agent is someone else's server.
env.allowLocalModels = false;
return pipeline('automatic-speech-recognition', model, {
	dtype: 'q8',
	device: 'wasm',
	progress_callback: fanOut,
});
```

Language routing is one small function. English gets Moonshine, which is smaller and faster; everything else gets multilingual Whisper pinned to the language, so it never guesses:

```js
export function onDeviceModelFor(language) {
	const lang = primaryLanguage(language);
	if (lang === 'en') return { model: ON_DEVICE_MODELS.english, options: {} };
	return { model: ON_DEVICE_MODELS.multilingual, options: { language: lang, task: 'transcribe' } };
}
```

The 8-bit quantized graphs are what a first visit downloads: 63,011,933 bytes for Moonshine Base and 76,894,629 bytes for Whisper Base (encoder plus merged decoder), cached by the browser afterwards. To hide that first load, the download starts the moment listening starts, so it overlaps the user speaking instead of following it, and one pipeline per model is shared by every agent on the page.

Because Whisper reads a 30-second window, an utterance is cut at 28 seconds; in continuous mode the rest of the same sentence keeps streaming into the next segment. Push-to-talk ends a turn after 1,500 ms of silence, longer than the hands-free loop, because an ordinary mid-sentence pause should not end the turn.

## Where the audio goes

Exactly what the code does:

- **Nothing loads before opt-in.** The VAD, the wake-word module, ONNX Runtime and every model byte sit behind dynamic imports reached only when the user enables listening.
- **Wake-word audio never leaves the tab.** Its ring buffers hold under two seconds of audio and are overwritten continuously. Nothing is uploaded or written to disk.
- **On-device transcription first, with an explicit opt-out of the fallback.** The `whisper` provider tries the on-device model first and falls back to a server recognizer only if the on-device run throws. A page that promises audio stays local sets `onDeviceOnly`, which removes the server rung entirely, so a failure rejects instead of uploading the clip:

```js
return this.onDeviceOnly ? engines.slice(0, 1) : engines;
```

- **The hands-free home loop is honest about its split.** Wake word and VAD run on the device; only the utterance after a detected wake word is sent for transcription.

## What it costs on a real machine

We measured the exact graphs and options above in headless Chromium 158 on an AMD EPYC 7B12, without cross-origin isolation, so ONNX Runtime Web ran single-threaded, as it does for a visitor:

| Workload | Measured |
|---|---|
| Wake-word chain (mel, embedding, classifier) per 80 ms chunk | 7.4 to 7.7 ms median, 10.5 to 11.9 ms p95, per run of 137 chunks |
| Moonshine Base q8 on the 11-second JFK clip | 1.88 to 2.20 s per run over four runs, word-perfect |
| Whisper Base q8 on the same clip, pinned to English | 5.72 to 5.99 s per run over four runs, word-perfect |

At the 95th percentile the wake word uses under 15 percent of each 80 ms budget, which is what lets it run all day next to a WebGL scene. Moonshine transcribes English several times faster than real time on one thread, which is why it, not Whisper, is the English default.

## Tests

The safety-relevant logic is unit-tested without a model: 15 tests cover language routing, the 28-second window and the fallback order (including that `onDeviceOnly` drops the server rung), and 39 tests cover the voice loop, including that a suppressed detector never wakes however high the score. `scripts/check-home-voice.mjs` drives the hands-free loop in real Chromium through Playwright, with a fake capture device fed from WAV files.

## Try it

The code is open source in [github.com/nirholas/three.ws](https://github.com/nirholas/three.ws), in the three files linked above. To give your own agent on-device speech, set its manifest's `voice.stt.provider` to `whisper`.

Thanks to the ONNX Runtime team, and to the Silero, openWakeWord, Moonshine and Whisper authors for releasing their models under open licenses.

three.ws and Microsoft have announced a partnership, and three.ws is live on Microsoft Marketplace. ONNX Runtime is a trademark of the Microsoft group of companies.
