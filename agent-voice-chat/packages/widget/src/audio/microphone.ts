// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/agent-voice-chat)

/**
 * Microphone capture with voice activity detection (VAD).
 *
 * Supports two modes:
 * - Push-to-talk: record while explicitly enabled, stop when disabled
 * - VAD: auto-detect speech and send when silence is detected
 */
export class Microphone {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private chunks: Blob[] = [];
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private isRecording = false;
  private vadEnabled = false;

  /** Minimum audio level to consider as speech */
  private readonly VAD_THRESHOLD = 0.04;
  /** Milliseconds of silence before sending */
  private readonly SILENCE_DURATION = 1200;

  /** Called when audio data is ready to send */
  onAudioData?: (audio: string, mimeType: string) => void;
  /** Called with current audio level (0-1) for visualisation */
  onAudioLevel?: (level: number) => void;

  constructor(private pushToTalk: boolean) {}

  /** Request microphone access and set up audio processing */
  async init(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });

    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);

    // Pick best supported codec
    const mimeType = this.getSupportedMimeType();

    this.recorder = new MediaRecorder(this.stream, {
      mimeType,
    });

    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };

    this.recorder.onstop = () => {
      if (this.chunks.length === 0) return;
      const blob = new Blob(this.chunks, { type: this.recorder!.mimeType });
      this.chunks = [];
      this.blobToBase64(blob).then((base64) => {
        this.onAudioData?.(base64, this.recorder!.mimeType);
      });
    };
  }

  /** Start recording */
  start(): void {
    if (!this.recorder || this.isRecording) return;
    this.chunks = [];
    this.recorder.start(100); // Collect chunks every 100ms
    this.isRecording = true;

    if (!this.pushToTalk) {
      this.vadEnabled = true;
      this.monitorVAD();
    }
  }

  /** Stop recording (for push-to-talk) or disable VAD */
  stop(): void {
    if (!this.isRecording) return;
    this.vadEnabled = false;
    this.clearSilenceTimer();

    if (this.recorder && this.recorder.state === 'recording') {
      this.recorder.stop();
    }
    this.isRecording = false;
  }

  /** Clean up all resources */
  destroy(): void {
    this.stop();
    if (this.stream) {
      this.stream.getTracks().forEach((t) => t.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    this.recorder = null;
    this.analyser = null;
  }

  get active(): boolean {
    return this.isRecording;
  }

  /** Monitor audio levels for VAD */
  private monitorVAD(): void {
    if (!this.analyser || !this.vadEnabled) return;

    const data = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(data);

    // Calculate RMS level normalized to 0-1
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const normalized = data[i] / 255;
      sum += normalized * normalized;
    }
    const level = Math.sqrt(sum / data.length);
    this.onAudioLevel?.(level);

    if (level > this.VAD_THRESHOLD) {
      // Speech detected — reset silence timer
      this.clearSilenceTimer();
    } else if (!this.silenceTimer && this.isRecording) {
      // Silence started — begin countdown
      this.silenceTimer = setTimeout(() => {
        this.finishVADSegment();
      }, this.SILENCE_DURATION);
    }

    if (this.vadEnabled) {
      requestAnimationFrame(() => this.monitorVAD());
    }
  }

  /** Finish a VAD segment: stop, send, then restart */
  private finishVADSegment(): void {
    if (!this.recorder || this.recorder.state !== 'recording') return;
    this.recorder.stop();
    this.isRecording = false;
    this.clearSilenceTimer();

    // Restart recording after a brief pause
    setTimeout(() => {
      if (this.vadEnabled && this.recorder) {
        this.chunks = [];
        this.recorder.start(100);
        this.isRecording = true;
      }
    }, 100);
  }

  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private getSupportedMimeType(): string {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/mp4',
    ];
    for (const type of types) {
      if (MediaRecorder.isTypeSupported(type)) return type;
    }
    return '';
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        // Strip the data URL prefix, return raw base64
        resolve(result.split(',')[1] || '');
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}
