# Changelog

All notable changes to `pipecat-threews` are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

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
