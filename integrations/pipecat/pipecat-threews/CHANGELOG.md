# Changelog

All notable changes to `pipecat-threews` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- `examples/grok_realtime_bot.py`: Pipecat's own Grok Voice realtime service
  (`pipecat.services.xai.realtime.llm.GrokRealtimeLLMService`, speech to
  speech) driving the avatar over a LiveKit room, with the `grok` extra
  (`pip install "pipecat-threews[grok]"`).
- `dev` extra with the test dependencies the README already pointed at.

### Fixed

- The first words of a speech-to-speech reply were dropped. Grok Voice (and
  any OpenAI Realtime style service) streams the transcript ahead of the
  audio, so its first `TTSTextFrame` arrives before `TTSStartedFrame`; the
  processor now buffers that text and discards an unfinished reply on
  `InterruptionFrame` or the next user turn instead. Covered by
  `tests/test_grok_realtime.py`, which replays xAI server events through the
  real upstream service.
- Both examples no longer pass `allow_interruptions` to `PipelineParams`;
  Pipecat 1.x ignores it (interruptions are on by default).

## [0.1.0] - 2026-10-13

### Added

- `ThreeWsAvatarProcessor`, a Pipecat frame processor that republishes a
  pipeline's TTS transcript, best-effort gesture cues, and user speech
  boundaries as JSON transport messages for three.ws's `<agent-3d>` web
  component to render client-side.
- `gesture_for_text`, the text heuristic used to decide a gesture cue.
- Foundational example (`examples/avatar_bot.py`) joining a local LiveKit
  room and speaking a scripted demo through a real local `espeak-ng` TTS
  service.
