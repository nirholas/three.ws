# Audio Utilities

Low-level audio processing utilities. Used internally by the SDK but exported for advanced usage such as custom audio pipelines.

```ts
import { VoiceActivityDetector, pcmChunksToWav, mp3ToPcmFloat32 } from 'xspace-agent'
```

---

## VoiceActivityDetector

Detects speech segments in a continuous audio stream by monitoring RMS energy levels. Uses adaptive thresholding based on ambient noise to distinguish speech from silence.

```ts
import { VoiceActivityDetector } from 'xspace-agent'
```

### Constructor

```ts
new VoiceActivityDetector(options?: VADConfig)
```

#### VADConfig

```ts
interface VADConfig {
  threshold?: number
  adaptive?: boolean
  minSpeechDurationMs?: number
  maxSilenceDurationMs?: number
  sampleRate?: number
  silenceThresholdMs?: number  // @deprecated
  minChunks?: number
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `threshold` | `number` | — | Manual RMS threshold. Setting this disables adaptive mode. |
| `adaptive` | `boolean` | `true` | Use adaptive threshold based on ambient noise level |
| `minSpeechDurationMs` | `number` | `250` | Minimum continuous speech duration (ms) before a segment is accepted |
| `maxSilenceDurationMs` | `number` | `1500` | Silence duration (ms) that closes a speech segment |
| `sampleRate` | `number` | `16000` | Sample rate for duration calculations |
| `silenceThresholdMs` | `number` | — | **Deprecated.** Use `maxSilenceDurationMs`. |
| `minChunks` | `number` | — | Minimum speech chunks required. Overrides `minSpeechDurationMs`. |

### How Adaptive Thresholding Works

When `adaptive` is `true` (default):

1. The VAD tracks a running noise floor estimate using exponential moving average (EMA, alpha = 0.05).
2. Only silence chunks update the noise floor.
3. The speech threshold is `max(0.0001, noiseFloor * 2.5)`.
4. This allows the VAD to adapt to varying ambient noise conditions.

When a fixed `threshold` is provided, adaptive mode is disabled and the given value is used directly.

### Methods

#### feed(pcmBase64)

```ts
feed(pcmBase64: string): void
```

Feed a base64-encoded PCM float32 audio chunk. The VAD analyzes the chunk's RMS energy and accumulates speech segments. When silence exceeding `maxSilenceDurationMs` is detected after speech, the `onSpeech` callback fires with the accumulated chunks.

| Parameter | Type | Description |
|-----------|------|-------------|
| `pcmBase64` | `string` | Base64-encoded PCM float32 audio data |

---

#### onSpeech(callback)

```ts
onSpeech(callback: (chunks: Buffer[]) => void): void
```

Register a callback that fires when a complete speech segment is detected (speech followed by sufficient silence).

| Parameter | Type | Description |
|-----------|------|-------------|
| `callback` | `(chunks: Buffer[]) => void` | Receives an array of raw PCM float32 buffers |

---

#### reset()

```ts
reset(): void
```

Clear all accumulated chunks and cancel any pending silence timer **without** firing the callback.

---

#### destroy()

```ts
destroy(): void
```

Clean up all resources, clear timers, and remove the callback. The instance should not be used after calling `destroy()`.

### Example

```ts
const vad = new VoiceActivityDetector({
  maxSilenceDurationMs: 2000,  // 2 seconds of silence to end segment
  minSpeechDurationMs: 500,    // ignore segments shorter than 500ms
  adaptive: true,
})

vad.onSpeech((chunks) => {
  const wavBuffer = pcmChunksToWav(chunks)
  // Send to STT, save to file, etc.
  console.log(`Speech detected: ${chunks.length} chunks`)
})

// Feed audio from a stream
audioStream.on('data', (pcmBase64: string) => {
  vad.feed(pcmBase64)
})

// Clean up
process.on('SIGINT', () => {
  vad.destroy()
})
```

---

## pcmChunksToWav

Convert an array of PCM float32 buffers to a WAV file buffer.

```ts
function pcmChunksToWav(pcmChunks: Buffer[], sampleRate?: number): Buffer
```

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `pcmChunks` | `Buffer[]` | — | Array of PCM float32 audio buffers |
| `sampleRate` | `number` | `16000` | Sample rate in Hz |

**Returns:** `Buffer` — WAV-formatted audio (PCM int16, 16-bit, mono).

The function concatenates all input buffers, converts float32 samples to int16, and wraps the result in a valid WAV header.

**Example:**

```ts
import { pcmChunksToWav } from 'xspace-agent'
import fs from 'fs'

// Convert accumulated speech chunks to a WAV file
const wavBuffer = pcmChunksToWav(speechChunks, 16000)
fs.writeFileSync('speech.wav', wavBuffer)
```

---

## mp3ToPcmFloat32

Convert an MP3 buffer to PCM float32 format using ffmpeg.

```ts
function mp3ToPcmFloat32(mp3Buffer: Buffer): Buffer
```

| Parameter | Type | Description |
|-----------|------|-------------|
| `mp3Buffer` | `Buffer` | MP3 audio data |

**Returns:** `Buffer` — PCM float32 audio at 48kHz, mono.

**Requires:** `ffmpeg` must be installed and available on the system PATH.

**Throws:** `Error` if ffmpeg is not found or the conversion fails.

**Example:**

```ts
import { mp3ToPcmFloat32 } from 'xspace-agent'
import fs from 'fs'

const mp3 = fs.readFileSync('audio.mp3')
const pcm = mp3ToPcmFloat32(mp3)
// pcm is a Buffer of float32 samples at 48kHz
```


