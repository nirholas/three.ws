# OSS talking-avatar / VTuber / lip-sync / voice-agent / TTS-STT repos vs three.ws embodied agents (as of 2026-10-09)

Method note: stars, SPDX license and pushed_at come from the GitHub REST API (https://api.github.com/repos/OWNER/NAME) fetched 2026-10-09. "NOASSERTION" means GitHub could not classify the LICENSE file. Claims not yet verified against a primary page are listed under Gaps. three.ws baseline (from surfaces list): `<agent-3d>` component, chat, voice lane (`@three-ws/voice`, agent voice cloning), gesture vocabulary, procedural IK, VRM/Mixamo rig support, ARKit-52 auto-rig worker, companion, /drive, /voice/home, assistant widget, terminal avatar, Motion Swap, Splat viewer.

## 1. Browser 3D talking heads and VTuber stacks

### Takeaway
No browser repo matches three.ws's breadth (embed, rigs, commerce), but TalkingHead (MIT, 3D, browser) and AITuberKit/Open-LLM-VTuber (huge feature sets, restrictive or mixed licenses) show lip-sync, multi-language visemes, streaming-TTS sync, and interruption/desktop-pet UX that three.ws should match. Only MIT/Apache code can be adopted directly.

### Cited Findings
- TalkingHead (met4citizen) https://github.com/met4citizen/TalkingHead : 1,599 stars (2026-10-09), MIT, last push 2026-09-25; "JavaScript class for real-time lip-sync using full-body 3D avatars" : [GitHub API](https://api.github.com/repos/met4citizen/TalkingHead). Closest direct competitor; MIT code so adoptable. Avatar assets (Ready Player Me / Avaturn GLBs) carry their own terms.
- three-vrm (pixiv) https://github.com/pixiv/three-vrm : 2,209 stars (2026-10-09), MIT, last push 2026-10-02 : [GitHub API](https://api.github.com/repos/pixiv/three-vrm). Already the VRM runtime layer; three.ws "VRM/Mixamo rig support" is covered; track for VRM 1.0 expression/lookAt/spring-bone features.
- AITuberKit (tegnike) https://github.com/tegnike/aituber-kit : 1,118 stars (2026-10-09), SPDX NOASSERTION, last push 2026-10-04 : [GitHub API](https://api.github.com/repos/tegnike/aituber-kit). License is a custom dual: free Non-Commercial license, commercial use needs a separate paid license (contact support@aituberkit.com) : [LICENSE](https://raw.githubusercontent.com/tegnike/aituber-kit/main/LICENSE). Cannot adopt code; adopt design only. Not Apache-compatible.
- Open-LLM-VTuber https://github.com/Open-LLM-VTuber/Open-LLM-VTuber : 14,025 stars (2026-10-09), SPDX NOASSERTION, last push 2026-05-15 (no push in ~5 months) : [GitHub API](https://api.github.com/repos/Open-LLM-VTuber/Open-LLM-VTuber). README says project is MIT-implied but bundled Live2D sample models are under Live2D Free Material License (commercial/enterprise needs permission); features: hands-free voice + voice interruption, Live2D expressions, desktop-pet transparent mode, camera/screen vision, touch feedback, proactive speech, inner thoughts display, offline local models; long-term memory "temporarily removed"; v2.0 complete rewrite is only in planning : [README](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber). 2D Live2D, not 3D. Verdict: adopt design (proactive speech, inner thoughts, desktop pet; three.ws already has a desktop companion app).
- Amica (semperai) https://github.com/semperai/amica : ~1.6k stars (README page capture, 2026-10-09), MIT (3D assets under their authors' licenses); VRM display, voice chat (STT+VAD), multi-service/local TTS, Llama.cpp/Ollama/OpenAI-compatible/OpenRouter backends, Bakllava vision, emotional expressions, Tauri desktop : [GitHub](https://github.com/semperai/amica). Verdict: already covered; adopt design (emotion tags in LLM output).
- Utsuwa (The-Lab-by-Ordinary-Company) https://github.com/The-Lab-by-Ordinary-Company/utsuwa : privacy-first VRM companion, 7 LLM providers, lip-sync, relationship-progression system, local memory embeddings, MIT, macOS desktop only : [search summary of README](https://proxy-dev.blitzz.co/proxy/123456/github.com/The-Lab-by-Ordinary-Company/utsuwa) (proxy mirror; verify on GitHub). Relationship-progression is a feature three.ws /companion may lack.
- ARPAHLS/avatar https://github.com/arpahls/avatar : desktop VRM/VRMA companion, lip-sync to live/system audio, MIT; sample animations belong to pixiv VRoid and need credit for commercial use : [search summary](https://github.com/arpahls/avatar).
- Clawatar (Dongping-Chen): VRM viewer skill for AI agents over WebSocket, 162 animations, TTS lip-sync (ElevenLabs); its Mixamo-derived animations are non-commercial : [playbooks listing](https://playbooks.com/skills/openclaw/skills/clawatar). Overlaps with three.ws gestures + Spatial MCP; not adoptable.
- TEN Framework example "Lip Sync Avatars": Live2D character Kei with MotionSync lip sync, plus Trulience, HeyGen, Tavus avatar vendors : [TEN README](https://github.com/TEN-framework/ten-framework).
- ChatVRM (pixiv) and forks: not fetched (see Gaps).

### Inferences
- The strongest open 3D-in-browser rival is TalkingHead; none bundle three.ws's embed distribution, rig doctor, wallet/commerce, or in-car/house surfaces.
- Verdicts: TalkingHead = adopt design, rebuild (MIT, so code is allowed but three.ws has own viseme path; diff multi-language viseme tables and streaming-sync API); three-vrm = already covered; AITuberKit = adopt design, rebuild (license blocks code); Open-LLM-VTuber = adopt design, rebuild; Amica/Utsuwa/ARPAHLS = adopt design (relationship progression, system-audio lip-sync).

### Gaps
- ChatVRM forks, Amica license/stars, Utsuwa stars not API-verified.

## 2. Video talking-head / lip-sync models

### Takeaway
SOTA is Wan-based diffusion (InfiniteTalk, SoulX-FlashTalk-14B) with Apache-2.0 code; MuseTalk is the only truly real-time lightweight option with MIT code and commercial-use weights. All need GPU, so they fit three.ws's GPU worker fleet rather than the browser, and complement (not replace) the 3D avatars.

### Cited Findings
- LivePortrait (KwaiVGI) https://github.com/KwaiVGI/LivePortrait : 19,191 stars (2026-10-09), code MIT (LICENSE "Copyright (c) 2024 Kuaishou") : [LICENSE](https://raw.githubusercontent.com/KwaiVGI/LivePortrait/main/LICENSE); last push 2026-06-01 : [API](https://api.github.com/repos/KwaiVGI/LivePortrait). GitHub flags SPDX NOASSERTION. Weights on HF KlingTeam/LivePortrait; README does not state weight terms; depends on InsightFace (non-commercial weights per my background knowledge, UNVERIFIED) : [README](https://github.com/KwaiVGI/LivePortrait). Features: image/video-driven portrait animation, animals mode, video editing, motion templates (.pkl), regional control.
- MuseTalk (TMElyralab) https://github.com/TMElyralab/MuseTalk : 6,691 stars (2026-10-09), SPDX NOASSERTION in API but README states code MIT (academic and commercial) and weights "available for any purpose"; last push 2025-09-26 (stale); v1.5 released 2025-03-28; claims 30fps+ on V100; 256x256 face region; third-party parts (whisper, dwpose, S3FD) have own licenses : [README](https://github.com/TMElyralab/MuseTalk), [API](https://api.github.com/repos/TMElyralab/MuseTalk). Verdict: adopt code into a GPU worker (realtime lip-sync of a photo/video).
- LatentSync (ByteDance) https://github.com/bytedance/LatentSync : 6,123 stars, Apache-2.0, last push 2025-06-20 (stale) : [API](https://api.github.com/repos/bytedance/LatentSync). Weights license not verified.
- InfiniteTalk (MeiGen-AI) https://github.com/MeiGen-AI/InfiniteTalk : 8,026 stars, Apache-2.0, last push 2026-05-22 : [API](https://api.github.com/repos/MeiGen-AI/InfiniteTalk). Sparse-frame video dubbing / unlimited-length talking video on Wan.
- SoulX-FlashTalk-14B (Soul-AILab): real-time infinite-streaming audio-driven avatar via self-correcting bidirectional distillation; code and weights released 2026-01-08; HF metadata Apache-2.0; built on InfiniteTalk and Wan; 14B needs heavy GPU : [model card](https://huggingface.co/Soul-AILab/SoulX-FlashTalk-14B/raw/main/README.md). Newest SOTA found; stars not checked.
- TalkingAvatar TA2.0 (neosapience): Apache-2.0, image+audio+prompt to 480x832 25fps H.264 video, offline clips not streaming : [GitHub](https://github.com/neosapience/TA2.0).
- Hallo3 (fudan-generative-vision) https://github.com/fudan-generative-vision/hallo3 : 1,407 stars, MIT, last push 2025-03-13 (stale) : [API](https://api.github.com/repos/fudan-generative-vision/hallo3).
- EchoMimic V3 (antgroup) https://github.com/antgroup/echomimic_v3 : 1,079 stars, Apache-2.0, last push 2026-03-18 : [API](https://api.github.com/repos/antgroup/echomimic_v3).
- Others named by one blog, unchecked: OpenTalking (full STT-LLM-TTS-avatar WebRTC loop), SoulX-LiveAct, duix.ai, LiveTalking : [Atlas Cloud blog](https://www.atlascloud.ai/id/blog/guides/free-opensource-ai-avatar-heygen-alternative) (vendor blog, low reliability).

### Inferences
- three.ws's Motion Swap and GPU fleet could host MuseTalk (realtime) and InfiniteTalk/FlashTalk (quality) as "photoreal talking video" lanes. Verdict: MuseTalk adopt code (worker); InfiniteTalk/FlashTalk adopt code (heavy, Apache); LivePortrait adopt design only until weights/InsightFace terms confirmed; Hallo3/EchoMimic/LatentSync stale or lower priority.

### Gaps
- Weight licenses for LatentSync, InfiniteTalk, Hallo3, EchoMimic V3 not verified. SoulX-FlashTalk stars/fps not verified.

## 3. Real-time voice-agent frameworks

### Takeaway
Pipecat (BSD-2) and LiveKit Agents (Apache-2.0) are the permissive standards, both pushed within the day; three.ws can adopt them for transport/turn-taking. Moshi/Unmute give full-duplex speech-to-speech with CC-BY weights. TEN's license has extra restrictions.

### Cited Findings
- Pipecat https://github.com/pipecat-ai/pipecat : 16,306 stars (2026-10-09), BSD-2-Clause, pushed 2026-10-09 : [API](https://api.github.com/repos/pipecat-ai/pipecat). Daily-maintained; has avatar/video vendor integrations (not verified individually).
- LiveKit Agents https://github.com/livekit/agents : 14,663 stars, Apache-2.0, pushed 2026-10-09 : [API](https://api.github.com/repos/livekit/agents).
- TEN Framework https://github.com/TEN-framework/ten-framework : 11,155 stars, NOASSERTION ("Apache 2.0 with additional restrictions"; packages are plain Apache-2.0), pushed 2026-10-09 : [API](https://api.github.com/repos/TEN-framework/ten-framework), [README](https://github.com/TEN-framework/ten-framework). Ships TEN VAD, TEN Turn Detection (full-duplex), SIP call agent, ESP32 hardware agent, TMAN visual designer, lip-sync avatar example. Root license restrictions text not read: treat as not adoptable until read.
- Kyutai Moshi https://github.com/kyutai-labs/moshi : 11,191 stars, Apache-2.0 per API (README: Python MIT, Rust Apache, client MIT), weights CC-BY 4.0, theoretical 160 ms / ~200 ms practical on L4, last push 2026-09-09 : [API](https://api.github.com/repos/kyutai-labs/moshi), [README](https://github.com/kyutai-labs/moshi).
- Kyutai Unmute https://github.com/kyutai-labs/unmute : 1,523 stars, MIT, pushed 2026-09-09 : [API](https://api.github.com/repos/kyutai-labs/unmute). Modular STT+LLM+TTS voice wrapper.
- Sesame CSM https://github.com/SesameAILabs/csm : 14,727 stars, Apache-2.0, last push 2025-05-27 (stale) : [API](https://api.github.com/repos/SesameAILabs/csm).

### Inferences
- Verdicts: Pipecat, LiveKit Agents = already covered in spirit (three.ws has own voice lane) but adopt as optional transports; compare turn-taking/interruption; Moshi = adopt design (full-duplex), weights CC-BY ok with attribution; TEN = adopt design only (read license); CSM = stale.

### Gaps
- Whether three.ws voice lane has barge-in/semantic turn detection not checked in docs.

## 4. TTS / STT

### Takeaway
Permissive TTS options exist (Chatterbox MIT, Kokoro Apache, Orpheus Apache, Dia Apache, CosyVoice Apache); F5-TTS weights and Fish Speech are non-commercial/research licensed. VibeVoice says research-only.

### Cited Findings
- Chatterbox (Resemble AI) https://github.com/resemble-ai/chatterbox : 26,820 stars, MIT, pushed 2026-07-21 : [API](https://api.github.com/repos/resemble-ai/chatterbox). README lists MIT for repo, no separate weights terms shown; Perth neural watermark on all output; Turbo 350M English with [laugh] paralinguistic tags (one-step decoder), Nano 110M CPU ~3x realtime, Multilingual V3 500M 23+ languages : [README](https://github.com/resemble-ai/chatterbox). Verdict: adopt code (self-host TTS lane).
- Kokoro (hexgrad) https://github.com/hexgrad/kokoro : 9,227 stars, Apache-2.0, last push 2025-08-06 : [API](https://api.github.com/repos/hexgrad/kokoro).
- Fish Speech https://github.com/fishaudio/fish-speech : 32,978 stars, NOASSERTION; code AND weights under Fish Audio Research License (not commercial-free; commercial needs Fish license); S2-Pro 4B, 10M+ hours, 80+ languages, inline [whisper]/[excited] tags, multi-speaker, streaming 100 ms TTFA on H200 (RTF 0.195); pushed 2026-10-05 : [README](https://github.com/fishaudio/fish-speech), [API](https://api.github.com/repos/fishaudio/fish-speech). Not adoptable commercially without a license; adopt design (inline emotion tags).
- Orpheus-TTS (canopyai) : 6,346 stars, Apache-2.0, pushed 2025-12-05 : [API](https://api.github.com/repos/canopyai/Orpheus-TTS).
- Dia (nari-labs) : 19,400 stars, Apache-2.0, pushed 2025-11-19 : [API](https://api.github.com/repos/nari-labs/dia).
- VibeVoice (Microsoft) https://github.com/microsoft/VibeVoice : 54,709 stars, MIT, pushed 2026-10-08; models: ASR-7B (60 min single pass), ASR-Streaming, ASR-BitNet (CPU), TTS-1.5B (90 min), Realtime-0.5B; README says TTS code removed 2025-09-05 after misuse and models are research/development only, not for commercial use without further testing : [README](https://github.com/microsoft/VibeVoice), [API](https://api.github.com/repos/microsoft/VibeVoice). Do not ship in production on this README alone.
- F5-TTS https://github.com/SWivid/F5-TTS : 15,361 stars, code MIT, pretrained weights CC-BY-NC (Emilia data); pushed 2026-09-21 : [README](https://github.com/SWivid/F5-TTS), [API](https://api.github.com/repos/SWivid/F5-TTS). Weights not commercially usable.
- CosyVoice (FunAudioLLM) : 23,902 stars, Apache-2.0 code, pushed 2026-05-25; latest Fun-CosyVoice3-0.5B-2512 (Dec 2025), bi-streaming latency as low as 150 ms; weights license not stated on README : [API](https://api.github.com/repos/FunAudioLLM/CosyVoice), [README](https://github.com/FunAudioLLM/CosyVoice).
- faster-whisper (SYSTRAN) : 25,776 stars, MIT, pushed 2026-10-06 : [API](https://api.github.com/repos/SYSTRAN/faster-whisper). Whisper weights MIT (background knowledge, unverified here).
- Parakeet (NVIDIA NeMo): not fetched; weights believed CC-BY-4.0 (UNVERIFIED).

### Inferences
- Verdicts: Chatterbox, Kokoro, Orpheus, Dia, CosyVoice = adopt code as optional TTS lanes on GPU fleet after weight check; F5-TTS, Fish Speech, VibeVoice = do not adopt (weights/licence), adopt design; faster-whisper = adopt code.

### Gaps
- Chatterbox/Kokoro/Orpheus/Dia/CosyVoice weight licenses, Parakeet, other Whisper variants not verified via primary page.

## 5. Viseme / blendshape lip-sync libraries

### Takeaway
Rhubarb is the standard offline mouth-cue generator; wawa-lipsync is a tiny MIT browser analyzer; NVIDIA Audio2Face-3D is the only open audio-to-full-face-blendshape model but its weights are NVIDIA Open Model license. three.ws already emits ARKit-52 rigs, so Audio2Face-3D is the real upgrade path over viseme-only lip sync.

### Cited Findings
- Rhubarb Lip Sync https://github.com/DanielSWolf/rhubarb-lip-sync : 2,645 stars, NOASSERTION (README does not show license; believed MIT with bundled PocketSphinx, UNVERIFIED), pushed 2026-06-16; 6 base shapes A-F + G, H, X; outputs TSV/XML/JSON/DAT : [README](https://github.com/DanielSWolf/rhubarb-lip-sync), [API](https://api.github.com/repos/DanielSWolf/rhubarb-lip-sync). Offline, English-centric (background knowledge).
- wawa-lipsync (wass08) https://github.com/wass08/wawa-lipsync : 211 stars, MIT, pushed 2025-11-07 : [API](https://api.github.com/repos/wass08/wawa-lipsync). Real-time browser audio-analysis visemes.
- NVIDIA Audio2Face-3D https://github.com/NVIDIA/Audio2Face-3D : 467 stars (2026-10-09), repo itself no license; SDK + Maya/UE5 plugins MIT; training framework Apache; NIM under NVIDIA software license; models "Nvidia Open Model" (regression v2.3, diffusion v3.0); Audio2Emotion models custom (use with Audio2Face only); sample dataset evaluation-only; outputs mesh deformation, joints or blendshape weights; C++ SDK : [README](https://github.com/NVIDIA/Audio2Face-3D), [API](https://api.github.com/repos/NVIDIA/Audio2Face-3D). three.ws is an NVIDIA Inception member (surfaces list), a favorable relationship.

### Inferences
- Verdicts: Audio2Face-3D = adopt code (SDK MIT; read Open Model license for hosted use) onto ARKit-52 rigs; wawa-lipsync = already covered if three.ws has analyser-based visemes; Rhubarb = adopt design (offline cue baking for pre-recorded lines).

### Gaps
- Open Model license text not read.

## 6. Closed products (features only)

### Takeaway
Closed vendors compete on a rendering+turn-taking+perception stack: Tavus ships purpose-built models (turn-taking, perception, generative video face), Simli sells sub-300 ms speech-to-video, ElevenLabs sells breadth (languages, voices, integrations) with no avatar. All are video/voice-first, none are embeddable 3D rigs with gestures, so three.ws's 3D body is the differentiator; the gaps are perception and turn-taking models.

### Cited Findings
- Tavus: Phoenix-4.5 real-time face rendering (stated 134 ms, new identity from one image), Sparrow-2 turn-taking model (claims #1 on TurnBench), Raven-1 multimodal perception (voice, video, screen, emotion cues, <300 ms context), Griffin preview video-to-video full-duplex model, knowledge-base grounding, CVI developer API with "PALs" : [Tavus](https://www.tavus.io/) (vendor claims).
- Simli: real-time video avatars, speech-to-video under 300 ms, Gaussian "Emotive Faces", face cloning, free plan $10 at signup plus 50 minutes monthly top-up; STT/LLM/TTS latency estimates 100-500/250-450/250-1200 ms : [Simli](https://www.simli.com/) (vendor claims).
- ElevenLabs Agents: 90+ languages with mid-call switching, 16-17k voices, integrations (Zapier, Salesforce, Stripe, HubSpot, Shopify, Zendesk, Genesys, Twilio, Amazon Connect), MCP/API/webhooks, BYO LLM, free tier 15 min with commercial license; no avatars mentioned : [ElevenLabs](https://elevenlabs.io/agents).
- HeyGen interactive avatar: page now 301-redirects to https://www.liveavatar.com/ (not fetched) : [HeyGen redirect](https://www.heygen.com/interactive-avatar).
- Hume EVI: page returned 404; no verified data. Character.AI: not fetched.

### Inferences
- Missing in three.ws relative to closed products: a dedicated turn-taking model (Sparrow-like; open analogues are TEN Turn Detection and Pipecat smart-turn), multimodal perception of the user (camera/emotion), 90+ language voice breadth, CRM-style tool integrations.

### Gaps
- Hume EVI, Character.AI, HeyGen live-avatar details not retrieved.
