// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 nirholas (https://github.com/nirholas/xspace-agent)

/**
 * AudioManager handles microphone capture, voice activity detection (VAD),
 * and TTS audio playback via the Web Audio API.
 */
export class AudioManager {
  private micStream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private audioChunks: Blob[] = [];
  private analyserCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private vadInterval: ReturnType<typeof setInterval> | null = null;
  private playbackCtx: AudioContext | null = null;
  private playbackQueue: AudioBuffer[] = [];
  private isPlayingAudio = false;
  private _isCapturing = false;
  private _isSpeakingVAD = false;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;

  private speechThreshold: number;
  private silenceDuration: number;
  private pushToTalk: boolean;

  /** Callbacks set by VoiceChatClient */
  onAudioData: ((base64: string, mimeType: string) => void) | null = null;
  onAudioLevel: ((level: number) => void) | null = null;
  onSpeakingChange: ((isSpeaking: boolean) => void) | null = null;
  onPlaybackStateChange: ((isPlaying: boolean) => void) | null = null;

  constructor(opts?: { speechThreshold?: number; silenceDuration?: number; pushToTalk?: boolean }) {
    this.speechThreshold = opts?.speechThreshold ?? 0.04;
    this.silenceDuration = opts?.silenceDuration ?? 1200;
    this.pushToTalk = opts?.pushToTalk ?? false;
  }

  get isCapturing(): boolean {
    return this._isCapturing;
  }

  get isPlaying(): boolean {
    return this.isPlayingAudio;
  }

  /** Request microphone access and start VAD analysis */
  async startCapture(): Promise<void> {
    if (this._isCapturing) return;

    this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.setupAnalyser(this.micStream);
    this.setupRecorder(this.micStream);
    this._isCapturing = true;

    if (!this.pushToTalk) {
      this.startVAD();
    }
  }

  /** Stop microphone capture and clean up */
  stopCapture(): void {
    this._isCapturing = false;
    this._isSpeakingVAD = false;

    if (this.vadInterval) {
      clearInterval(this.vadInterval);
      this.vadInterval = null;
    }
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
      this.silenceTimer = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
    this.mediaRecorder = null;

    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    if (this.analyserCtx) {
      this.analyserCtx.close().catch(() => {});
      this.analyserCtx = null;
      this.analyser = null;
    }
  }

  /** Push-to-talk: manually start recording */
  startRecording(): void {
    if (!this.mediaRecorder || this.mediaRecorder.state !== 'inactive') return;
    this.audioChunks = [];
    this.mediaRecorder.start(100);
  }

  /** Push-to-talk: manually stop recording and send */
  stopRecording(): void {
    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }
  }

  /** Decode and play base64 audio (TTS response) */
  async playAudio(base64: string): Promise<void> {
    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext();
    }
    const raw = atob(base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const audioBuffer = await this.playbackCtx.decodeAudioData(bytes.buffer.slice(0));
    this.playbackQueue.push(audioBuffer);

    if (!this.isPlayingAudio) {
      this.playNext();
    }
  }

  /** Use browser's built-in SpeechSynthesis for TTS fallback */
  playBrowserTTS(text: string): void {
    if (typeof speechSynthesis === 'undefined') return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.1;
    utterance.onstart = () => {
      this.isPlayingAudio = true;
      this.onPlaybackStateChange?.(true);
    };
    utterance.onend = () => {
      this.isPlayingAudio = false;
      this.onPlaybackStateChange?.(false);
    };
    speechSynthesis.speak(utterance);
  }

  /** Clean up all resources */
  destroy(): void {
    this.stopCapture();
    if (this.playbackCtx) {
      this.playbackCtx.close().catch(() => {});
      this.playbackCtx = null;
    }
    this.playbackQueue = [];
  }

  // --- Private ---

  private setupAnalyser(stream: MediaStream): void {
    this.analyserCtx = new AudioContext();
    this.analyser = this.analyserCtx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.smoothingTimeConstant = 0.3;

    const source = this.analyserCtx.createMediaStreamSource(stream);
    source.connect(this.analyser);
  }

  private setupRecorder(stream: MediaStream): void {
    const mimeType = typeof MediaRecorder !== 'undefined' &&
      MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    this.mediaRecorder = new MediaRecorder(stream, { mimeType });

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.audioChunks.push(e.data);
    };

    this.mediaRecorder.onstop = () => {
      if (this.audioChunks.length === 0) return;
      const blob = new Blob(this.audioChunks, { type: this.mediaRecorder?.mimeType || mimeType });
      this.audioChunks = [];

      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        if (base64) {
          this.onAudioData?.(base64, this.mediaRecorder?.mimeType || mimeType);
        }
      };
      reader.readAsDataURL(blob);
    };
  }

  private startVAD(): void {
    if (!this.analyser) return;
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    this.vadInterval = setInterval(() => {
      if (!this.analyser) return;
      this.analyser.getByteFrequencyData(dataArray);

      let sum = 0;
      for (let i = 3; i < 25; i++) sum += dataArray[i];
      const level = (sum / 22) / 255;

      this.onAudioLevel?.(level);

      if (level > this.speechThreshold) {
        if (!this._isSpeakingVAD) {
          this._isSpeakingVAD = true;
          this.onSpeakingChange?.(true);
          this.startRecording();
        }
        if (this.silenceTimer) {
          clearTimeout(this.silenceTimer);
          this.silenceTimer = null;
        }
      } else if (this._isSpeakingVAD && !this.silenceTimer) {
        this.silenceTimer = setTimeout(() => {
          this._isSpeakingVAD = false;
          this.onSpeakingChange?.(false);
          this.stopRecording();
          this.silenceTimer = null;
        }, this.silenceDuration);
      }
    }, 33);
  }

  private playNext(): void {
    if (this.playbackQueue.length === 0) {
      this.isPlayingAudio = false;
      this.onPlaybackStateChange?.(false);
      return;
    }
    this.isPlayingAudio = true;
    this.onPlaybackStateChange?.(true);

    const buffer = this.playbackQueue.shift()!;
    const source = this.playbackCtx!.createBufferSource();
    source.buffer = buffer;
    source.connect(this.playbackCtx!.destination);
    source.onended = () => this.playNext();
    source.start();
  }
}


