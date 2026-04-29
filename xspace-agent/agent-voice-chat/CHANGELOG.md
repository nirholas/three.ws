# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-23

### Added
- Multi-agent voice chat with turn management
- LLM providers: OpenAI Realtime (WebRTC), OpenAI Chat, Claude, Groq
- Speech-to-text: Groq Whisper, OpenAI Whisper
- Text-to-speech: OpenAI TTS, ElevenLabs, browser fallback
- Dynamic agent configuration via `agents.config.json`
- Agent management REST API (`/api/agents`)
- Room-based isolation for multi-tenancy
- Voice activity detection (VAD) on the client
- Real-time streaming text responses via Socket.IO
- Text input mode alongside voice
- Customizable agent personalities, voices, and themes
- Embeddable widget (in progress)
- Comprehensive documentation


